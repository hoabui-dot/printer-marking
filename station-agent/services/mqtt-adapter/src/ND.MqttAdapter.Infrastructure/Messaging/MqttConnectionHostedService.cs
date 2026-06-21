using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace ND.MqttAdapter.Infrastructure.Messaging;

/// <summary>
/// Starts the MQTT connection when the host starts.
/// </summary>
public sealed class MqttConnectionHostedService : IHostedService
{
    private readonly MqttClientService _mqttClientService;
    private readonly ILogger<MqttConnectionHostedService> _logger;

    public MqttConnectionHostedService(
        MqttClientService mqttClientService,
        ILogger<MqttConnectionHostedService> logger)
    {
        _mqttClientService = mqttClientService;
        _logger = logger;
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        _logger.LogInformation("Starting MQTT connection...");
        try
        {
            await _mqttClientService.ConnectAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "MQTT broker not reachable on startup. Will retry automatically when the broker becomes available.");
        }
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        _logger.LogInformation("Stopping MQTT connection...");
        await _mqttClientService.DisposeAsync();
    }
}
