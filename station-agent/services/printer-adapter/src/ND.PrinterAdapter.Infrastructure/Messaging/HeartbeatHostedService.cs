using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using ND.Infrastructure.Messaging;
using ND.PrinterAdapter.Application.Dtos;
using ND.PrinterAdapter.Application.Interfaces;
using ND.PrinterAdapter.Infrastructure.Persistence;
using ND.UnifiedContracts.Events;

namespace ND.PrinterAdapter.Infrastructure.Messaging;

/// <summary>
/// Polls all printer health every 3 seconds and publishes DeviceStatusHeartbeat to RabbitMQ.
///
/// For CUPS printers: delegates to <see cref="IPrinterDriverFactory"/> → <see cref="CupsPrinterDriver"/>
///   → <see cref="ICupsPrinterStateAggregator"/> → CUPS IPP API (real hardware state).
///   The richer lifecycleState (Online|Busy|Printing|Waiting|Warning|Offline|Error) is included
///   in the heartbeat so Projection Service and Kiosk UI can render full state detail.
///
/// For simulation printers: TCP ping to the virtual simulator listener.
///
/// Projection Service must never communicate with CUPS or the OS directly.
/// All hardware interpretation lives exclusively inside Printer Adapter.
/// </summary>
public sealed class HeartbeatHostedService : BackgroundService
{
    private readonly IServiceScopeFactory    _scopeFactory;
    private readonly IPrinterDriverFactory   _driverFactory;
    private readonly IRabbitMqPublisher      _publisher;
    private readonly ILogger<HeartbeatHostedService> _logger;

    private const string Exchange     = "station.events";
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(3);

    // States considered "online" for the isOnline boolean flag in the heartbeat
    private static readonly HashSet<PrinterDriverStatus> OnlineStates = new()
    {
        PrinterDriverStatus.Online,
        PrinterDriverStatus.Busy,
        PrinterDriverStatus.Printing,
        PrinterDriverStatus.Waiting,
        PrinterDriverStatus.Warning,
        PrinterDriverStatus.Connecting,
    };

    public HeartbeatHostedService(
        IServiceScopeFactory    scopeFactory,
        IPrinterDriverFactory   driverFactory,
        IRabbitMqPublisher      publisher,
        ILogger<HeartbeatHostedService> logger)
    {
        _scopeFactory  = scopeFactory;
        _driverFactory = driverFactory;
        _publisher     = publisher;
        _logger        = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Printer Adapter Heartbeat Background Service started (poll every {Interval}s).", PollInterval.TotalSeconds);

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

            await Task.Delay(PollInterval, stoppingToken);
        }
    }

    private async Task PublishAllPrinterHeartbeatsAsync(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var db          = scope.ServiceProvider.GetRequiredService<PrinterDbContext>();
        var printers    = await db.Printers.ToListAsync(ct);

        foreach (var printer in printers)
        {
            try
            {
                PrinterDriverStatus status;

                if (printer.DriverType == "cups")
                {
                    // ── Physical CUPS printer ────────────────────────────────
                    // Use the full driver stack: CupsPrinterDriver → CupsPrinterStateAggregator → CUPS IPP API
                    // This gives us the real hardware state (Online/Busy/Printing/Waiting/Warning/Offline/Error),
                    // not just "is CUPS running?" which the old localhost:631 TCP ping gave.
                    var driver = _driverFactory.Resolve(printer);
                    status = await driver.GetStatusAsync(ct);
                }
                else
                {
                    // ── Simulation printer ───────────────────────────────────
                    // TCP ping to the VirtualPrinterSimulator listener on the printer's configured port
                    try
                    {
                        using var tcp   = new System.Net.Sockets.TcpClient();
                        var connectTask = tcp.ConnectAsync(printer.IpAddress ?? "localhost", printer.Port, ct).AsTask();
                        var completed   = await Task.WhenAny(connectTask, Task.Delay(800, ct));
                        status = (completed == connectTask && tcp.Connected)
                            ? PrinterDriverStatus.Online
                            : PrinterDriverStatus.Offline;
                    }
                    catch
                    {
                        status = PrinterDriverStatus.Offline;
                    }
                }

                bool   isOnline      = OnlineStates.Contains(status);
                string lifecycleState = status switch
                {
                    PrinterDriverStatus.Online      => "Online",
                    PrinterDriverStatus.Busy        => "Busy",
                    PrinterDriverStatus.Printing    => "Printing",
                    PrinterDriverStatus.Waiting     => "Waiting",
                    PrinterDriverStatus.Warning     => "Warning",
                    PrinterDriverStatus.Connecting  => "Connecting",
                    PrinterDriverStatus.Offline     => "Offline",
                    PrinterDriverStatus.Error       => "Error",
                    PrinterDriverStatus.Stopped     => "Error",       // legacy → Error in UI
                    PrinterDriverStatus.Disconnected => "Offline",    // legacy → Offline
                    _                               => "Unknown",
                };

                // Update local database status
                var newStatus = isOnline ? "ONLINE" : "OFFLINE";
                if (printer.Status != newStatus)
                    printer.UpdateStatus(newStatus);

                var routingKey = $"device.heartbeat.{printer.PrinterCode.ToLowerInvariant()}";
                var hb = new DeviceStatusHeartbeat(
                    printer.PrinterCode,
                    "Printer",
                    isOnline,
                    lifecycleState,
                    DateTime.UtcNow.ToString("o")
                );

                await _publisher.PublishAsync(Exchange, routingKey, JsonSerializer.Serialize(hb), ct);
                _logger.LogDebug("Heartbeat [{Code}] → {LifecycleState} (isOnline={Online})",
                    printer.PrinterCode, lifecycleState, isOnline);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Heartbeat failed for printer {Code}", printer.PrinterCode);
            }
        }

        await db.SaveChangesAsync(ct);
    }
}
