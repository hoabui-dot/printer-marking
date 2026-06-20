namespace ND.MqttAdapter.Infrastructure.Options;

public sealed class MqttOptions
{
    public const string SectionName = "Mqtt";

    public string StationId { get; set; } = "STATION-01";
    public string BrokerHost { get; set; } = "localhost";
    public int BrokerPort { get; set; } = 1883;
    public bool UseTls { get; set; } = false;
    public string? Username { get; set; }
    public string? Password { get; set; }
    public string[] SubscribeTopics { get; set; } = [];
    public int OutboxBatchSize { get; set; } = 10;
    public int OutboxIntervalSeconds { get; set; } = 5;
}
