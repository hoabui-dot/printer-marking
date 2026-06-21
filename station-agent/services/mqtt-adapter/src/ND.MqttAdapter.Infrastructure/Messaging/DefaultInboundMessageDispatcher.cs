using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using FluentValidation;
using Microsoft.Extensions.Configuration;
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
/// Routes inbound MQTT messages to appropriate handlers by topic pattern.
/// Implements business validation rules for the Print-Marking Edge Station.
/// </summary>
public sealed class DefaultInboundMessageDispatcher : IInboundMessageDispatcher
{
    private readonly ILogger<DefaultInboundMessageDispatcher> _logger;
    private readonly IIdempotencyService _idempotency;
    private readonly MqttOptions _options;
    private readonly IConfiguration _configuration;
    private readonly UnifiedEventValidator _validator;
    private static readonly HttpClient HttpClient = new();

    public DefaultInboundMessageDispatcher(
        ILogger<DefaultInboundMessageDispatcher> logger,
        IIdempotencyService idempotency,
        IOptions<MqttOptions> options,
        IConfiguration configuration)
    {
        _logger = logger;
        _idempotency = idempotency;
        _options = options.Value;
        _configuration = configuration;
        _validator = new UnifiedEventValidator();
    }

    public async Task DispatchAsync(string topic, string payloadJson, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Dispatching message for topic: {Topic}", topic);

        // Under requirement2, topic structure is "nd/{site}/{edge_id}/command"
        var isCommandTopic = topic.StartsWith("nd/", StringComparison.OrdinalIgnoreCase) && 
                             topic.EndsWith("/command", StringComparison.OrdinalIgnoreCase);

        // Also fallback to the old topic "station/{stationId}/job/create"
        var isLegacyTopic = topic.EndsWith("/job/create", StringComparison.OrdinalIgnoreCase);

        if (isCommandTopic || isLegacyTopic)
        {
            await HandleCommandMessageAsync(topic, payloadJson, cancellationToken);
        }
        else
        {
            _logger.LogWarning("No handler registered for topic: {Topic}", topic);
        }
    }

    private async Task HandleCommandMessageAsync(string topic, string payloadJson, CancellationToken cancellationToken)
    {
        _logger.LogInformation("Processing command message from topic: {Topic}", topic);

        // 1. JSON Schema Validation / Deserialization
        UnifiedEvent? unifiedEvent;
        try
        {
            unifiedEvent = JsonSerializer.Deserialize<UnifiedEvent>(payloadJson, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            });
        }
        catch (JsonException ex)
        {
            _logger.LogError(ex, "Failed to deserialize JSON payload on topic {Topic}", topic);
            throw new ValidationException($"Malformed JSON payload: {ex.Message}");
        }

        if (unifiedEvent == null)
        {
            throw new ValidationException("Parsed UnifiedEvent was null.");
        }

        // Run FluentValidation rules
        var validationResult = await _validator.ValidateAsync(unifiedEvent, cancellationToken);
        if (!validationResult.IsValid)
        {
            var errors = string.Join("; ", validationResult.Errors.Select(e => e.ErrorMessage));
            _logger.LogError("UnifiedEvent validation failed: {Errors}", errors);
            throw new ValidationException(validationResult.Errors);
        }

        // 2. Check edge_id matches local station identifier
        if (!string.Equals(unifiedEvent.EdgeId, _options.StationId, StringComparison.OrdinalIgnoreCase))
        {
            _logger.LogWarning("Ignoring command with EdgeId '{EdgeId}' (does not match local StationId '{LocalStationId}')", 
                unifiedEvent.EdgeId, _options.StationId);
            return;
        }

        // 3. Check event_id uniqueness using Redis idempotency
        var eventIdIdempotencyKey = $"idempotency:event:{unifiedEvent.EventId}";
        var isEventNew = await _idempotency.TryRegisterAsync(eventIdIdempotencyKey, TimeSpan.FromHours(24), cancellationToken);
        if (!isEventNew)
        {
            _logger.LogWarning("Discarding duplicate event with EventId '{EventId}'", unifiedEvent.EventId);
            return;
        }

