using System.Net;
using System.Net.Sockets;
using System.Text;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using ND.DeviceSimulator.Application.Abstractions;
using ND.DeviceSimulator.Application.Dtos;
using ND.DeviceSimulator.Domain.Entities;
using ND.DeviceSimulator.Infrastructure.Hubs;
using ND.DeviceSimulator.Infrastructure.Persistence;

namespace ND.DeviceSimulator.Infrastructure.VirtualDevices;

/// <summary>
/// Virtual printer TCP server on port 9100.
/// Accepts ZPL/EPL payloads from printer-adapter or any TCP client.
/// Simulates configurable delay and failure rate.
/// </summary>
public sealed class VirtualPrinterServer : BackgroundService
{
    private const int DefaultPort = 9100;
    private static readonly Random Rng = new();

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ISimulatorStateService _state;
    private readonly IHubContext<SimulatorHub, ISimulatorClient> _hub;
    private readonly IConfiguration _config;
    private readonly ILogger<VirtualPrinterServer> _logger;

    private TcpListener? _listener;
    private volatile bool _forceDisconnected = false;

    public VirtualPrinterServer(
        IServiceScopeFactory scopeFactory,
        ISimulatorStateService state,
        IHubContext<SimulatorHub, ISimulatorClient> hub,
        IConfiguration config,
        ILogger<VirtualPrinterServer> logger)
    {
        _scopeFactory = scopeFactory;
        _state = state;
        _hub = hub;
        _config = config;
        _logger = logger;
    }

    public async Task ConnectPrinterAsync(CancellationToken ct = default)
    {
        _forceDisconnected = false;
        _logger.LogInformation("Virtual Printer connection enabled via API");
    }

