using ND.SharedKernel.Primitives;

namespace ND.ProjectionService.Domain.Entities;

public sealed class DeviceStatus : Entity
{
    public string DeviceId { get; private set; } = default!;
    public string DeviceType { get; private set; } = default!;
    public bool IsOnline { get; private set; }
    public string LastSeenAt { get; private set; } = default!;

    private DeviceStatus() { }

    public static DeviceStatus Create(
        string deviceId,
        string deviceType,
        bool isOnline,
        string lastSeenAt)
    {
        return new DeviceStatus
        {
            Id = deviceId,
            DeviceId = deviceId,
            DeviceType = deviceType,
            IsOnline = isOnline,
            LastSeenAt = lastSeenAt
        };
    }

    public void UpdateStatus(bool isOnline, string lastSeenAt)
    {
        IsOnline = isOnline;
        LastSeenAt = lastSeenAt;
    }
}