        // 4. Validate quality — log warning if BAD or MISSING
        foreach (var tag in unifiedEvent.Data)
        {
            if (string.Equals(tag.Quality, "BAD", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(tag.Quality, "MISSING", StringComparison.OrdinalIgnoreCase))
            {
                _logger.LogWarning("Tag '{Tag}' has low quality indicator: '{Quality}'", tag.Tag, tag.Quality);
            }
        }

        // 5. Parse operation.type
        var opTypeTag = unifiedEvent.Data.FirstOrDefault(t => string.Equals(t.Tag, BusinessConstants.MqttTag.OperationType, StringComparison.OrdinalIgnoreCase));
        if (opTypeTag == null)
        {
            throw new ValidationException($"Missing mandatory tag '{BusinessConstants.MqttTag.OperationType}'");
        }

        var opType = opTypeTag.Value?.ToString();
        if (string.IsNullOrEmpty(opType) || !BusinessConstants.ProductionOperation.IsValid(opType))
        {
            throw new ValidationException($"Invalid or unknown operation.type: '{opType}'");
        }

        // 6. Forward as Job creation event (Emit internal event via POSTing to Job Engine)
        var jobEngineUrl = _configuration["JobEngineUrl"] ?? "http://localhost:5002";
        _logger.LogInformation("Forwarding job to Job Engine at: {Url}", jobEngineUrl);

        var tagsDict = unifiedEvent.Data.ToDictionary(t => t.Tag, t => t.Value?.ToString() ?? "", StringComparer.OrdinalIgnoreCase);
        
        // Resolve product identification
        var productCode = tagsDict.TryGetValue(BusinessConstants.MqttTag.ProductId, out var pidVal) ? pidVal : 
                          tagsDict.TryGetValue(BusinessConstants.MqttTag.MarkingSerial, out var serialVal) ? serialVal : 
                          "GENERIC_PRODUCT";
        var productSerial = tagsDict.TryGetValue(BusinessConstants.MqttTag.MarkingSerial, out var sVal) ? sVal : 
                            tagsDict.TryGetValue(BusinessConstants.MqttTag.ProductId, out var pVal) ? pVal : null;

        var createJobCommand = new
        {
            JobNo = unifiedEvent.EventId,
            SourceSystem = "MQTT_ADAPTER",
            JobType = opType,
            ProductCode = productCode,
            IdempotencyKey = unifiedEvent.EventId,
            PayloadJson = payloadJson,
            ProductSerial = productSerial,
            Priority = 0
        };

        try
        {
            var response = await HttpClient.PostAsJsonAsync($"{jobEngineUrl}/api/jobs", createJobCommand, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                var errorContent = await response.Content.ReadAsStringAsync(cancellationToken);
                _logger.LogError("Failed to create job in Job Engine. Status={Status}, Response={Response}", 
                    response.StatusCode, errorContent);
                throw new Exception($"Job Engine rejected job creation: {response.StatusCode} - {errorContent}");
            }

            var createdJob = await response.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: cancellationToken);
            var jobId = createdJob.GetProperty("id").GetString();
            _logger.LogInformation("Successfully registered job in Job Engine: {JobId}", jobId);

            // Emit one internal event per valid inbound message: trigger processing!
            var processResponse = await HttpClient.PostAsync($"{jobEngineUrl}/api/jobs/{jobId}/process", null, cancellationToken);
            if (!processResponse.IsSuccessStatusCode)
            {
                var errorContent = await processResponse.Content.ReadAsStringAsync(cancellationToken);
                _logger.LogError("Failed to trigger job processing in Job Engine. Status={Status}, Response={Response}", 
                    processResponse.StatusCode, errorContent);
                throw new Exception($"Job Engine failed to process job: {processResponse.StatusCode} - {errorContent}");
            }

            _logger.LogInformation("Successfully triggered processing for Job {JobId}", jobId);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to forward command to Job Engine");
            throw;
        }
    }
}
