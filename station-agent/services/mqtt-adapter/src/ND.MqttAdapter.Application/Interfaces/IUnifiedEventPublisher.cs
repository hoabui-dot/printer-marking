using ND.UnifiedContracts.Events;

namespace ND.MqttAdapter.Application.Interfaces;

/// <summary>
/// Publishes events strictly following the ND Unified Event Protocol.
/// Validates the event before publishing; throws if invalid.
/// </summary>
public interface IUnifiedEventPublisher
{
    Task PublishAsync(string topic, UnifiedEvent unifiedEvent, CancellationToken cancellationToken = default);
}
