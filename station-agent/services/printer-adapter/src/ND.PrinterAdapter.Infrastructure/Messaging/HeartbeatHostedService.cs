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
            var isOnline = false;
            var lifecycleState = "Offline";
            var ip = "localhost";
            var port = 9100;

            try
            {
                using var scope = _scopeFactory.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<PrinterDbContext>();

                var printer = await db.Printers.FirstOrDefaultAsync(p => p.PrinterCode == "printer-01", stoppingToken);
                if (printer != null)
                {
                    ip = printer.IpAddress;
                    port = printer.Port;

                    // Ping via TCP socket connection check
                    try
                    {
                        using var tcp = new TcpClient();
                        var connectTask = tcp.ConnectAsync(ip, port, stoppingToken).AsTask();
                        var delayTask = Task.Delay(1000, stoppingToken);
                        var completedTask = await Task.WhenAny(connectTask, delayTask);
                        if (completedTask == connectTask && tcp.Connected)
                        {
                            isOnline = true;
                            lifecycleState = "Idle";
                        }
                    }
                    catch
                    {
                        isOnline = false;
                        lifecycleState = "Offline";
                    }
                }

                // Publish heartbeat
                var hb = new DeviceStatusHeartbeat(
                    "printer-01",
                    "Printer",
                    isOnline,
                    lifecycleState,
                    DateTime.UtcNow.ToString("o")
                );

                await _publisher.PublishAsync(Exchange, "device.heartbeat.printer-01", JsonSerializer.Serialize(hb), stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error occurred in Printer Adapter heartbeat publisher.");
            }

            await Task.Delay(TimeSpan.FromSeconds(3), stoppingToken);
        }
    }
}
