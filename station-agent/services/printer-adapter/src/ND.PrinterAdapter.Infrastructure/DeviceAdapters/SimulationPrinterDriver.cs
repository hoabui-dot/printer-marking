using System.Diagnostics;
using Microsoft.Extensions.Logging;
using ND.PrinterAdapter.Application.Dtos;
using ND.PrinterAdapter.Application.Interfaces;

namespace ND.PrinterAdapter.Infrastructure.DeviceAdapters;

/// <summary>
/// Wraps the existing ZplTcpPrinterAdapter so the virtual Device Simulator
/// continues to work without any changes to the simulation flow.
/// </summary>
public sealed class SimulationPrinterDriver : IPrinterDriver
{
    private readonly IPrinterAdapter _tcpAdapter;
    private readonly string _ipAddress;
    private readonly int _port;
    private readonly ILogger<SimulationPrinterDriver> _logger;

    public SimulationPrinterDriver(
        IPrinterAdapter tcpAdapter,
        string ipAddress,
        int port,
        ILogger<SimulationPrinterDriver> logger)
    {
        _tcpAdapter = tcpAdapter;
        _ipAddress = ipAddress;
        _port = port;
        _logger = logger;
    }

    public async Task<PrintResult> PrintAsync(string content, CancellationToken ct = default)
    {
        var sw = Stopwatch.StartNew();
        _logger.LogInformation("SimulationPrinterDriver: Sending ZPL to {Ip}:{Port} ({Bytes} bytes)",
            _ipAddress, _port, content.Length);

        var ok = await _tcpAdapter.PrintAsync(_ipAddress, _port, content, ct);
        sw.Stop();

        return ok
            ? PrintResult.Ok(sw.ElapsedMilliseconds)
            : PrintResult.Fail("TCP_FAILED", $"Could not connect to simulated printer at {_ipAddress}:{_port}",
                isRecoverable: true, isRetryable: true, durationMs: sw.ElapsedMilliseconds);
    }

    public async Task<PrinterDriverStatus> GetStatusAsync(CancellationToken ct = default)
    {
        var reachable = await _tcpAdapter.CheckHealthAsync(_ipAddress, _port, ct);
        return reachable ? PrinterDriverStatus.Online : PrinterDriverStatus.Offline;
    }

    public Task<IReadOnlyList<DiscoveredPrinter>> DiscoverAsync(CancellationToken ct = default)
    {
        IReadOnlyList<DiscoveredPrinter> result =
        [
            new DiscoveredPrinter
            {
                Id = $"sim-{_ipAddress}-{_port}",
                Name = "Device Simulator",
                QueueName = $"{_ipAddress}:{_port}",
                Driver = "simulation",
                Status = "Idle",
                IsDefault = true
            }
        ];
        return Task.FromResult(result);
    }

    public async Task<bool> HealthCheckAsync(CancellationToken ct = default)
        => await _tcpAdapter.CheckHealthAsync(_ipAddress, _port, ct);
}
