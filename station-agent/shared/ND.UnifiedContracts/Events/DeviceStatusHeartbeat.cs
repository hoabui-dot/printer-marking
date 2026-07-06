namespace ND.UnifiedContracts.Events;

public sealed record DeviceStatusHeartbeat(
    string DeviceId,
    string DeviceType,
    bool IsOnline,
    string LifecycleState,
    string Timestamp
);
