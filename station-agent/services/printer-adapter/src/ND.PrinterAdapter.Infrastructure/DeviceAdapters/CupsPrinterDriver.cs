using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging;
using ND.PrinterAdapter.Application.Dtos;
using ND.PrinterAdapter.Application.Interfaces;

namespace ND.PrinterAdapter.Infrastructure.DeviceAdapters;

/// <summary>
/// Sends raw ZPL to a Zebra printer connected via USB on macOS through the native CUPS subsystem.
/// Uses <c>lpr -P {queue} -o raw</c> — never rasterizes, always sends raw ZPL.
/// Supports discovery via <c>lpstat -p -d</c> and health checks via <c>lpstat -p {queue}</c>.
/// </summary>
public sealed class CupsPrinterDriver : IPrinterDriver
{
    private readonly string _queueName;
    private readonly ILogger<CupsPrinterDriver> _logger;

    public CupsPrinterDriver(string queueName, ILogger<CupsPrinterDriver> logger)
    {
        _queueName = queueName;
        _logger = logger;
    }

    // ── Print ─────────────────────────────────────────────────────────────────

    public async Task<PrintResult> PrintAsync(string content, CancellationToken ct = default)
    {
        var sw = Stopwatch.StartNew();

        _logger.LogInformation("[CUPS] Print Request Received → queue={Queue} ({Bytes} bytes)", _queueName, content.Length);

        // Validate queue exists before attempting
        var queueExists = await QueueExistsAsync(ct);
        if (!queueExists)
        {
            return PrintResult.Fail(
                "QUEUE_MISSING",
                $"CUPS queue '{_queueName}' not found. Run: lpstat -p",
                isRecoverable: false, isRetryable: false, durationMs: sw.ElapsedMilliseconds);
        }

        // Validate ZPL minimally
        if (string.IsNullOrWhiteSpace(content) || !content.Contains("^XA"))
        {
            return PrintResult.Fail(
                "INVALID_ZPL",
                "ZPL content is empty or missing ^XA header",
                isRecoverable: false, isRetryable: false, durationMs: sw.ElapsedMilliseconds);
        }

        try
        {
            // Pipe ZPL directly to lpr stdin — no temp files
            var psi = new ProcessStartInfo
            {
                FileName = "lpr",
                Arguments = $"-P {_queueName} -o raw",
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            _logger.LogInformation("[CUPS] Printer Queue Selected → {Queue}", _queueName);
            _logger.LogInformation("[CUPS] Sending ZPL to CUPS via lpr...");

            using var proc = Process.Start(psi)
                ?? throw new InvalidOperationException("Failed to start lpr process");

            // Write ZPL to stdin (in-memory pipe, no temp file)
            await using (var writer = new StreamWriter(proc.StandardInput.BaseStream, Encoding.UTF8, leaveOpen: false))
            {
                await writer.WriteAsync(content);
            }

            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromSeconds(15));

            await proc.WaitForExitAsync(cts.Token);
            sw.Stop();

            var stderr = await proc.StandardError.ReadToEndAsync(ct);

            if (proc.ExitCode != 0)
            {
                var (errorCode, message, recoverable, retryable) = ClassifyLprError(stderr, proc.ExitCode);
                _logger.LogError("[CUPS] lpr failed (exit={Code}): {Stderr}", proc.ExitCode, stderr);
                return PrintResult.Fail(errorCode, message, recoverable, retryable, sw.ElapsedMilliseconds);
            }

            _logger.LogInformation("[CUPS] CUPS Accepted → lpr exit=0, duration={Ms}ms", sw.ElapsedMilliseconds);
            _logger.LogInformation("[CUPS] Completed → queue={Queue}", _queueName);
            return PrintResult.Ok(sw.ElapsedMilliseconds);
        }
        catch (OperationCanceledException)
        {
            return PrintResult.Fail("CUPS_TIMEOUT", "CUPS print timed out after 15 seconds",
                isRecoverable: true, isRetryable: true, durationMs: sw.ElapsedMilliseconds);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[CUPS] Unexpected error sending to queue {Queue}", _queueName);
            return PrintResult.Fail("UNEXPECTED", ex.Message,
                isRecoverable: false, isRetryable: false, durationMs: sw.ElapsedMilliseconds);
        }
    }

    // ── Status ────────────────────────────────────────────────────────────────

