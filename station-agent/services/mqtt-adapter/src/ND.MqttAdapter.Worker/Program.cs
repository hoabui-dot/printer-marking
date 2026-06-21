using ND.Infrastructure.Observability;
using ND.MqttAdapter.Application.Commands;
using ND.MqttAdapter.Application.Interfaces;
using ND.MqttAdapter.Infrastructure.DependencyInjection;
using ND.MqttAdapter.Infrastructure.Messaging;
using ND.MqttAdapter.Infrastructure.Persistence;
using Serilog;

var builder = Host.CreateApplicationBuilder(args);

// Serilog
Log.Logger = SerilogConfiguration.Configure(
    new LoggerConfiguration(),
    builder.Configuration,
    "mqtt-adapter").CreateLogger();

builder.Logging.ClearProviders();
builder.Services.AddSerilog();

// Infrastructure (SQLite, Redis, MQTT, outbox)
builder.Services.AddMqttAdapterInfrastructure(builder.Configuration);

// Application handlers
builder.Services.AddScoped<ProcessInboundMessageHandler>();

// Default inbound dispatcher — routes by topic
builder.Services.AddSingleton<IInboundMessageDispatcher, DefaultInboundMessageDispatcher>();

// MQTT connection hosted service
builder.Services.AddHostedService<MqttConnectionHostedService>();

var host = builder.Build();

// Ensure database is created / migrated on startup
using (var scope = host.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<MqttDbContext>();
    var mqttDbPath = builder.Configuration["SQLITE_MQTT_PATH"] ?? "data/mqtt.db";
    var mqttDbDir = Path.GetDirectoryName(Path.GetFullPath(mqttDbPath));
    if (!string.IsNullOrEmpty(mqttDbDir)) Directory.CreateDirectory(mqttDbDir);
    await db.Database.EnsureCreatedAsync();
}

await host.RunAsync();
