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
using ND.DeviceSimulator.Infrastructure.State;

namespace ND.DeviceSimulator.Infrastructure.VirtualDevices;

/// <summary>
/// Configurable failure modes for the virtual Zebra printer simulator.
/// </summary>
public enum PrinterSimulatorMode
{
    Success = 0,
    PrinterBusy = 1,
    Offline = 2,
    PaperOut = 3,
    RibbonOut = 4,
    HeadOpen = 5,
    InvalidZpl = 6,
    InvalidBarcode = 7,
    TcpTimeout = 8,
    TcpConnectionRefused = 9,
    MemoryFull = 10,
}

/// <summary>
/// Virtual printer TCP server on port 9100.
/// Accepts ZPL/EPL payloads from printer-adapter or any TCP client.
/// Supports configurable failure modes for realistic Zebra printer simulation.
/// </summary>
public sealed class VirtualPrinterServer : BackgroundService
{
    private static readonly Random Rng = new();

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly SimulatorStateService _state;
    private readonly IHubContext<SimulatorHub, ISimulatorClient> _hub;
    private readonly IConfiguration _config;
    private readonly ILogger<VirtualPrinterServer> _logger;

    public VirtualPrinterServer(
        IServiceScopeFactory scopeFactory,
        SimulatorStateService state,
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

    public async Task ConnectPrinterAsync(string? code = null, CancellationToken ct = default)
    {
        var printers = _state.GetInternalPrinters();
        foreach (var p in printers)
        {
            if (code == null || p.PrinterCode.Equals(code, StringComparison.OrdinalIgnoreCase))
            {
                p.ForceDisconnected = false;
                p.Online = true;
                _logger.LogInformation("Virtual Printer [{Code}] connection enabled", p.PrinterCode);
            }
        }
        await BroadcastStatusUpdateAsync();
    }

    public async Task DisconnectPrinterAsync(string? code = null, CancellationToken ct = default)
    {
        var printers = _state.GetInternalPrinters();
        foreach (var p in printers)
        {
            if (code == null || p.PrinterCode.Equals(code, StringComparison.OrdinalIgnoreCase))
            {
                p.ForceDisconnected = true;
                p.Online = false;
                try
                {
                    p.Listener?.Stop();
                    p.Listener = null;
                }
                catch { }
                _logger.LogInformation("Virtual Printer [{Code}] connection disabled", p.PrinterCode);
            }
        }
        await BroadcastStatusUpdateAsync();
    }

    public void SetPrinterMode(string code, string modeStr)
    {
        if (Enum.TryParse<PrinterSimulatorMode>(modeStr, true, out var mode))
        {
            var printers = _state.GetInternalPrinters();
            var p = printers.FirstOrDefault(x => x.PrinterCode.Equals(code, StringComparison.OrdinalIgnoreCase));
            if (p != null)
            {
                p.SimulatorMode = modeStr;
                _logger.LogInformation("Printer [{Code}] mode changed to {Mode}", code, modeStr);
            }
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var printers = _state.GetInternalPrinters();
        var tasks = printers.Select(p => RunPrinterListenerAsync(p, stoppingToken)).ToList();
        await Task.WhenAll(tasks);
        _logger.LogInformation("All virtual printer servers stopped");
    }

    private async Task RunPrinterListenerAsync(SimulatedPrinter printer, CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (printer.ForceDisconnected || !printer.Online || printer.SimulatorMode.Equals("Offline", StringComparison.OrdinalIgnoreCase))
                {
                    if (printer.Listener != null)
                    {
                        printer.Listener.Stop();
                        printer.Listener = null;
                        await BroadcastStatusUpdateAsync();
                    }
                    await Task.Delay(500, stoppingToken);
                    continue;
                }

                if (printer.Listener == null)
                {
                    printer.Listener = new TcpListener(IPAddress.Any, printer.Port);
                    printer.Listener.Start();
                    _logger.LogInformation("VirtualPrinterServer [{Code}] listening on TCP :{Port} (mode: {Mode})", 
                        printer.PrinterCode, printer.Port, printer.SimulatorMode);
                    await BroadcastStatusUpdateAsync();
                }

                var client = await printer.Listener.AcceptTcpClientAsync(stoppingToken);
                _ = HandleClientAsync(printer, client, stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                if (!printer.ForceDisconnected)
                {
                    _logger.LogError(ex, "VirtualPrinterServer [{Code}] accept error", printer.PrinterCode);
                    await Task.Delay(1000, stoppingToken);
                }
            }
        }

        printer.Listener?.Stop();
        printer.Listener = null;
    }

    private async Task HandleClientAsync(SimulatedPrinter printer, TcpClient client, CancellationToken ct)
    {
        var modeStr = printer.SimulatorMode;
        Enum.TryParse<PrinterSimulatorMode>(modeStr, true, out var mode);

        // TcpConnectionRefused — immediately close the connection with no data
        if (mode == PrinterSimulatorMode.TcpConnectionRefused)
        {
            _logger.LogWarning("Printer simulator [{Code}]: TcpConnectionRefused — dropping connection immediately", printer.PrinterCode);
            client.Close();
            await RecordAndBroadcastJobAsync(printer, null, "FAILED", "TCP Connection Refused (simulated)", 0, ct);
            return;
        }

        using (client)
        {
            var remote = client.Client.RemoteEndPoint;
            _logger.LogDebug("Printer [{Code}]: connection from {Remote} (mode: {Mode})", printer.PrinterCode, remote, mode);

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

                // TcpTimeout — use very short receive window to force timeout
                client.ReceiveTimeout = mode == PrinterSimulatorMode.TcpTimeout ? 50 : 2000;

                int read;
                while ((read = await reader.ReadAsync(buffer, ct)) > 0)
                {
                    sb.Append(buffer, 0, read);
                    if (sb.Length > 65536) break;
                }

                zplContent = sb.ToString();
                sw.Stop();

                if (!string.IsNullOrEmpty(zplContent))
                {
                    var jobNo = ExtractJobNoFromZpl(zplContent);
                    if (!string.IsNullOrEmpty(jobNo))
                    {
                        printer.ActiveJobId = jobNo;
                        _state.SetActiveJobId(jobNo);
                    }
                }

                // Simulate mode-specific behavior
                (status, error) = mode switch
                {
                    PrinterSimulatorMode.PrinterBusy => ("FAILED", "ERROR: Printer busy — please wait"),
                    PrinterSimulatorMode.PaperOut => ("FAILED", "ERROR: Paper out — reload paper and retry"),
                    PrinterSimulatorMode.RibbonOut => ("FAILED", "ERROR: Ribbon out — replace ribbon"),
                    PrinterSimulatorMode.HeadOpen => ("FAILED", "ERROR: Print head open — close the cover"),
                    PrinterSimulatorMode.InvalidZpl => ("FAILED", "ERROR: Invalid ZPL command — parse error at offset 0"),
                    PrinterSimulatorMode.InvalidBarcode => ("FAILED", "ERROR: Invalid barcode data — check barcode content"),
                    PrinterSimulatorMode.MemoryFull => ("FAILED", "ERROR: Printer memory full — delete unused formats"),
                    PrinterSimulatorMode.TcpTimeout => ("FAILED", "TCP Timeout (simulated)"),
                    _ => ("_PROCESS", null) // will apply normal logic below
                };

                if (status == "_PROCESS")
                {
                    printer.Status = "BUSY";
                    await BroadcastStatusUpdateAsync();

                    var delayMs = int.TryParse(GetConfig("PRINTER_DELAY_MS", "800"), out var d) ? d : 800;
                    await Task.Delay(delayMs, ct);

                    var failureRate = int.TryParse(GetConfig("PRINTER_FAILURE_RATE", "5"), out var f) ? f : 5;
                    if (Rng.Next(100) < failureRate)
                    {
                        status = "FAILED";
                        error = "Simulated random print failure";
                    }
                    else
                    {
                        status = "PRINTED";
                    }
                }

                // Send realistic ZPL response
                var response = BuildResponse(mode, status, error);
                await stream.WriteAsync(Encoding.ASCII.GetBytes(response + "\n"), ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                status = "FAILED";
                error = ex.Message;
            }

            sw.Stop();
            var duration = (int)sw.ElapsedMilliseconds;

            printer.Status = "IDLE";
            await RecordAndBroadcastJobAsync(printer, zplContent, status, error, duration, ct);
        }
    }

    private static string BuildResponse(PrinterSimulatorMode mode, string status, string? error)
    {
        return mode switch
        {
            PrinterSimulatorMode.PrinterBusy => "NACK: BUSY",
            PrinterSimulatorMode.PaperOut => "NACK: PAPER_OUT",
            PrinterSimulatorMode.RibbonOut => "NACK: RIBBON_OUT",
            PrinterSimulatorMode.HeadOpen => "NACK: HEAD_OPEN",
            PrinterSimulatorMode.InvalidZpl => "NACK: INVALID_ZPL",
            PrinterSimulatorMode.InvalidBarcode => "NACK: INVALID_BARCODE",
            PrinterSimulatorMode.MemoryFull => "NACK: MEMORY_FULL",
            _ => status == "PRINTED" ? "ACK" : $"NACK: {error ?? "UNKNOWN"}"
        };
    }

    private async Task RecordAndBroadcastJobAsync(SimulatedPrinter printer, string? zplContent, string status, string? error, int duration, CancellationToken ct)
    {
        printer.JobCount++;
        printer.LastZplPreview = zplContent != null ? zplContent[..Math.Min(200, zplContent.Length)] : null;
        printer.LastResult = status;
        printer.LastJobAt = DateTime.UtcNow.ToString("o");

        // Maintain backwards compatibility
        _state.RecordPrinterJob(zplContent, status);

        var job = PrinterJob.Create(zplContent, duration, status, error);
        await PersistAsync(job, ct);

        var dto = new PrinterJobDto(job.Id, status, zplContent?[..Math.Min(200, zplContent?.Length ?? 0)], duration, job.ReceivedAt);
        await _hub.Clients.All.PrinterJobReceived(dto);
        await BroadcastStatusUpdateAsync();

        await AddTimelineAsync("PRINTER_EXECUTED", status == "PRINTED" ? "OK" : "FAILED",
            $"Print job [{printer.PrinterCode}] — {zplContent?.Length ?? 0} bytes — {status}{(error != null ? ": " + error : "")}", ct);

        _logger.LogInformation("Printer [{Code}] job {Status} — {Bytes} bytes — {Duration}ms{Error}",
            printer.PrinterCode, status, zplContent?.Length ?? 0, duration, error != null ? " — " + error : "");
    }

    private async Task PersistAsync(PrinterJob job, CancellationToken ct)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SimulatorDbContext>();
        db.PrinterJobs.Add(job);
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

    private async Task BroadcastStatusUpdateAsync()
    {
        await _hub.Clients.All.SimulatorStatusUpdated(_state.GetStatus());
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