    public async Task DisconnectPrinterAsync(CancellationToken ct = default)
    {
        _forceDisconnected = true;
        try
        {
            _listener?.Stop();
        }
        catch { }
        _state.SetPrinterOnline(false);
        await _hub.Clients.All.SimulatorStatusUpdated(_state.GetStatus());
        _logger.LogInformation("Virtual Printer manually disconnected via API");
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (_forceDisconnected)
                {
                    if (_listener != null)
                    {
                        _listener.Stop();
                        _listener = null;
                        _state.SetPrinterOnline(false);
                        await _hub.Clients.All.SimulatorStatusUpdated(_state.GetStatus());
                    }
                    await Task.Delay(500, stoppingToken);
                    continue;
                }

                if (_listener == null)
                {
                    var port = int.TryParse(GetConfig("PRINTER_PORT", "9100"), out var p) ? p : DefaultPort;
                    _listener = new TcpListener(IPAddress.Any, port);
                    _listener.Start();
                    _state.SetPrinterOnline(true);
                    _logger.LogInformation("VirtualPrinterServer listening on TCP :{Port}", port);
                    await _hub.Clients.All.SimulatorStatusUpdated(_state.GetStatus());
                }

                var client = await _listener.AcceptTcpClientAsync(stoppingToken);
                _ = HandleClientAsync(client, stoppingToken);
            }
            catch (OperationCanceledException) { break; }
            catch (Exception ex)
            {
                if (!_forceDisconnected)
                {
                    _logger.LogError(ex, "VirtualPrinterServer accept error");
                    await Task.Delay(1000, stoppingToken);
                }
            }
        }

        _listener?.Stop();
        _state.SetPrinterOnline(false);
        _logger.LogInformation("VirtualPrinterServer stopped");
    }

    private async Task HandleClientAsync(TcpClient client, CancellationToken ct)
    {
        using (client)
        {
            var remote = client.Client.RemoteEndPoint;
            _logger.LogDebug("Printer: connection from {Remote}", remote);

            var sw = System.Diagnostics.Stopwatch.StartNew();
            string? zplContent = null;
            string status;
            string? error = null;

            try
            {
                await using var stream = client.GetStream();
                using var reader = new StreamReader(stream, Encoding.ASCII, leaveOpen: true);

                var sb = new StringBuilder();
                var buffer = new char[4096];
                client.ReceiveTimeout = 2000;

                int read;
                while ((read = await reader.ReadAsync(buffer, ct)) > 0)
                {
                    sb.Append(buffer, 0, read);
                    if (sb.Length > 65536) break; // cap at 64 KB
                }

                zplContent = sb.ToString();
                sw.Stop();

                if (!string.IsNullOrEmpty(zplContent))
                {
                    var jobNo = ExtractJobNoFromZpl(zplContent);
                    if (!string.IsNullOrEmpty(jobNo))
                    {
                        _state.SetActiveJobId(jobNo);
                    }
                }

                var delayMs = int.TryParse(GetConfig("PRINTER_DELAY_MS", "800"), out var d) ? d : 800;
                await Task.Delay(delayMs, ct);
                sw.Restart();

                var failureRate = int.TryParse(GetConfig("PRINTER_FAILURE_RATE", "5"), out var f) ? f : 5;
                if (Rng.Next(100) < failureRate)
                {
                    status = "FAILED";
                    error = "Simulated print failure";
                    await stream.WriteAsync("NACK\n"u8.ToArray(), ct);
                }
                else
                {
                    status = "PRINTED";
                    await stream.WriteAsync("ACK\n"u8.ToArray(), ct);
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                status = "FAILED";
                error = ex.Message;
            }

            sw.Stop();
            var duration = (int)sw.ElapsedMilliseconds;

            _state.RecordPrinterJob(zplContent, status);

            var job = PrinterJob.Create(zplContent, duration, status, error);
            await PersistAsync(job, ct);

            var dto = new PrinterJobDto(job.Id, status, zplContent?[..Math.Min(200, zplContent?.Length ?? 0)], duration, job.ReceivedAt);
            await _hub.Clients.All.PrinterJobReceived(dto);
            await _hub.Clients.All.SimulatorStatusUpdated(_state.GetStatus());

            await AddTimelineAsync("PRINTER_EXECUTED", status == "PRINTED" ? "OK" : "FAILED",
                $"Print job received — {zplContent?.Length ?? 0} bytes — {status}", ct);

            _logger.LogInformation("Printer job {Status} — {Bytes} bytes — {Duration}ms", status, zplContent?.Length ?? 0, duration);
        }
    }

    private async Task PersistAsync(PrinterJob job, CancellationToken ct)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SimulatorDbContext>();
        db.PrinterJobs.Add(job);

        // Keep last 500
        var count = await db.PrinterJobs.CountAsync(ct);
        if (count > 500)
        {
            var oldest = await db.PrinterJobs.OrderBy(j => j.ReceivedAt).Take(count - 500).ToListAsync(ct);
            db.PrinterJobs.RemoveRange(oldest);
        }
        await db.SaveChangesAsync(ct);
    }

    private async Task AddTimelineAsync(string stage, string status, string detail, CancellationToken ct)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SimulatorDbContext>();
        var evt = TimelineEvent.Create(stage, status, detail);
        db.TimelineEvents.Add(evt);
        await db.SaveChangesAsync(ct);

        var dto = new TimelineEventDto(evt.Id, evt.Stage, evt.Status, evt.Detail, evt.OccurredAt);
        await _hub.Clients.All.TimelineEventAdded(dto);
    }

    private string GetConfig(string key, string @default)
        => _config[$"Simulator:{key}"] ?? @default;

    private static string? ExtractJobNoFromZpl(string? zpl)
    {
        if (string.IsNullOrEmpty(zpl)) return null;
        var index = zpl.IndexOf("Job: ", StringComparison.OrdinalIgnoreCase);
        if (index == -1)
        {
            index = zpl.IndexOf("JobNo: ", StringComparison.OrdinalIgnoreCase);
            if (index == -1) return null;
            var sub = zpl[(index + 7)..];
            var fsIndex = sub.IndexOf("^FS", StringComparison.OrdinalIgnoreCase);
            if (fsIndex != -1) sub = sub[..fsIndex];
            return sub.Trim();
        }
        else
        {
            var sub = zpl[(index + 5)..];
            var fsIndex = sub.IndexOf("^FS", StringComparison.OrdinalIgnoreCase);
            if (fsIndex != -1) sub = sub[..fsIndex];
            return sub.Trim();
        }
    }
}
