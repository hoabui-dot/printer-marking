using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ND.Infrastructure.Messaging;
using ND.MqttAdapter.Application.Interfaces;
using ND.MqttAdapter.Infrastructure.Options;
using ND.SharedKernel.Abstractions;

namespace ND.MqttAdapter.Infrastructure.Messaging;

/// <summary>
/// Background worker that polls <c>mqtt_outbox_events</c> and publishes
/// each PENDING event to the RabbitMQ topic exchange.
///
/// Exchange:    station.events  (topic exchange, durable)
/// Routing key: mqtt.{AggregateType}.{EventType}
///              e.g. "mqtt.MqttMessage.MqttMessageReceived"
///
/// Consumers (e.g. Job Engine) declare their own queues and bind to this
/// exchange using routing key patterns.
/// </summary>
public sealed class OutboxProcessorWorker : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IRabbitMqPublisher _rabbitMqPublisher;
    private readonly MqttOptions _options;
    private readonly ILogger<OutboxProcessorWorker> _logger;

    /// <summary>
    /// The topic exchange used for all outbox events.
    /// Consumers can bind queues to specific routing key patterns.
    /// </summary>
    private const string Exchange = "station.events";

    public OutboxProcessorWorker(
        IServiceScopeFactory scopeFactory,
        IRabbitMqPublisher rabbitMqPublisher,
        IOptions<MqttOptions> options,
        ILogger<OutboxProcessorWorker> logger)
    {
        _scopeFactory = scopeFactory;
        _rabbitMqPublisher = rabbitMqPublisher;
        _options = options.Value;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation(
            "Outbox processor started. Polling every {Interval}s → RabbitMQ exchange '{Exchange}'",
            _options.OutboxIntervalSeconds, Exchange);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ProcessBatchAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogError(ex, "Unhandled error in outbox processor batch. Will retry next cycle.");
            }

            await Task.Delay(
                TimeSpan.FromSeconds(_options.OutboxIntervalSeconds),
                stoppingToken);
        }
    }

    private async Task ProcessBatchAsync(CancellationToken cancellationToken)
    {
        using var scope = _scopeFactory.CreateScope();
        var outboxRepository = scope.ServiceProvider.GetRequiredService<IMqttOutboxRepository>();
        var unitOfWork = scope.ServiceProvider.GetRequiredService<IUnitOfWork>();

        var pending = await outboxRepository.GetPendingAsync(
            _options.OutboxBatchSize, cancellationToken);

        if (pending.Count == 0)
            return;

        _logger.LogDebug("Outbox processor: processing {Count} pending event(s)", pending.Count);

        foreach (var outboxEvent in pending)
        {
            // Routing key format: mqtt.<AggregateType>.<EventType>
            // Example:            mqtt.MqttMessage.MqttMessageReceived
            var routingKey = $"mqtt.{outboxEvent.AggregateType}.{outboxEvent.EventType}";

            try
            {
                await _rabbitMqPublisher.PublishAsync(
                    exchange: Exchange,
                    routingKey: routingKey,
                    messageJson: outboxEvent.PayloadJson,
                    cancellationToken: cancellationToken);

                outboxEvent.MarkPublished();

                _logger.LogInformation(
                    "Outbox event published → exchange={Exchange} routingKey={RoutingKey} " +
                    "aggregateId={AggregateId}",
                    Exchange, routingKey, outboxEvent.AggregateId);
            }
            catch (Exception ex)
            {
                outboxEvent.MarkFailed();

                _logger.LogError(ex,
                    "Failed to publish outbox event to RabbitMQ. " +
                    "routingKey={RoutingKey} retryCount={RetryCount} nextRetryAt={NextRetryAt}",
                    routingKey, outboxEvent.RetryCount, outboxEvent.NextRetryAt);
            }

            await outboxRepository.UpdateAsync(outboxEvent, cancellationToken);
        }

        await unitOfWork.SaveChangesAsync(cancellationToken);
    }
}
