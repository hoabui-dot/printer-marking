using Microsoft.Extensions.Logging;
using ND.MqttAdapter.Application.Interfaces;

namespace ND.MqttAdapter.Infrastructure.Messaging;

/// <summary>
/// Routes inbound MQTT messages to appropriate handlers by topic pattern.
/// Extend this with additional topic handlers as needed.
/// </summary>
public sealed class DefaultInboundMessageDispatcher : IInboundMessageDispatcher
{
    private readonly ILogger<DefaultInboundMessageDispatcher> _logger;

    public DefaultInboundMessageDispatcher(ILogger<DefaultInboundMessageDispatcher> logger)
    {
        _logger = logger;
    }

    public async Task DispatchAsync(string topic, string payloadJson, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Dispatching message for topic: {Topic}", topic);

        // Topic routing — extend with actual handlers per topic pattern
        if (topic.EndsWith("/job/create", StringComparison.OrdinalIgnoreCase))
        {
            await HandleJobCreateAsync(topic, payloadJson, cancellationToken);
        }
        else
        {
            _logger.LogWarning("No handler registered for topic: {Topic}", topic);
        }
    }

    private Task HandleJobCreateAsync(string topic, string payloadJson, CancellationToken cancellationToken)
    {
        // Forward to Job Engine Service via HTTP or internal queue
        // Implementation: POST to job-engine API with the payload
        _logger.LogInformation("Job create message received on {Topic}", topic);
        return Task.CompletedTask;
    }
}
