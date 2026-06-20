using System.Text.Json;
using FluentValidation;
using Microsoft.Extensions.Logging;
using ND.MqttAdapter.Application.Interfaces;
using ND.SharedKernel.Serialization;
using ND.UnifiedContracts.Events;
using ND.UnifiedContracts.Validation;

namespace ND.MqttAdapter.Infrastructure.Messaging;

/// <summary>
/// Validates every outbound event against UnifiedEventValidator before publishing.
/// Rejects invalid payloads — never silently forwards a malformed event.
/// </summary>
public sealed class UnifiedEventPublisher : IUnifiedEventPublisher
{
    private readonly IMqttPublisher _mqttPublisher;
    private readonly UnifiedEventValidator _validator;
    private readonly ILogger<UnifiedEventPublisher> _logger;

    public UnifiedEventPublisher(
        IMqttPublisher mqttPublisher,
        ILogger<UnifiedEventPublisher> logger)
    {
        _mqttPublisher = mqttPublisher;
        _validator = new UnifiedEventValidator();
        _logger = logger;
    }

    public async Task PublishAsync(
        string topic,
        UnifiedEvent unifiedEvent,
        CancellationToken cancellationToken = default)
    {
        // Strict validation — reject before publish
        var result = await _validator.ValidateAsync(unifiedEvent, cancellationToken);
        if (!result.IsValid)
        {
            var errors = string.Join("; ", result.Errors.Select(e => e.ErrorMessage));
            _logger.LogError(
                "UnifiedEvent validation failed for EventId={EventId}: {Errors}",
                unifiedEvent.EventId, errors);
            throw new ValidationException(result.Errors);
        }

        var payload = JsonSerializer.Serialize(unifiedEvent, JsonOptions.Default);
        await _mqttPublisher.PublishAsync(topic, payload, cancellationToken);

        _logger.LogInformation(
            "Unified event published: EventId={EventId}, Topic={Topic}",
            unifiedEvent.EventId, topic);
    }
}
