using ND.SharedKernel.Primitives;

namespace ND.MqttAdapter.Domain.Entities;

/// <summary>
/// Outbox pattern: events queued for MQTT publish.
/// Table: mqtt_outbox_events
/// </summary>
public sealed class MqttOutboxEvent : Entity
{
    public string AggregateType { get; private set; } = default!;
    public string AggregateId { get; private set; } = default!;
    public string EventType { get; private set; } = default!;
    public string PayloadJson { get; private set; } = default!;
    public string Topic { get; private set; } = default!;
    public string Status { get; private set; } = "PENDING";   // PENDING / PUBLISHED / FAILED
    public int RetryCount { get; private set; } = 0;
    public string? NextRetryAt { get; private set; }
    public string? PublishedAt { get; private set; }

    private MqttOutboxEvent() { }

    public static MqttOutboxEvent Create(
        string aggregateType,
        string aggregateId,
        string eventType,
        string payloadJson,
        string topic)
    {
        return new MqttOutboxEvent
        {
            AggregateType = aggregateType,
            AggregateId = aggregateId,
            EventType = eventType,
            PayloadJson = payloadJson,
            Topic = topic
        };
    }

    public void MarkPublished()
    {
        Status = "PUBLISHED";
        PublishedAt = DateTime.UtcNow.ToString("o");
    }

    public void MarkFailed(int maxRetryDelaySec = 30)
    {
        RetryCount++;
        Status = RetryCount >= 5 ? "FAILED" : "PENDING";
        var delaySeconds = Math.Min(maxRetryDelaySec * RetryCount, 300);
        NextRetryAt = DateTime.UtcNow.AddSeconds(delaySeconds).ToString("o");
    }
}
