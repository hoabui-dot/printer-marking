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

        // 2. Consume printer printed events
        await _consumer.StartConsumingAsync(
            exchange: Exchange,
            queue: JobQueue,
            routingKeyPattern: "printer.printed",
            onMessage: (routingKey, json) => HandleJobEventAsync(routingKey, json, stoppingToken),
            cancellationToken: stoppingToken);

        // 3. Consume laser marked events
        await _consumer.StartConsumingAsync(
            exchange: Exchange,
            queue: JobQueue,
            routingKeyPattern: "laser.marked",
            onMessage: (routingKey, json) => HandleJobEventAsync(routingKey, json, stoppingToken),
            cancellationToken: stoppingToken);

        // 4. Consume MQTT inbound events
        await _consumer.StartConsumingAsync(
            exchange: Exchange,
            queue: MqttQueue,
            routingKeyPattern: MqttPattern,
            onMessage: (routingKey, json) => HandleMqttEventAsync(routingKey, json, stoppingToken),
            cancellationToken: stoppingToken);

        // 5. Consume manual requested events (reprint, re-marking, reprocess)
        await _consumer.StartConsumingAsync(
            exchange: Exchange,
            queue: "projection-service.manual-reprint-events",
            routingKeyPattern: JobEventRoutingKeys.ManualReprint,
            onMessage: (routingKey, json) => HandleManualOverrideRequestedEventAsync(routingKey, json, stoppingToken),
            cancellationToken: stoppingToken);

        await _consumer.StartConsumingAsync(
            exchange: Exchange,
            queue: "projection-service.manual-remarking-events",
            routingKeyPattern: JobEventRoutingKeys.ManualRemarking,
            onMessage: (routingKey, json) => HandleManualOverrideRequestedEventAsync(routingKey, json, stoppingToken),
            cancellationToken: stoppingToken);

        await _consumer.StartConsumingAsync(
            exchange: Exchange,
            queue: "projection-service.manual-reprocess-events",
            routingKeyPattern: JobEventRoutingKeys.ManualReprocess,
            onMessage: (routingKey, json) => HandleManualOverrideRequestedEventAsync(routingKey, json, stoppingToken),
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
            var recordRepo = scope.ServiceProvider.GetRequiredService<IProductionRecordRepository>();
            var activityRepo = scope.ServiceProvider.GetRequiredService<IActivityLogRepository>();
            var unitOfWork = scope.ServiceProvider.GetRequiredService<IUnitOfWork>();

            ProductionView? view = null;
            ActivityLog? log = null;
            ProductionRecord? productionRecordToPush = null;

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

                    // ProductionRecord logic
                    var record = await recordRepo.GetByJobIdAsync(evt.JobId, cancellationToken);
                    if (record == null)
                    {
                        record = (await recordRepo.GetAllAsync(cancellationToken))
                            .FirstOrDefault(r => r.JobNo == evt.JobNo);
                    }

                    if (record != null)
                    {
                        record.UpdateDetails(evt.JobId, evt.JobNo, evt.ProductCode, evt.ProductSerial, "QUEUED");
                        await recordRepo.UpdateAsync(record, cancellationToken);
                    }
                    else
                    {
                        record = ProductionRecord.Create(
                            evt.JobId,
                            evt.JobNo,
                            evt.ProductCode,
                            evt.ProductSerial,
                            evt.JobType,
                            _stationId,
                            "QUEUED");
                        await recordRepo.AddAsync(record, cancellationToken);
                    }
                    productionRecordToPush = record;
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
                        view.Update(evt.JobId, evt.JobNo, evt.ProductCode, evt.ProductSerial, "PROCESSING");
                        await productionRepo.UpdateAsync(view, cancellationToken);
                    }
                    else
                    {
                        view = ProductionView.Create(_stationId, evt.JobId, evt.JobNo, evt.ProductCode, evt.ProductSerial, "PROCESSING");
                        await productionRepo.AddAsync(view, cancellationToken);
                    }

                    log = ActivityLog.Create(
                        "JobProcessing",
                        evt.JobId,
                        evt.JobNo,
                        evt.ProductCode,
                        "PROCESSING",
                        $"Công việc {evt.JobNo} bắt đầu xử lý (lần thử #{evt.AttemptNo}).",
                        evt.Timestamp);

                    var record = await recordRepo.GetByJobIdAsync(evt.JobId, cancellationToken);
                    if (record != null)
                    {
                        record.UpdateStatus("PROCESSING");
                        await recordRepo.UpdateAsync(record, cancellationToken);
                        productionRecordToPush = record;
                    }
                }
            }
            else if (routingKey.Equals("printer.printed", StringComparison.OrdinalIgnoreCase))
            {
                var evt = JsonSerializer.Deserialize<PrinterPrintedEvent>(payloadJson, JsonSerializerOptions);
                if (evt != null)
                {
                    var record = await recordRepo.GetByJobIdAsync(evt.JobId, cancellationToken);
                    if (record != null)
                    {
                        record.UpdateStatus("PRINTING");
                        await recordRepo.UpdateAsync(record, cancellationToken);
                        productionRecordToPush = record;
                    }
                }
            }
            else if (routingKey.Equals("laser.marked", StringComparison.OrdinalIgnoreCase))
            {
                var evt = JsonSerializer.Deserialize<LaserMarkedEvent>(payloadJson, JsonSerializerOptions);
                if (evt != null)
                {
                    var record = await recordRepo.GetByJobIdAsync(evt.JobId, cancellationToken);
                    if (record != null)
                    {
                        record.UpdateStatus("PRINTING");
                        await recordRepo.UpdateAsync(record, cancellationToken);
                        productionRecordToPush = record;
                    }
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

                    var record = await recordRepo.GetByJobIdAsync(evt.JobId, cancellationToken);
                    if (record != null)
                    {
                        record.UpdateStatus("COMPLETED");
                        await recordRepo.UpdateAsync(record, cancellationToken);
                        productionRecordToPush = record;
                    }
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

                    var record = await recordRepo.GetByJobIdAsync(evt.JobId, cancellationToken);
                    if (record != null)
                    {
                        record.UpdateStatus("FAILED");
                        await recordRepo.UpdateAsync(record, cancellationToken);
                        productionRecordToPush = record;
                    }
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

            if (productionRecordToPush != null)
            {
                var recordDto = new ProductionRecordDto(
                    productionRecordToPush.Id,
                    productionRecordToPush.JobId,
                    productionRecordToPush.JobNo,
                    productionRecordToPush.ProductCode,
                    productionRecordToPush.ProductSerial,
                    productionRecordToPush.JobType,
                    productionRecordToPush.CurrentStatus,
                    productionRecordToPush.StationId,
                    productionRecordToPush.CreatedAt,
                    productionRecordToPush.UpdatedAt);

                await _hubContext.Clients.Group(_stationId).SendAsync("OnProductionRecordUpdate", recordDto, cancellationToken);
                _logger.LogInformation("Pushed production record update to group: {StationId}", _stationId);
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
            var recordRepo = scope.ServiceProvider.GetRequiredService<IProductionRecordRepository>();
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

                var productSerial = tagsDict.TryGetValue(BusinessConstants.MqttTag.MarkingSerial, out var serial)
                    ? serial
                    : tagsDict.TryGetValue(BusinessConstants.MqttTag.ProductId, out var pidFallback) ? pidFallback : null;

                var opType = tagsDict.TryGetValue(BusinessConstants.MqttTag.OperationType, out var ot)
                    ? ot : "DEFAULT";

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

                // ProductionRecord
                var record = (await recordRepo.GetAllAsync(cancellationToken))
                    .FirstOrDefault(r => r.JobNo == unifiedEvent.EventId);

                if (record == null)
                {
                    record = ProductionRecord.Create(
                        jobId: unifiedEvent.EventId, // Use EventId as temporary JobId
                        jobNo: unifiedEvent.EventId,
                        productCode: productCode,
                        productSerial: productSerial,
                        jobType: opType,
                        stationId: _stationId,
                        status: "RECEIVED");
                    await recordRepo.AddAsync(record, cancellationToken);
                }
                else
                {
                    record.UpdateDetails(record.JobId, unifiedEvent.EventId, productCode, productSerial, "RECEIVED");
                    await recordRepo.UpdateAsync(record, cancellationToken);
                }

                await unitOfWork.SaveChangesAsync(cancellationToken);

                // SignalR Push
                var logDto = new ActivityLogDto(log.Id, log.EventType, log.JobId, log.JobNo, log.ProductCode, log.Status, log.Message, log.OccurredAt);
                await _hubContext.Clients.Group(_stationId).SendAsync("OnActivityUpdate", logDto, cancellationToken);
                _logger.LogInformation("Pushed raw MQTT receive activity update to group: {StationId}", _stationId);

                var recordDto = new ProductionRecordDto(
                    record.Id,
                    record.JobId,
                    record.JobNo,
                    record.ProductCode,
                    record.ProductSerial,
                    record.JobType,
                    record.CurrentStatus,
                    record.StationId,
                    record.CreatedAt,
                    record.UpdatedAt);
                await _hubContext.Clients.Group(_stationId).SendAsync("OnProductionRecordUpdate", recordDto, cancellationToken);
                _logger.LogInformation("Pushed production record update from MQTT to group: {StationId}", _stationId);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to handle MQTT event: {RoutingKey}", routingKey);
            throw; // Will Nack
        }
    }

    private async Task HandleManualOverrideRequestedEventAsync(string routingKey, string payloadJson, CancellationToken cancellationToken)
    {
        _logger.LogInformation("Projection Service received manual override request: {RoutingKey}", routingKey);

        try
        {
            using var scope = _scopeFactory.CreateScope();
            var activityRepo = scope.ServiceProvider.GetRequiredService<IActivityLogRepository>();
            var unitOfWork = scope.ServiceProvider.GetRequiredService<IUnitOfWork>();

            string eventType = "ManualOverrideRequested";
            string jobId = "";
            string jobNo = "";
            string productCode = "";
            string requestedBy = "";
            string reasonCode = "";
            string reasonDescription = "";
            string message = "";
            string timestamp = "";

            if (routingKey.Equals(JobEventRoutingKeys.ManualReprint, StringComparison.OrdinalIgnoreCase))
            {
                var evt = JsonSerializer.Deserialize<ManualReprintRequestedEvent>(payloadJson, JsonSerializerOptions);
                if (evt != null)
                {
                    eventType = evt.EventType;
                    jobId = evt.JobId;
                    jobNo = evt.JobNo;
                    productCode = evt.ProductCode;
                    requestedBy = evt.RequestedBy;
                    reasonCode = evt.ReasonCode;
                    reasonDescription = evt.ReasonDescription ?? "";
                    timestamp = evt.RequestedAt;
                    message = $"Yêu cầu in lại nhãn bởi {requestedBy}. Lý do: [{reasonCode}] {reasonDescription}";
                }
            }
            else if (routingKey.Equals(JobEventRoutingKeys.ManualRemarking, StringComparison.OrdinalIgnoreCase))
            {
                var evt = JsonSerializer.Deserialize<ManualRemarkingRequestedEvent>(payloadJson, JsonSerializerOptions);
                if (evt != null)
                {
                    eventType = evt.EventType;
                    jobId = evt.JobId;
                    jobNo = evt.JobNo;
                    productCode = evt.ProductCode;
                    requestedBy = evt.RequestedBy;
                    reasonCode = evt.ReasonCode;
                    reasonDescription = evt.ReasonDescription ?? "";
                    timestamp = evt.RequestedAt;
                    message = $"Yêu cầu khắc lại laser bởi {requestedBy}. Lý do: [{reasonCode}] {reasonDescription}";
                }
            }
            else if (routingKey.Equals(JobEventRoutingKeys.ManualReprocess, StringComparison.OrdinalIgnoreCase))
            {
                var evt = JsonSerializer.Deserialize<ManualReprocessingRequestedEvent>(payloadJson, JsonSerializerOptions);
                if (evt != null)
                {
                    eventType = evt.EventType;
                    jobId = evt.JobId;
                    jobNo = evt.JobNo;
                    productCode = evt.ProductCode;
                    requestedBy = evt.RequestedBy;
                    reasonCode = evt.ReasonCode;
                    reasonDescription = evt.ReasonDescription ?? "";
                    timestamp = evt.RequestedAt;
                    message = $"Yêu cầu làm lại quy trình bởi {requestedBy}. Lý do: [{reasonCode}] {reasonDescription}";
                }
            }

            if (string.IsNullOrEmpty(jobId)) return;

            var log = ActivityLog.Create(
                eventType,
                jobId,
                jobNo,
                productCode,
                "REQUESTED",
                message,
                timestamp);

            await activityRepo.AddAsync(log, cancellationToken);
            await activityRepo.TrimExcessAsync(10, cancellationToken);
            await unitOfWork.SaveChangesAsync(cancellationToken);

            // Push real-time update to UI SignalR
            var logDto = new ActivityLogDto(log.Id, log.EventType, log.JobId, log.JobNo, log.ProductCode, log.Status, log.Message, log.OccurredAt);
            await _hubContext.Clients.Group(_stationId).SendAsync("OnActivityUpdate", logDto, cancellationToken);
            _logger.LogInformation("Pushed manual override request activity update to group: {StationId}", _stationId);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to handle manual override event: {RoutingKey}", routingKey);
            throw; // Will Nack
        }
    }
}
