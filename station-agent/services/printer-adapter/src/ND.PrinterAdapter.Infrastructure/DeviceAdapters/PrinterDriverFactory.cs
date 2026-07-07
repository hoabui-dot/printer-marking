using Microsoft.Extensions.Logging;
using ND.PrinterAdapter.Application.Dtos;
using ND.PrinterAdapter.Application.Interfaces;
using ND.PrinterAdapter.Domain.Entities;

namespace ND.PrinterAdapter.Infrastructure.DeviceAdapters;

/// <summary>
/// Resolves the correct IPrinterDriver for a Printer entity.
/// Global override: PRINT_DRIVER env var ("simulation" | "cups") overrides per-printer DriverType.
/// </summary>
public sealed class PrinterDriverFactory : IPrinterDriverFactory
{
    private readonly IPrinterAdapter _tcpAdapter;
    private readonly ILoggerFactory _loggerFactory;

    // Global override from env var (null means use per-printer DriverType)
    private static readonly string? GlobalDriverOverride =
        Environment.GetEnvironmentVariable("PRINT_DRIVER")?.Trim().ToLowerInvariant();

    public PrinterDriverFactory(IPrinterAdapter tcpAdapter, ILoggerFactory loggerFactory)
    {
        _tcpAdapter = tcpAdapter;
        _loggerFactory = loggerFactory;
    }

    public IPrinterDriver Resolve(Printer printer)
    {
        // Global env var overrides per-printer config
        var driverType = GlobalDriverOverride ?? printer.DriverType?.ToLowerInvariant() ?? "simulation";

        return driverType switch
        {
            "cups" => BuildCupsDriver(printer.CupsQueueName
                       ?? Environment.GetEnvironmentVariable("CUPS_QUEUE")
                       ?? "Zebra_Technologies_ZTC_GK420t"),
            _ => BuildSimulationDriver(printer.IpAddress, printer.Port)
        };
    }

    public IPrinterDriver ResolveByType(
        string driverType,
        string? ipAddress = null,
        int port = 9100,
        string? cupsQueueName = null)
    {
        var type = (GlobalDriverOverride ?? driverType).ToLowerInvariant();
        return type switch
        {
            "cups" => BuildCupsDriver(cupsQueueName
                       ?? Environment.GetEnvironmentVariable("CUPS_QUEUE")
                       ?? "Zebra_Technologies_ZTC_GK420t"),
            _ => BuildSimulationDriver(ipAddress ?? "device-simulator", port)
        };
    }

    private IPrinterDriver BuildCupsDriver(string queueName)
        => new CupsPrinterDriver(queueName, _loggerFactory.CreateLogger<CupsPrinterDriver>());

    private IPrinterDriver BuildSimulationDriver(string ipAddress, int port)
        => new SimulationPrinterDriver(
            _tcpAdapter,
            ipAddress,
            port,
            _loggerFactory.CreateLogger<SimulationPrinterDriver>());
}
