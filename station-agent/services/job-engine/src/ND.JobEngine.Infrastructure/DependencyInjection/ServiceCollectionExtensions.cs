using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using ND.Infrastructure.Redis;
using ND.JobEngine.Application.Commands;
using ND.JobEngine.Application.Interfaces;
using ND.JobEngine.Application.Queries;
using ND.JobEngine.Infrastructure.Persistence;
using ND.JobEngine.Infrastructure.Repositories;
using ND.SharedKernel.Abstractions;
using StackExchange.Redis;

namespace ND.JobEngine.Infrastructure.DependencyInjection;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddJobEngineInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        // SQLite / EF Core
        var dbPath = configuration["SQLITE_JOB_ENGINE_PATH"] ?? "data/job_engine.db";
        services.AddDbContext<JobEngineDbContext>(opts =>
            opts.UseSqlite($"Data Source={dbPath}"));
        services.AddScoped<IUnitOfWork>(sp => sp.GetRequiredService<JobEngineDbContext>());

        // Repositories
        services.AddScoped<IJobRepository, JobRepository>();
        services.AddScoped<IJobAttemptRepository, JobAttemptRepository>();
        services.AddScoped<IJobStepRepository, JobStepRepository>();
        services.AddScoped<IJobHistoryRepository, JobHistoryRepository>();
        services.AddScoped<IJobStateTransitionRepository, JobStateTransitionRepository>();
        services.AddScoped<IOverwriteRequestRepository, OverwriteRequestRepository>();

        // Redis
        var redisConnection = configuration["REDIS_CONNECTION_STRING"] ?? "localhost:6379";
        services.AddSingleton<IConnectionMultiplexer>(_ =>
            ConnectionMultiplexer.Connect(redisConnection));
        services.AddSingleton<IIdempotencyService, RedisIdempotencyService>();
        services.AddSingleton<IDistributedLock, RedisDistributedLock>();

        // Application handlers
        services.AddScoped<CreateJobHandler>();
        services.AddScoped<ProcessJobHandler>();
        services.AddScoped<CreateOverwriteRequestHandler>();
        services.AddScoped<GetJobQueryHandler>();

        return services;
    }
}
