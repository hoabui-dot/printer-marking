using ND.SharedKernel.Primitives;

namespace ND.PrinterAdapter.Domain.Entities;

/// <summary>
/// Registered industrial printer device.
/// Table: printer_printers
/// </summary>
public sealed class Printer : Entity
{
    public string PrinterCode { get; private set; } = default!;
    public string DisplayName { get; private set; } = default!;
    public string IpAddress { get; private set; } = default!;
    public int Port { get; private set; } = 9100;
    public string Protocol { get; private set; } = "ZPL";   // ZPL / TSPL / EPL
    public string Vendor { get; private set; } = "ZEBRA";   // ZEBRA / HONEYWELL / OTHER
    public string Status { get; private set; } = "OFFLINE"; // ONLINE / OFFLINE / ERROR
    public string? GroupId { get; private set; }
    public string? LastHeartbeatAt { get; private set; }

    /// <summary>
    /// Driver type used to route print jobs.
    /// Values: "simulation" (ZPL over TCP to Device Simulator) | "cups" (lpr via CUPS) | "tcp" (raw TCP)
    /// </summary>
    public string DriverType { get; private set; } = "simulation";

    /// <summary>
    /// CUPS queue name used when DriverType == "cups".
    /// Example: "Zebra_Technologies_ZTC_GK420t"
    /// </summary>
    public string? CupsQueueName { get; private set; }

    private Printer() { }

    public static Printer Create(
        string printerCode,
        string displayName,
        string ipAddress,
        int port,
        string protocol,
        string vendor,
        string? groupId = null,
        string driverType = "simulation",
        string? cupsQueueName = null)
    {
        return new Printer
        {
            PrinterCode = printerCode,
            DisplayName = displayName,
            IpAddress = ipAddress,
            Port = port,
            Protocol = protocol,
            Vendor = vendor,
            GroupId = groupId,
            DriverType = driverType,
            CupsQueueName = cupsQueueName
        };
    }

    public void SetOnline()
    {
        Status = "ONLINE";
        LastHeartbeatAt = DateTime.UtcNow.ToString("o");
    }

    public void SetOffline() => Status = "OFFLINE";

    public void SetError() => Status = "ERROR";

    public void UpdateHeartbeat()
    {
        Status = "ONLINE";
        LastHeartbeatAt = DateTime.UtcNow.ToString("o");
    }

    public void UpdateDriver(string driverType, string? cupsQueueName = null)
    {
        DriverType = driverType;
        CupsQueueName = cupsQueueName;
    }

    public void UpdateStatus(string status, string? errorMessage = null)
    {
        Status = status;
        if (status == "ONLINE" || status == "IDLE" || status == "PRINTING")
            LastHeartbeatAt = DateTime.UtcNow.ToString("o");
    }
}
