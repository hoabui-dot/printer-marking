using System.Text.Json.Serialization;

namespace ND.UnifiedContracts.Events;

/// <summary>
/// Base record shared by all Job Engine domain events.
/// Consumers can deserialise to this type to inspect <see cref="EventType"/>
/// before deciding which specific event to map to.
/// </summary>
public record JobEventBase
{
    [JsonPropertyName("event_type")]
    public required string EventType { get; init; }

    [JsonPropertyName("event_id")]
    public required string EventId { get; init; }

    [JsonPropertyName("job_id")]
    public required string JobId { get; init; }

    [JsonPropertyName("job_no")]
    public required string JobNo { get; init; }

    [JsonPropertyName("job_type")]
    public required string JobType { get; init; }

    [JsonPropertyName("product_code")]
    public required string ProductCode { get; init; }

    [JsonPropertyName("product_serial")]
    public string? ProductSerial { get; init; }

    [JsonPropertyName("status")]
    public required string Status { get; init; }

    [JsonPropertyName("source_system")]
    public required string SourceSystem { get; init; }

    [JsonPropertyName("timestamp")]
    public required string Timestamp { get; init; }
}

/// <summary>
/// Published when a new Job is created in the Job Engine.
/// RabbitMQ routing key: <c>job.created</c>
/// </summary>
public sealed record JobCreatedEvent : JobEventBase
{
    public static JobCreatedEvent From(
        string jobId,
        string jobNo,
        string jobType,
        string productCode,
        string? productSerial,
        string sourceSystem)
    {
        return new JobCreatedEvent
        {
            EventType = "JobCreated",
            EventId = $"evt-job-created-{Guid.NewGuid():N}",
            JobId = jobId,
            JobNo = jobNo,
            JobType = jobType,
            ProductCode = productCode,
            ProductSerial = productSerial,
            Status = "CREATED",
            SourceSystem = sourceSystem,
            Timestamp = DateTimeOffset.UtcNow.ToString("o")
        };
    }
}

/// <summary>
/// Published when a Job starts processing (attempt begins).
/// RabbitMQ routing key: <c>job.processing</c>
/// </summary>
public sealed record JobProcessingEvent : JobEventBase
{
    [JsonPropertyName("attempt_no")]
    public int AttemptNo { get; init; }

    public static JobProcessingEvent From(
        string jobId,
        string jobNo,
        string jobType,
        string productCode,
        string? productSerial,
        string sourceSystem,
        int attemptNo)
    {
        return new JobProcessingEvent
        {
            EventType = "JobProcessing",
            EventId = $"evt-job-processing-{Guid.NewGuid():N}",
            JobId = jobId,
            JobNo = jobNo,
            JobType = jobType,
            ProductCode = productCode,
            ProductSerial = productSerial,
            Status = "PROCESSING",
            SourceSystem = sourceSystem,
            Timestamp = DateTimeOffset.UtcNow.ToString("o"),
            AttemptNo = attemptNo
        };
    }
}

/// <summary>
/// Published when a Job completes successfully.
/// RabbitMQ routing key: <c>job.completed</c>
/// </summary>
public sealed record JobCompletedEvent : JobEventBase
{
    [JsonPropertyName("completed_at")]
    public required string CompletedAt { get; init; }

    public static JobCompletedEvent From(
        string jobId,
        string jobNo,
        string jobType,
        string productCode,
        string? productSerial,
        string sourceSystem)
    {
        var now = DateTimeOffset.UtcNow.ToString("o");
        return new JobCompletedEvent
        {
            EventType = "JobCompleted",
            EventId = $"evt-job-completed-{Guid.NewGuid():N}",
            JobId = jobId,
            JobNo = jobNo,
            JobType = jobType,
            ProductCode = productCode,
            ProductSerial = productSerial,
            Status = "COMPLETED",
            SourceSystem = sourceSystem,
            Timestamp = now,
            CompletedAt = now
        };
    }
}

/// <summary>
/// Published when a Job fails permanently.
/// RabbitMQ routing key: <c>job.failed</c>
/// </summary>
public sealed record JobFailedEvent : JobEventBase
{
    [JsonPropertyName("error_message")]
    public string? ErrorMessage { get; init; }

    public static JobFailedEvent From(
        string jobId,
        string jobNo,
        string jobType,
        string productCode,
        string? productSerial,
        string sourceSystem,
        string? errorMessage = null)
    {
        return new JobFailedEvent
        {
            EventType = "JobFailed",
            EventId = $"evt-job-failed-{Guid.NewGuid():N}",
            JobId = jobId,
            JobNo = jobNo,
            JobType = jobType,
            ProductCode = productCode,
            ProductSerial = productSerial,
            Status = "FAILED",
            SourceSystem = sourceSystem,
            Timestamp = DateTimeOffset.UtcNow.ToString("o"),
            ErrorMessage = errorMessage
        };
    }
}

/// <summary>
/// Published when a printer completes a print job.
/// RabbitMQ routing key: <c>printer.printed</c>
/// </summary>
public sealed record PrinterPrintedEvent
{
    [JsonPropertyName("event_type")]
    public string EventType { get; init; } = "PrinterPrinted";

    [JsonPropertyName("event_id")]
    public required string EventId { get; init; }

    [JsonPropertyName("job_id")]
    public required string JobId { get; init; }

    [JsonPropertyName("job_no")]
    public required string JobNo { get; init; }

    [JsonPropertyName("printer_code")]
    public required string PrinterCode { get; init; }

    [JsonPropertyName("success")]
    public required bool Success { get; init; }

    [JsonPropertyName("error_message")]
    public string? ErrorMessage { get; init; }

    [JsonPropertyName("timestamp")]
    public required string Timestamp { get; init; }
}

/// <summary>
/// Published when a laser adapter completes a mark job.
/// RabbitMQ routing key: <c>laser.marked</c>
/// </summary>
public sealed record LaserMarkedEvent
{
    [JsonPropertyName("event_type")]
    public string EventType { get; init; } = "LaserMarked";

    [JsonPropertyName("event_id")]
    public required string EventId { get; init; }

    [JsonPropertyName("job_id")]
    public required string JobId { get; init; }

    [JsonPropertyName("job_no")]
    public required string JobNo { get; init; }

    [JsonPropertyName("laser_code")]
    public required string LaserCode { get; init; }

    [JsonPropertyName("success")]
    public required bool Success { get; init; }

    [JsonPropertyName("error_message")]
    public string? ErrorMessage { get; init; }

    [JsonPropertyName("duration_ms")]
    public int DurationMs { get; init; }

    [JsonPropertyName("timestamp")]
    public required string Timestamp { get; init; }
}

/// <summary>
/// Routing key constants for Job domain events.
/// </summary>
public static class JobEventRoutingKeys
{
    public const string Created = "job.created";
    public const string Processing = "job.processing";
    public const string Completed = "job.completed";
    public const string Failed = "job.failed";
    public const string PrinterPrinted = "printer.printed";
    public const string LaserMarked = "laser.marked";
}
