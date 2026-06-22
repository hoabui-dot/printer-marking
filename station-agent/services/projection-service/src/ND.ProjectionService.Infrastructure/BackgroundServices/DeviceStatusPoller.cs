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
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IHubContext<ProductionHub> _hubContext;
    private readonly ILogger<DeviceStatusPoller> _logger;
    private readonly string _simulatorUrl;

    public DeviceStatusPoller(
        IHttpClientFactory httpClientFactory,
        IServiceScopeFactory scopeFactory,
        IHubContext<ProductionHub> hubContext,
        IConfiguration configuration,
        ILogger<DeviceStatusPoller> logger)
    {
        _httpClientFactory = httpClientFactory;
        _scopeFactory = scopeFactory;
        _hubContext = hubContext;
        _logger = logger;
        _simulatorUrl = configuration["SIMULATOR_URL"] ?? "http://localhost:5000";
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("DeviceStatusPoller starting. Polling target: {Target}", _simulatorUrl);

        using var client = _httpClientFactory.CreateClient();

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var response = await client.GetAsync($"{_simulatorUrl}/api/status", stoppingToken);
                if (response.IsSuccessStatusCode)
                {
                    var status = await response.Content.ReadFromJsonAsync<SimulatorStatusResponse>(cancellationToken: stoppingToken);
                    if (status != null)
                    {
                        await UpdateDeviceStatusesAsync(status, stoppingToken);
                    }
                }
                else
                {
                    _logger.LogWarning("Polled simulator status but got status code {StatusCode}", response.StatusCode);
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogError(ex, "Error occurred while polling device simulator status");
            }

            await Task.Delay(TimeSpan.FromSeconds(3), stoppingToken);
        }
    }

    private async Task UpdateDeviceStatusesAsync(SimulatorStatusResponse status, CancellationToken ct)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var repo = scope.ServiceProvider.GetRequiredService<IDeviceStatusRepository>();
        var unitOfWork = scope.ServiceProvider.GetRequiredService<IUnitOfWork>();

        var mapping = new Dictionary<string, bool>
        {
            ["printer-01"] = status.Printer.Online,
            ["laser-01"] = status.Laser.Online,
            ["camera-01"] = status.Vision.Online,
            ["plc-01"] = status.Plc.Online,
            ["gateway-01"] = status.Gateway.Connected
        };

        var nowStr = DateTime.UtcNow.ToString("o");
        var hasChanges = false;

        foreach (var kvp in mapping)
        {
            var device = await repo.GetByDeviceIdAsync(kvp.Key, ct);
            if (device == null)
            {
                var type = kvp.Key == "printer-01" ? "PRINTER" :
                           kvp.Key == "laser-01" ? "LASER" :
                           kvp.Key == "camera-01" ? "VISION_CAMERA" :
                           kvp.Key == "plc-01" ? "PLC" : "GATEWAY";

                device = DeviceStatus.Create(kvp.Key, type, kvp.Value, nowStr);
                await repo.AddAsync(device, ct);
                hasChanges = true;

                await BroadcastUpdateAsync(device);
            }
            else if (device.IsOnline != kvp.Value)
            {
                device.UpdateStatus(kvp.Value, nowStr);
                await repo.UpdateAsync(device, ct);
                hasChanges = true;

                await BroadcastUpdateAsync(device);
            }
        }

        if (hasChanges)
        {
            await unitOfWork.SaveChangesAsync(ct);
        }
    }

    private async Task BroadcastUpdateAsync(DeviceStatus device)
    {
        await _hubContext.Clients.All.SendAsync("OnDeviceStatusUpdate", new DeviceStatusDto(
            device.DeviceId,
            device.DeviceType,
            device.IsOnline,
            device.LastSeenAt
        ));
    }
}

public record SimulatorStatusResponse(
    PrinterStateResponse Printer,
    LaserStateResponse Laser,
    VisionStateResponse Vision,
    PlcStateResponse Plc,
    GatewayStateResponse Gateway);

public record PrinterStateResponse(bool Online);
public record LaserStateResponse(bool Online);
public record VisionStateResponse(bool Online);
public record PlcStateResponse(bool Online);
public record GatewayStateResponse(bool Connected);