    /// <summary>
    /// Health check via TCP ping to the CUPS HTTP port.
    /// Uses host.docker.internal (configurable via CUPS_HEALTH_HOST) so that this works
    /// whether printer-adapter runs natively or inside Docker on macOS.
    /// Note: lpstat is not available inside Docker Linux containers on macOS.
    /// </summary>
    public async Task<PrinterDriverStatus> GetStatusAsync(CancellationToken ct = default)
    {
        try
        {
            var host = Environment.GetEnvironmentVariable("CUPS_HEALTH_HOST") ?? "host.docker.internal";
            var port = int.TryParse(Environment.GetEnvironmentVariable("CUPS_HEALTH_PORT") ?? "631", out var p) ? p : 631;

            using var tcp = new System.Net.Sockets.TcpClient();
            var connectTask = tcp.ConnectAsync(host, port, ct).AsTask();
            var delayTask   = Task.Delay(1000, ct);
            var completed   = await Task.WhenAny(connectTask, delayTask);

            if (completed == connectTask && tcp.Connected)
                return PrinterDriverStatus.Idle;

            return PrinterDriverStatus.Offline;
        }
        catch
        {
            return PrinterDriverStatus.Disconnected;
        }
    }

    // ── Discovery ─────────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<DiscoveredPrinter>> DiscoverAsync(CancellationToken ct = default)
    {
        var result = new List<DiscoveredPrinter>();
        try
        {
            var output = await RunCommandAsync("lpstat", "-p -d", ct);
            if (string.IsNullOrWhiteSpace(output))
                return result;

            // Parse: "printer Zebra_Technologies_ZTC_GK420t is idle."
            var printerRegex = new Regex(@"^printer\s+(\S+)\s+is\s+(\S+)", RegexOptions.Multiline | RegexOptions.IgnoreCase);
            // Parse: "system default destination: Zebra_Technologies_ZTC_GK420t"
            var defaultRegex = new Regex(@"^system default destination:\s+(\S+)", RegexOptions.Multiline | RegexOptions.IgnoreCase);

            var defaultMatch = defaultRegex.Match(output);
            var defaultQueue = defaultMatch.Success ? defaultMatch.Groups[1].Value : null;

            foreach (Match m in printerRegex.Matches(output))
            {
                var name = m.Groups[1].Value;
                var statusWord = m.Groups[2].Value.TrimEnd('.');
                result.Add(new DiscoveredPrinter
                {
                    Id = name,
                    Name = name.Replace("_", " "),
                    QueueName = name,
                    Driver = "cups",
                    Status = statusWord,
                    IsDefault = string.Equals(name, defaultQueue, StringComparison.OrdinalIgnoreCase)
                });
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[CUPS] Discover failed");
        }

        return result;
    }

    // ── Health ────────────────────────────────────────────────────────────────

    public async Task<bool> HealthCheckAsync(CancellationToken ct = default)
    {
        var status = await GetStatusAsync(ct);
        return status is PrinterDriverStatus.Idle or PrinterDriverStatus.Printing;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private async Task<bool> QueueExistsAsync(CancellationToken ct)
    {
        var output = await RunCommandAsync("lpstat", "-p", ct);
        return output.Contains(_queueName, StringComparison.OrdinalIgnoreCase);
    }

    private static async Task<string> RunCommandAsync(string command, string args, CancellationToken ct)
    {
        var psi = new ProcessStartInfo
        {
            FileName = command,
            Arguments = args,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        using var proc = Process.Start(psi) ?? throw new InvalidOperationException($"Failed to start {command}");
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromSeconds(10));
        await proc.WaitForExitAsync(cts.Token);
        return await proc.StandardOutput.ReadToEndAsync(ct);
    }

    private static (string code, string message, bool recoverable, bool retryable) ClassifyLprError(string stderr, int exitCode)
    {
        var lower = stderr.ToLowerInvariant();

        if (lower.Contains("permission denied"))
            return ("PERMISSION_DENIED", $"Permission denied accessing CUPS: {stderr}", false, false);
        if (lower.Contains("no such file") || lower.Contains("unknown printer"))
            return ("INVALID_QUEUE", $"Queue not found: {stderr}", false, false);
        if (lower.Contains("offline") || lower.Contains("not connected"))
            return ("PRINTER_OFFLINE", $"Printer offline: {stderr}", true, true);
        if (lower.Contains("paper") || lower.Contains("media"))
            return ("PAPER_OUT", $"Paper out: {stderr}", true, false);
        if (lower.Contains("ribbon") || lower.Contains("ink"))
            return ("RIBBON_OUT", $"Ribbon/ink out: {stderr}", true, false);
        if (lower.Contains("busy"))
            return ("PRINTER_BUSY", $"Printer busy: {stderr}", true, true);
        if (lower.Contains("timeout"))
            return ("CUPS_TIMEOUT", $"CUPS timeout: {stderr}", true, true);

        return ("LPR_ERROR", $"lpr failed (exit={exitCode}): {stderr}", false, false);
    }
}
