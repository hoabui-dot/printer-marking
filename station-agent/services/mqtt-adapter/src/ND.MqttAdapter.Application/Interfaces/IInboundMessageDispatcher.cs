namespace ND.MqttAdapter.Application.Interfaces;

/// <summary>
/// Routes inbound MQTT messages to the appropriate handler based on topic.
/// </summary>
public interface IInboundMessageDispatcher
{
    Task DispatchAsync(string topic, string payloadJson, CancellationToken cancellationToken = default);
}
