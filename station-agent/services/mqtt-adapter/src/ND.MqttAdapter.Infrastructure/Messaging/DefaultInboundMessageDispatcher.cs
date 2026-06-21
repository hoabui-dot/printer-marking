using System.Linq;
using System.Text.Json;
using FluentValidation;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ND.MqttAdapter.Application.Interfaces;
using ND.MqttAdapter.Infrastructure.Options;
using ND.SharedKernel.Abstractions;
using ND.UnifiedContracts.Constants;
using ND.UnifiedContracts.Events;
using ND.UnifiedContracts.Validation;

namespace ND.MqttAdapter.Infrastructure.Messaging;

/// <summary>
/// Validates and routes inbound MQTT messages by topic pattern.
///
/// Responsibility (after RabbitMQ refactor):
///   - Deserialize and validate the UnifiedEvent payload (schema + business rules)
///   - Enforce EdgeId matching and idempotency (via Redis)
///   - Log warnings for bad-quality tags
///   - Return after validation — downstream processing is handled by the outbox poller
///
/// The caller (ProcessInboundMessageHandler) is responsible for persisting
/// the MqttOutboxEvent. This dispatcher no longer calls the Job Engine directly.
/// </summary>
public sealed class DefaultInboundMessageDispatcher : IInboundMessageDispatcher
{
    private readonly ILogger<DefaultInboundMessageDispatcher> _logger;
    private readonly IIdempotencyService _idempotency;
    private readonly MqttOptions _options;
    private readonly UnifiedEventValidator _validator;

    public DefaultInboundMessageDispatcher(
        ILogger<DefaultInboundMessageDispatcher> logger,
        IIdempotencyService idempotency,
        IOptions<MqttOptions> options)
    {
        _logger = logger;
        _idempotency = idempotency;
        _options = options.Value;
        _validator = new UnifiedEventValidator();
    }

    public async Task DispatchAsync(
        string topic,
        string payloadJson,
        CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Dispatching inbound message for topic: {Topic}", topic);

        // nd/{site}/{edge_id}/command — primary topic format
        var isCommandTopic = topic.StartsWith("nd/", StringComparison.OrdinalIgnoreCase)
                          && topic.EndsWith("/command", StringComparison.OrdinalIgnoreCase);

        // station/{stationId}/job/create — legacy fallback
        var isLegacyTopic = topic.EndsWith("/job/create", StringComparison.OrdinalIgnoreCase);

        if (isCommandTopic || isLegacyTopic)
        {
            await ValidateCommandMessageAsync(topic, payloadJson, cancellationToken);
        }
        else
        {
            _logger.LogWarning("No handler registered for topic: {Topic}", topic);
        }
    }

    // ────────────────────────────────────────────────────────────────────────
    // Private helpers
    // ────────────────────────────────────────────────────────────────────────

    private async Task ValidateCommandMessageAsync(
        string topic,
        string payloadJson,
        CancellationToken cancellationToken)
    {
        _logger.LogInformation("Validating command message from topic: {Topic}", topic);

        // 1. Deserialize
        UnifiedEvent? unifiedEvent;
        try
        {
            unifiedEvent = JsonSerializer.Deserialize<UnifiedEvent>(payloadJson,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        }
        catch (JsonException ex)
        {
            _logger.LogError(ex, "Failed to deserialize JSON payload on topic {Topic}", topic);
            throw new ValidationException($"Malformed JSON payload: {ex.Message}");
        }

        if (unifiedEvent is null)
            throw new ValidationException("Parsed UnifiedEvent was null.");

        // 2. Schema validation (FluentValidation)
        var validationResult = await _validator.ValidateAsync(unifiedEvent, cancellationToken);
        if (!validationResult.IsValid)
        {
            var errors = string.Join("; ", validationResult.Errors.Select(e => e.ErrorMessage));
            _logger.LogError("UnifiedEvent validation failed: {Errors}", errors);
            throw new ValidationException(validationResult.Errors);
        }

        // 3. EdgeId must match local station
        if (!string.Equals(unifiedEvent.EdgeId, _options.StationId, StringComparison.OrdinalIgnoreCase))
        {
            _logger.LogWarning(
                "Ignoring command — EdgeId '{EdgeId}' does not match local StationId '{LocalStationId}'",
                unifiedEvent.EdgeId, _options.StationId);
            return;
        }

        // 4. Idempotency — drop duplicates (deduplicated on EventId)
        var eventIdKey = $"idempotency:event:{unifiedEvent.EventId}";
        var isEventNew = await _idempotency.TryRegisterAsync(
            eventIdKey, TimeSpan.FromHours(24), cancellationToken);

        if (!isEventNew)
        {
            _logger.LogWarning(
                "Discarding duplicate event with EventId '{EventId}'", unifiedEvent.EventId);
            return;
        }

        // 5. Quality warnings
        foreach (var tag in unifiedEvent.Data)
        {
            if (string.Equals(tag.Quality, "BAD", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(tag.Quality, "MISSING", StringComparison.OrdinalIgnoreCase))
            {
                _logger.LogWarning(
                    "Tag '{Tag}' has low quality indicator: '{Quality}'", tag.Tag, tag.Quality);
            }
        }

        // 6. Validate operation.type is present and known
        var opTypeTag = unifiedEvent.Data.FirstOrDefault(t =>
            string.Equals(t.Tag, BusinessConstants.MqttTag.OperationType, StringComparison.OrdinalIgnoreCase));

        if (opTypeTag is null)
            throw new ValidationException($"Missing mandatory tag '{BusinessConstants.MqttTag.OperationType}'");

        var opType = opTypeTag.Value?.ToString();
        if (string.IsNullOrEmpty(opType) || !BusinessConstants.ProductionOperation.IsValid(opType))
            throw new ValidationException($"Invalid or unknown operation.type: '{opType}'");

        _logger.LogInformation(
            "Command validation passed — topic={Topic} eventId={EventId} opType={OpType}. " +
            "Outbox event will be published to RabbitMQ by the outbox poller.",
            topic, unifiedEvent.EventId, opType);
    }
}
