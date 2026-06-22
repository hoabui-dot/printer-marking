namespace ND.ProjectionService.Application.Dtos;

public record ProductionViewDto(
    string StationId,
    string JobId,
    string WorkOrderNo,
    string ProductCode,
    string? ProductSerial,
    string JobStatus,
    string UpdatedAt);

public record ActivityLogDto(
    string Id,
    string EventType,
    string JobId,
    string JobNo,
    string ProductCode,
    string Status,
    string Message,
    string OccurredAt);

public record DeviceStatusDto(
    string DeviceId,
    string DeviceType,
    bool IsOnline,
    string LastSeenAt);

public record ProductionRecordDto(
    string Id,
    string JobId,
    string JobNo,
    string ProductCode,
    string? ProductSerial,
    string JobType,
    string CurrentStatus,
    string StationId,
    string CreatedAt,
    string UpdatedAt);

public record PagedResult<T>(
    IReadOnlyList<T> Items,
    int TotalCount,
    int Page,
    int PageSize)
{
    public int TotalPages => (int)Math.Ceiling((double)TotalCount / PageSize);
}

