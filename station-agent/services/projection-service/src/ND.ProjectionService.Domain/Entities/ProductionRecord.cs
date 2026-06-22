using ND.SharedKernel.Primitives;

namespace ND.ProjectionService.Domain.Entities;

/// <summary>
/// Materialized read-model that tracks one production request as a single row.
/// Upserted by JobId from multiple incoming events (MqttReceived → Queued → Processing → Completed/Failed).
/// </summary>
public sealed class ProductionRecord : Entity
{
    public string JobId { get; private set; } = default!;
    public string JobNo { get; private set; } = default!;           // Work Order
    public string ProductCode { get; private set; } = default!;
    public string? ProductSerial { get; private set; }
    public string JobType { get; private set; } = default!;
    public string CurrentStatus { get; private set; } = "RECEIVED";
    public string StationId { get; private set; } = default!;
    public string UpdatedAt { get; private set; } = default!;

    private ProductionRecord() { }

    public static ProductionRecord Create(
        string jobId,
        string jobNo,
        string productCode,
        string? productSerial,
        string jobType,
        string stationId,
        string status = "RECEIVED")
    {
        var now = DateTimeOffset.UtcNow.ToString("o");
        return new ProductionRecord
        {
            JobId = jobId,
            JobNo = jobNo,
            ProductCode = productCode,
            ProductSerial = productSerial,
            JobType = jobType,
            StationId = stationId,
            CurrentStatus = status,
            CreatedAt = now,
            UpdatedAt = now
        };
    }

    public void UpdateStatus(string newStatus)
    {
        CurrentStatus = newStatus;
        UpdatedAt = DateTimeOffset.UtcNow.ToString("o");
    }

    public void UpdateJobId(string jobId)
    {
        JobId = jobId;
        UpdatedAt = DateTimeOffset.UtcNow.ToString("o");
    }

    public void UpdateDetails(string jobId, string jobNo, string productCode, string? productSerial, string status)
    {
        JobId = jobId;
        JobNo = jobNo;
        ProductCode = productCode;
        ProductSerial = productSerial;
        CurrentStatus = status;
        UpdatedAt = DateTimeOffset.UtcNow.ToString("o");
    }
}
