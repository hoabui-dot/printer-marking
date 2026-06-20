using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ND.MqttAdapter.Application.Interfaces;
using ND.MqttAdapter.Infrastructure.Options;
using ND.SharedKernel.Abstractions;

namespace ND.MqttAdapter.Infrastructure.Messaging;

/// <summary>
/// Background worker that polls mqtt_outbox_events and publishes pending events to MQTT.
/// Implements the outbox pattern processor — runs every N seconds.
/// </summary>
public sealed class OutboxProcessorWorker : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IMqttPublisher _publisher;
    private readonly MqttOptions _options;
    private readonly ILogger<OutboxProcessorWorker> _logger;

    public OutboxProcessorWorker(
        IServiceScopeFactory scopeFactory,
        IMqttPublisher publisher,
        IOptions<MqttOptions> options,
        ILogger<OutboxProcessorWorker> logger)
    {
        _scopeFactory = scopeFactory;
        _publisher = publisher;
        _options = options.Value;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Outbox processor started. Interval: {Interval}s", _options.OutboxIntervalSeconds);

        while (!stoppingToken.IsCancellationRequested)
        {
            await ProcessBatchAsync(stoppingToken);
            await Task.Delay(TimeSpan.FromSeconds(_options.OutboxIntervalSeconds), stoppingToken);
        }
    }

    private async Task ProcessBatchAsync(CancellationToken cancellationToken)
    {
        using var scope = _scopeFactory.CreateScope();
        var outboxRepository = scope.ServiceProvider.GetRequiredService<IMqttOutboxRepository>();
        var unitOfWork = scope.ServiceProvider.GetRequiredService<IUnitOfWork>();

        var pending = await outboxRepository.GetPendingAsync(_options.OutboxBatchSize, cancellationToken);

        foreach (var outboxEvent in pending)
        {
            try
            {
                await _publisher.PublishAsync(outboxEvent.Topic, outboxEvent.PayloadJson, cancellationToken);
                outboxEvent.MarkPublished();
                _logger.LogInformation(
                    "Outbox event {EventType} for {AggregateType}/{AggregateId} published",
                    outboxEvent.EventType, outboxEvent.AggregateType, outboxEvent.AggregateId);
            }
            catch (Exception ex)
            {
                outboxEvent.MarkFailed();
                _logger.LogError(ex,
                    "Failed to publish outbox event {EventType}. Retry count: {RetryCount}",
                    outboxEvent.EventType, outboxEvent.RetryCount);
            }

            await outboxRepository.UpdateAsync(outboxEvent, cancellationToken);
        }

        if (pending.Count > 0)
            await unitOfWork.SaveChangesAsync(cancellationToken);
    }
}
