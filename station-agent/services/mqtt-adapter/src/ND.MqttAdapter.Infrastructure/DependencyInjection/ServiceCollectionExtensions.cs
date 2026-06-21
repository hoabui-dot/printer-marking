using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using ND.Infrastructure.Messaging;
using ND.Infrastructure.Redis;
using ND.MqttAdapter.Application.Interfaces;
using ND.MqttAdapter.Infrastructure.Messaging;
using ND.MqttAdapter.Infrastructure.Options;
using ND.MqttAdapter.Infrastructure.Persistence;
using ND.MqttAdapter.Infrastructure.Repositories;
using ND.SharedKernel.Abstractions;
using StackExchange.Redis;

namespace ND.MqttAdapter.Infrastructure.DependencyInjection;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddMqttAdapterInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        // Options
        services.Configure<MqttOptions>(configuration.GetSection(MqttOptions.SectionName));

        // SQLite / EF Core
        var dbPath = configuration["SQLITE_MQTT_PATH"] ?? "data/mqtt.db";
        services.AddDbContext<MqttDbContext>(opts =>
            opts.UseSqlite($"Data Source={dbPath}"));
        services.AddScoped<IUnitOfWork>(sp => sp.GetRequiredService<MqttDbContext>());
        services.AddScoped<ITransactionalUnitOfWork>(sp => sp.GetRequiredService<MqttDbContext>());

        // Repositories
        services.AddScoped<IMqttMessageRepository, MqttMessageRepository>();
        services.AddScoped<IMqttOutboxRepository, MqttOutboxRepository>();

        // Redis
        var redisConnection = configuration["REDIS_CONNECTION_STRING"] ?? "localhost:6379";
        services.AddSingleton<IConnectionMultiplexer>(_ =>
            ConnectionMultiplexer.Connect(redisConnection));
        services.AddSingleton<IIdempotencyService, RedisIdempotencyService>();
        services.AddSingleton<IDistributedLock, RedisDistributedLock>();

        // MQTT Client (singleton — one connection per process)
        services.AddSingleton<MqttClientService>();
        services.AddSingleton<IMqttPublisher>(sp => sp.GetRequiredService<MqttClientService>());

        // RabbitMQ publisher (singleton — one AMQP connection per process)
        services.Configure<RabbitMqOptions>(configuration.GetSection(RabbitMqOptions.SectionName));
        services.AddSingleton<IRabbitMqPublisher, RabbitMqPublisher>();

        // Outbox processor background worker
        services.AddHostedService<OutboxProcessorWorker>();

        return services;
    }
}
