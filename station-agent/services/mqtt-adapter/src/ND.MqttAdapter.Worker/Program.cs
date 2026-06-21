using ND.Infrastructure.Observability;
using ND.MqttAdapter.Application.Commands;
using ND.MqttAdapter.Infrastructure.DependencyInjection;
using ND.MqttAdapter.Infrastructure.Messaging;
using ND.MqttAdapter.Infrastructure.Persistence;
using Serilog;

var builder = Host.CreateApplicationBuilder(args);

// ── Serilog ──────────────────────────────────────────────────────────────────
Log.Logger = SerilogConfiguration.Configure(
    new LoggerConfiguration(),
    builder.Configuration,
    "mqtt-adapter").CreateLogger();

builder.Logging.ClearProviders();
builder.Services.AddSerilog();

// ── Infrastructure (SQLite, Redis, MQTT, RabbitMQ, outbox poller) ─────────────
builder.Services.AddMqttAdapterInfrastructure(builder.Configuration);

// ── Application layer ─────────────────────────────────────────────────────────
// ProcessInboundMessageHandler is Scoped — each MQTT message gets its own scope
// (created inside MqttClientService.OnMessageReceivedAsync).
builder.Services.AddScoped<ProcessInboundMessageHandler>();

// ── MQTT connection hosted service ────────────────────────────────────────────
// Connects to the MQTT broker, subscribes to topics, and forwards messages
// to ProcessInboundMessageHandler. OutboxProcessorWorker (registered in
// AddMqttAdapterInfrastructure) handles RabbitMQ publishing.
builder.Services.AddHostedService<MqttConnectionHostedService>();

var host = builder.Build();

// ── Database initialisation ───────────────────────────────────────────────────
using (var scope = host.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<MqttDbContext>();
    var mqttDbPath = builder.Configuration["SQLITE_MQTT_PATH"] ?? "data/mqtt.db";
    var mqttDbDir = Path.GetDirectoryName(Path.GetFullPath(mqttDbPath));
    if (!string.IsNullOrEmpty(mqttDbDir)) Directory.CreateDirectory(mqttDbDir);
    await db.Database.EnsureCreatedAsync();
}

await host.RunAsync();
