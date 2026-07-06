using ND.SharedKernel.Primitives;

namespace ND.ProjectionService.Domain.Entities;

public sealed class DeviceStatus : Entity
{
    public string DeviceId { get; private set; } = default!;
    public string DeviceType { get; private set; } = default!;
    public bool IsOnline { get; private set; }
    public string LastSeenAt { get; private set; } = default!;
    public string LifecycleState { get; private set; } = "Offline";

    private DeviceStatus() { }

    public static DeviceStatus Create(
        string deviceId,
        string deviceType,
        bool isOnline,
        string lastSeenAt,
        string lifecycleState = "Offline")
    {
        return new DeviceStatus
        {
            Id = deviceId,
            DeviceId = deviceId,
            DeviceType = deviceType,
            IsOnline = isOnline,
            LastSeenAt = lastSeenAt,
            LifecycleState = lifecycleState
        };
    }

    public void UpdateStatus(bool isOnline, string lastSeenAt, string lifecycleState)
    {
        IsOnline = isOnline;
        LastSeenAt = lastSeenAt;
        LifecycleState = lifecycleState;
    }
}
