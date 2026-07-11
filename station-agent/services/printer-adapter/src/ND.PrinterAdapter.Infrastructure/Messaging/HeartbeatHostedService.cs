using System;
using System.Net.Sockets;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using ND.Infrastructure.Messaging;
using ND.PrinterAdapter.Infrastructure.Persistence;
using ND.SharedKernel.Abstractions;
using ND.UnifiedContracts.Events;

namespace ND.PrinterAdapter.Infrastructure.Messaging;

public sealed class HeartbeatHostedService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IRabbitMqPublisher _publisher;
    private readonly ILogger<HeartbeatHostedService> _logger;
    private const string Exchange = "station.events";

    public HeartbeatHostedService(
        IServiceScopeFactory scopeFactory,
        IRabbitMqPublisher publisher,
        ILogger<HeartbeatHostedService> logger)
    {
        _scopeFactory = scopeFactory;
        _publisher = publisher;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Printer Adapter Heartbeat Background Service started.");

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await PublishAllPrinterHeartbeatsAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error in Printer Adapter heartbeat publisher.");
            }

            await Task.Delay(TimeSpan.FromSeconds(3), stoppingToken);
        }
    }

    private async Task PublishAllPrinterHeartbeatsAsync(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PrinterDbContext>();
        var printers = await db.Printers.ToListAsync(ct);

        foreach (var printer in printers)
        {
            try
            {
                bool isOnline;
                string lifecycleState;

                if (printer.DriverType == "cups")
                {
                    // For CUPS printers: fast TCP ping to localhost:631 (CUPS HTTP port).
                    // If TCP fails the printer is powered off / USB disconnected — don't trust DB status.
                    try
                    {
                        using var tcp = new TcpClient();
                        var connectTask = tcp.ConnectAsync(printer.IpAddress ?? "localhost", printer.Port > 0 ? printer.Port : 631, ct).AsTask();
                        var delayTask = Task.Delay(1000, ct);
                        var completed = await Task.WhenAny(connectTask, delayTask);
                        isOnline = completed == connectTask && tcp.Connected;
                        lifecycleState = isOnline ? "Idle" : "Offline";
                    }
                    catch
                    {
                        isOnline = false;
                        lifecycleState = "Offline";
                    }
                }
                else
                {
                    // For simulation printers: TCP ping to self on the printer's port
                    try
                    {
                        using var tcp = new TcpClient();
                        var connectTask = tcp.ConnectAsync(printer.IpAddress ?? "localhost", printer.Port, ct).AsTask();
                        var delayTask = Task.Delay(800, ct);
                        var completed = await Task.WhenAny(connectTask, delayTask);
                        isOnline = completed == connectTask && tcp.Connected;
                        lifecycleState = isOnline ? "Idle" : "Offline";
                    }
                    catch
                    {
                        isOnline = false;
                        lifecycleState = "Offline";
                    }
                }

                // Update local database status
                var newStatus = isOnline ? "ONLINE" : "OFFLINE";
                if (printer.Status != newStatus)
                {
                    printer.UpdateStatus(newStatus);
                }

                var routingKey = $"device.heartbeat.{printer.PrinterCode.ToLowerInvariant()}";
                var hb = new DeviceStatusHeartbeat(
                    printer.PrinterCode,
                    "Printer",
                    isOnline,
                    lifecycleState,
                    DateTime.UtcNow.ToString("o")
                );

                await _publisher.PublishAsync(Exchange, routingKey, JsonSerializer.Serialize(hb), ct);
                _logger.LogDebug("Heartbeat [{Code}] → {State}", printer.PrinterCode, lifecycleState);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Heartbeat failed for printer {Code}", printer.PrinterCode);
            }
        }

        await db.SaveChangesAsync(ct);
    }
}

