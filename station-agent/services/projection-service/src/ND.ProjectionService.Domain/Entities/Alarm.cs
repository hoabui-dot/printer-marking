using System;
using ND.SharedKernel.Primitives;

namespace ND.ProjectionService.Domain.Entities;

public sealed class Alarm : Entity
{
    public string Severity { get; private set; } = "Warning"; // Warning, Error, Critical
    public string Source { get; private set; } = default!; // Device, Infrastructure, Workflow
    public string Message { get; private set; } = default!;
    public string? DeviceId { get; private set; }
    public bool IsAcknowledged { get; private set; } = false;
    public string? AcknowledgedBy { get; private set; }
    public string? AcknowledgedAt { get; private set; }

    private Alarm() { }

    public static Alarm Create(
        string severity,
        string source,
        string message,
        string? deviceId = null)
    {
        return new Alarm
        {
            Id = Guid.NewGuid().ToString("N"),
            Severity = severity,
            Source = source,
            Message = message,
            DeviceId = deviceId
        };
    }

    public void Acknowledge(string user)
    {
        IsAcknowledged = true;
        AcknowledgedBy = user;
        AcknowledgedAt = DateTime.UtcNow.ToString("o");
    }
}
