namespace ND.MqttAdapter.Application.Interfaces;

public interface IMqttPublisher
{
    Task PublishAsync(string topic, string payloadJson, CancellationToken cancellationToken = default);
}
