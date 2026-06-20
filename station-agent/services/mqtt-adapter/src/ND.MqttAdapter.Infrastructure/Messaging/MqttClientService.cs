using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using MQTTnet;
using MQTTnet.Client;
using ND.MqttAdapter.Application.Interfaces;
using ND.MqttAdapter.Infrastructure.Options;

namespace ND.MqttAdapter.Infrastructure.Messaging;

/// <summary>
/// MQTTnet-based client. Connects to the broker, subscribes to topics,
/// and forwards inbound messages to the dispatcher.
/// </summary>
public sealed class MqttClientService : IMqttPublisher, IAsyncDisposable
{
    private readonly IMqttClient _client;
    private readonly MqttOptions _options;
    private readonly IInboundMessageDispatcher _dispatcher;
    private readonly ILogger<MqttClientService> _logger;

    public MqttClientService(
        IOptions<MqttOptions> options,
        IInboundMessageDispatcher dispatcher,
        ILogger<MqttClientService> logger)
    {
        _options = options.Value;
        _dispatcher = dispatcher;
        _logger = logger;

        var factory = new MqttFactory();
        _client = factory.CreateMqttClient();
        _client.ApplicationMessageReceivedAsync += OnMessageReceivedAsync;
    }

    public async Task ConnectAsync(CancellationToken cancellationToken)
    {
        var builder = new MqttClientOptionsBuilder()
            .WithClientId($"station-agent-{_options.StationId}-{Guid.NewGuid():N}")
            .WithTcpServer(_options.BrokerHost, _options.BrokerPort)
            .WithCleanSession(false);

        if (_options.UseTls)
        {
            builder.WithTlsOptions(tls => tls
                .UseTls()
                .WithAllowUntrustedCertificates(false));
        }

        if (!string.IsNullOrWhiteSpace(_options.Username))
            builder.WithCredentials(_options.Username, _options.Password);

        var mqttOptions = builder.Build();

        _client.DisconnectedAsync += async args =>
        {
            _logger.LogWarning("MQTT disconnected. Reason: {Reason}", args.Reason);
            await Task.Delay(TimeSpan.FromSeconds(5), cancellationToken);
            try { await _client.ReconnectAsync(cancellationToken); }
            catch (Exception ex) { _logger.LogError(ex, "MQTT reconnect failed"); }
        };

        await _client.ConnectAsync(mqttOptions, cancellationToken);
        _logger.LogInformation("MQTT connected to {Host}:{Port}", _options.BrokerHost, _options.BrokerPort);

        // Subscribe to inbound topics
        foreach (var topic in _options.SubscribeTopics)
        {
            await _client.SubscribeAsync(topic, cancellationToken: cancellationToken);
            _logger.LogInformation("Subscribed to MQTT topic: {Topic}", topic);
        }
    }

    public async Task PublishAsync(string topic, string payloadJson, CancellationToken cancellationToken = default)
    {
        var message = new MqttApplicationMessageBuilder()
            .WithTopic(topic)
            .WithPayload(payloadJson)
            .WithQualityOfServiceLevel(MQTTnet.Protocol.MqttQualityOfServiceLevel.AtLeastOnce)
            .WithRetainFlag(false)
            .Build();

        await _client.PublishAsync(message, cancellationToken);
        _logger.LogInformation("Published MQTT message to {Topic}", topic);
    }

    private async Task OnMessageReceivedAsync(MqttApplicationMessageReceivedEventArgs args)
    {
        var topic = args.ApplicationMessage.Topic;
        var payload = args.ApplicationMessage.ConvertPayloadToString();
        var messageId = args.ApplicationMessage.CorrelationData is { Length: > 0 }
            ? System.Text.Encoding.UTF8.GetString(args.ApplicationMessage.CorrelationData)
            : Guid.NewGuid().ToString();

        _logger.LogDebug("MQTT message received on {Topic}", topic);

        try
        {
            await _dispatcher.DispatchAsync(topic, payload, CancellationToken.None);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error dispatching MQTT message on {Topic}", topic);
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_client.IsConnected)
            await _client.DisconnectAsync();
        _client.Dispose();
    }
}
