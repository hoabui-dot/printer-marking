using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using ND.Infrastructure.Messaging;
using ND.ProjectionService.Application.Dtos;
using ND.ProjectionService.Application.Interfaces;
using ND.ProjectionService.Domain.Entities;
using ND.ProjectionService.Infrastructure.SignalR;
using ND.SharedKernel.Abstractions;
using ND.UnifiedContracts.Constants;
using ND.UnifiedContracts.Events;

namespace ND.ProjectionService.Infrastructure.Messaging;

/// <summary>
/// Background worker that consumes job and mqtt events from RabbitMQ,
/// updates the projection read model, and pushes updates to Kiosk UI via SignalR.
/// </summary>
public sealed class ProjectionEventConsumer : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IRabbitMqConsumer _consumer;
    private readonly IHubContext<ProductionHub> _hubContext;
    private readonly ILogger<ProjectionEventConsumer> _logger;
    private readonly string _stationId;

    private const string Exchange = "station.events";
    
    private const string JobQueue = "projection-service.job-events";
    private const string JobPattern = "job.*";

    private const string MqttQueue = "projection-service.mqtt-events";
    private const string MqttPattern = "mqtt.MqttMessage.*";

    private static readonly JsonSerializerOptions JsonSerializerOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public ProjectionEventConsumer(
        IServiceScopeFactory scopeFactory,
        IRabbitMqConsumer consumer,
        IHubContext<ProductionHub> hubContext,
        IConfiguration configuration,
        ILogger<ProjectionEventConsumer> logger)
    {
        _scopeFactory = scopeFactory;
        _consumer = consumer;
        _hubContext = hubContext;
        _logger = logger;
        _stationId = configuration["STATION_ID"] ?? "STATION-01";
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation(
            "Projection Event Consumer starting. StationId={StationId}", _stationId);

        // 1. Consume job events
        await _consumer.StartConsumingAsync(
            exchange: Exchange,
            queue: JobQueue,
            routingKeyPattern: JobPattern,
            onMessage: (routingKey, json) => HandleJobEventAsync(routingKey, json, stoppingToken),
            cancellationToken: stoppingToken);

        // 2. Consume MQTT inbound events
        await _consumer.StartConsumingAsync(
            exchange: Exchange,
            queue: MqttQueue,
            routingKeyPattern: MqttPattern,
            onMessage: (routingKey, json) => HandleMqttEventAsync(routingKey, json, stoppingToken),
            cancellationToken: stoppingToken);

        // Keep service alive
        await Task.Delay(Timeout.Infinite, stoppingToken).ConfigureAwait(false);
    }

    private async Task HandleJobEventAsync(string routingKey, string payloadJson, CancellationToken cancellationToken)
    {
        _logger.LogInformation("Projection Service received job event: {RoutingKey}", routingKey);

        try
        {
            using var scope = _scopeFactory.CreateScope();
            var productionRepo = scope.ServiceProvider.GetRequiredService<IProductionViewRepository>();
            var activityRepo = scope.ServiceProvider.GetRequiredService<IActivityLogRepository>();
            var unitOfWork = scope.ServiceProvider.GetRequiredService<IUnitOfWork>();

            ProductionView? view = null;
            ActivityLog? log = null;

            if (routingKey.Equals("job.created", StringComparison.OrdinalIgnoreCase))
            {
                var evt = JsonSerializer.Deserialize<JobCreatedEvent>(payloadJson, JsonSerializerOptions);
                if (evt != null)
                {
                    view = await productionRepo.GetByStationIdAsync(_stationId, cancellationToken);
                    if (view == null)
                    {
                        view = ProductionView.Create(_stationId, evt.JobId, evt.JobNo, evt.ProductCode, evt.ProductSerial, "QUEUED");
                        await productionRepo.AddAsync(view, cancellationToken);
                    }
                    else
                    {
                        view.Update(evt.JobId, evt.JobNo, evt.ProductCode, evt.ProductSerial, "QUEUED");
                        await productionRepo.UpdateAsync(view, cancellationToken);
                    }

                    log = ActivityLog.Create(
                        "JobCreated",
                        evt.JobId,
                        evt.JobNo,
                        evt.ProductCode,
                        "QUEUED",
                        $"Công việc {evt.JobNo} đã được tạo và đưa vào hàng đợi.",
                        evt.Timestamp);
                }
            }
            else if (routingKey.Equals("job.processing", StringComparison.OrdinalIgnoreCase))
            {
                var evt = JsonSerializer.Deserialize<JobProcessingEvent>(payloadJson, JsonSerializerOptions);
                if (evt != null)
                {
                    view = await productionRepo.GetByStationIdAsync(_stationId, cancellationToken);
                    if (view != null)
                    {
                        view.UpdateStatus("PROCESSING");
                        await productionRepo.UpdateAsync(view, cancellationToken);
                    }

                    log = ActivityLog.Create(
                        "JobProcessing",
                        evt.JobId,
                        evt.JobNo,
                        evt.ProductCode,
                        "PROCESSING",
                        $"Công việc {evt.JobNo} bắt đầu xử lý (lần thử #{evt.AttemptNo}).",
                        evt.Timestamp);
                }
            }
            else if (routingKey.Equals("job.completed", StringComparison.OrdinalIgnoreCase))
            {
                var evt = JsonSerializer.Deserialize<JobCompletedEvent>(payloadJson, JsonSerializerOptions);
                if (evt != null)
                {
                    view = await productionRepo.GetByStationIdAsync(_stationId, cancellationToken);
                    if (view != null)
                    {
                        view.UpdateStatus("COMPLETED");
                        await productionRepo.UpdateAsync(view, cancellationToken);
                    }

                    log = ActivityLog.Create(
                        "JobCompleted",
                        evt.JobId,
                        evt.JobNo,
                        evt.ProductCode,
                        "COMPLETED",
                        $"Công việc {evt.JobNo} đã hoàn thành thành công.",
                        evt.Timestamp);
                }
            }
            else if (routingKey.Equals("job.failed", StringComparison.OrdinalIgnoreCase))
            {
                var evt = JsonSerializer.Deserialize<JobFailedEvent>(payloadJson, JsonSerializerOptions);
                if (evt != null)
                {
                    view = await productionRepo.GetByStationIdAsync(_stationId, cancellationToken);
                    if (view != null)
                    {
                        view.UpdateStatus("FAILED");
                        await productionRepo.UpdateAsync(view, cancellationToken);
                    }

                    log = ActivityLog.Create(
                        "JobFailed",
                        evt.JobId,
                        evt.JobNo,
                        evt.ProductCode,
                        "FAILED",
                        $"Công việc {evt.JobNo} thất bại: {evt.ErrorMessage ?? "Lỗi không xác định"}.",
                        evt.Timestamp);
                }
            }

            if (log != null)
            {
                await activityRepo.AddAsync(log, cancellationToken);
                await activityRepo.TrimExcessAsync(10, cancellationToken);
            }

            await unitOfWork.SaveChangesAsync(cancellationToken);

            // SignalR Push
            if (view != null)
            {
                var viewDto = new ProductionViewDto(view.StationId, view.JobId, view.WorkOrderNo, view.ProductCode, view.ProductSerial, view.JobStatus, view.UpdatedAt);
                await _hubContext.Clients.Group(_stationId).SendAsync("OnProductionUpdate", viewDto, cancellationToken);
                _logger.LogInformation("Pushed production view update to group: {StationId}", _stationId);
            }

            if (log != null)
            {
                var logDto = new ActivityLogDto(log.Id, log.EventType, log.JobId, log.JobNo, log.ProductCode, log.Status, log.Message, log.OccurredAt);
                await _hubContext.Clients.Group(_stationId).SendAsync("OnActivityUpdate", logDto, cancellationToken);
                _logger.LogInformation("Pushed activity update to group: {StationId}", _stationId);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to handle job event: {RoutingKey}", routingKey);
            throw; // Will Nack
        }
    }

    private async Task HandleMqttEventAsync(string routingKey, string payloadJson, CancellationToken cancellationToken)
    {
        _logger.LogInformation("Projection Service received mqtt event: {RoutingKey}", routingKey);

        try
        {
            using var scope = _scopeFactory.CreateScope();
            var activityRepo = scope.ServiceProvider.GetRequiredService<IActivityLogRepository>();
            var unitOfWork = scope.ServiceProvider.GetRequiredService<IUnitOfWork>();

            var unifiedEvent = JsonSerializer.Deserialize<UnifiedEvent>(payloadJson, JsonSerializerOptions);
            if (unifiedEvent != null)
            {
                var tagsDict = unifiedEvent.Data.ToDictionary(
                    t => t.Tag,
                    t => t.Value?.ToString() ?? string.Empty,
                    StringComparer.OrdinalIgnoreCase);

                var productCode = tagsDict.TryGetValue(BusinessConstants.MqttTag.ProductId, out var pid)
                    ? pid
                    : tagsDict.TryGetValue(BusinessConstants.MqttTag.MarkingSerial, out var ms) ? ms : "GENERIC";

                var log = ActivityLog.Create(
                    "MqttMessageReceived",
                    jobId: "",
                    jobNo: unifiedEvent.EventId,
                    productCode: productCode,
                    status: "RECEIVED",
                    message: "Nhận yêu cầu in/khắc mới từ cổng nhà máy.",
                    occurredAt: unifiedEvent.Timestamp);

                await activityRepo.AddAsync(log, cancellationToken);
                await activityRepo.TrimExcessAsync(10, cancellationToken);

                await unitOfWork.SaveChangesAsync(cancellationToken);

                // SignalR Push
                var logDto = new ActivityLogDto(log.Id, log.EventType, log.JobId, log.JobNo, log.ProductCode, log.Status, log.Message, log.OccurredAt);
                await _hubContext.Clients.Group(_stationId).SendAsync("OnActivityUpdate", logDto, cancellationToken);
                _logger.LogInformation("Pushed raw MQTT receive activity update to group: {StationId}", _stationId);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to handle MQTT event: {RoutingKey}", routingKey);
            throw; // Will Nack
        }
    }
}
