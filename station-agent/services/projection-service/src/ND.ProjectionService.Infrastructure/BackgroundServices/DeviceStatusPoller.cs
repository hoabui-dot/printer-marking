using System.Net.Http.Json;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using ND.ProjectionService.Application.Dtos;
using ND.ProjectionService.Application.Interfaces;
using ND.ProjectionService.Domain.Entities;
using ND.ProjectionService.Infrastructure.SignalR;
using ND.SharedKernel.Abstractions;

namespace ND.ProjectionService.Infrastructure.BackgroundServices;

public sealed class DeviceStatusPoller : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IHubContext<ProductionHub> _hubContext;
    private readonly ILogger<DeviceStatusPoller> _logger;
    private readonly string _stationId = "station-01";

    public DeviceStatusPoller(
        IServiceScopeFactory scopeFactory,
        IHubContext<ProductionHub> hubContext,
        ILogger<DeviceStatusPoller> logger)
    {
        _scopeFactory = scopeFactory;
        _hubContext = hubContext;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("DeviceStatusPoller (Timeout Monitor) starting. Checking every 3s.");

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await MonitorHeartbeatTimeoutsAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogError(ex, "Error occurred during device heartbeat timeout check");
            }

            await Task.Delay(TimeSpan.FromSeconds(3), stoppingToken);
        }
    }

    private async Task MonitorHeartbeatTimeoutsAsync(CancellationToken ct)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var repo = scope.ServiceProvider.GetRequiredService<IDeviceStatusRepository>();
        var unitOfWork = scope.ServiceProvider.GetRequiredService<IUnitOfWork>();

        var devices = await repo.GetAllAsync(ct);
        var now = DateTime.UtcNow;
        var hasChanges = false;

        foreach (var device in devices)
        {
            if (!device.IsOnline) continue;

            if (DateTime.TryParse(device.LastSeenAt, out var lastSeen))
            {
                if ((now - lastSeen).TotalSeconds > 10)
                {
                    _logger.LogWarning("Device {DeviceId} heartbeat timed out (> 10s). Marking Offline.", device.DeviceId);
                    device.UpdateStatus(false, device.LastSeenAt, "Offline");
                    await repo.UpdateAsync(device, ct);
                    hasChanges = true;

                    // Raise Critical Alarm for device offline
                    try
                    {
                        var alarmRepo = scope.ServiceProvider.GetRequiredService<IAlarmRepository>();
                        var alarm = Alarm.Create(
                            "Critical",
                            "Device",
                            $"Thiết bị {device.DeviceId} ({device.DeviceType}) đã mất kết nối heartbeat!",
                            device.DeviceId
                        );
                        await alarmRepo.AddAsync(alarm, ct);
                        
                        // Push alarm to UI
                        var alarmDto = new AlarmDto(
                            alarm.Id, alarm.Severity, alarm.Source, alarm.Message, alarm.DeviceId,
                            alarm.IsAcknowledged, alarm.AcknowledgedBy, alarm.AcknowledgedAt, alarm.CreatedAt
                        );
                        await _hubContext.Clients.Group(_stationId).SendAsync("OnAlarmRaised", alarmDto, ct);
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "Failed to raise offline alarm for device {DeviceId}", device.DeviceId);
                    }

                    // Push status update to UI
                    var dto = new DeviceStatusDto(
                        device.DeviceId,
                        device.DeviceType,
                        device.IsOnline,
                        device.LastSeenAt,
                        device.LifecycleState
                    );
                    await _hubContext.Clients.Group(_stationId).SendAsync("OnDeviceStatusUpdate", dto, ct);
                }
            }
        }

        if (hasChanges)
        {
            await unitOfWork.SaveChangesAsync(ct);
        }
    }
}


