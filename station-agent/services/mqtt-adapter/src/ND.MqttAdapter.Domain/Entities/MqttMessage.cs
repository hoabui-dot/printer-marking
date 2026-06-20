using ND.SharedKernel.Primitives;

namespace ND.MqttAdapter.Domain.Entities;

/// <summary>
/// Persisted record of every MQTT message received or sent.
/// Table: mqtt_messages
/// </summary>
public sealed class MqttMessage : Entity
{
    public string MessageId { get; private set; } = default!;
    public string Topic { get; private set; } = default!;
    public string PayloadJson { get; private set; } = default!;
    public string Direction { get; private set; } = default!;   // INBOUND / OUTBOUND
    public string Status { get; private set; } = "RECEIVED";    // RECEIVED / PROCESSED / FAILED
    public string ReceivedAt { get; private set; } = DateTime.UtcNow.ToString("o");
    public string? ProcessedAt { get; private set; }
    public string? ErrorMessage { get; private set; }

    private MqttMessage() { }

    public static MqttMessage CreateInbound(string messageId, string topic, string payloadJson)
    {
        return new MqttMessage
        {
            MessageId = messageId,
            Topic = topic,
            PayloadJson = payloadJson,
            Direction = "INBOUND",
            Status = "RECEIVED",
            ReceivedAt = DateTime.UtcNow.ToString("o")
        };
    }

    public static MqttMessage CreateOutbound(string messageId, string topic, string payloadJson)
    {
        return new MqttMessage
        {
            MessageId = messageId,
            Topic = topic,
            PayloadJson = payloadJson,
            Direction = "OUTBOUND",
            Status = "PROCESSED",
            ReceivedAt = DateTime.UtcNow.ToString("o"),
            ProcessedAt = DateTime.UtcNow.ToString("o")
        };
    }

    public void MarkProcessed()
    {
        Status = "PROCESSED";
        ProcessedAt = DateTime.UtcNow.ToString("o");
    }

    public void MarkFailed(string error)
    {
        Status = "FAILED";
        ErrorMessage = error;
        ProcessedAt = DateTime.UtcNow.ToString("o");
    }
}
