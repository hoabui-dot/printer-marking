namespace ND.JobEngine.Application.Dtos;

public record JobDto(
    string Id,
    string JobNo,
    string SourceSystem,
    string JobType,
    string CurrentStatus,
    string ProductCode,
    string? ProductSerial,
    int Priority,
    string CreatedAt,
    string? CompletedAt
);

public record JobAttemptDto(
    string Id,
    string JobId,
    int AttemptNo,
    string TriggerType,
    string? TriggeredByUserId,
    string ResultStatus,
    string StartedAt,
    string? FinishedAt,
    string? ErrorMessage
);

public record JobHistoryDto(
    string Id,
    string JobId,
    string? AttemptId,
    string OldStatus,
    string NewStatus,
    string ActionName,
    string PerformedBy,
    string? Note,
    string CreatedAt
);

public record OverwriteRequestDto(
    string Id,
    string JobId,
    string OverwriteType,
    string Reason,
    string RequestedBy,
    string? ApprovedBy,
    string Status,
    string RequestedAt,
    string? ResolvedAt
);
