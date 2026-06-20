using Microsoft.EntityFrameworkCore;
using ND.Infrastructure.Observability;
using ND.LaserAdapter.Infrastructure.Persistence;
using ND.SharedKernel.Abstractions;
using ND.Infrastructure.Redis;
using StackExchange.Redis;
using Serilog;

var builder = WebApplication.CreateBuilder(args);
Log.Logger = SerilogConfiguration.Configure(new LoggerConfiguration(), builder.Configuration, "laser-adapter").CreateLogger();
builder.Host.UseSerilog();

var dbPath = builder.Configuration["SQLITE_LASER_PATH"] ?? "data/laser.db";
builder.Services.AddDbContext<LaserDbContext>(opts => opts.UseSqlite($"Data Source={dbPath}"));
builder.Services.AddScoped<IUnitOfWork>(sp => sp.GetRequiredService<LaserDbContext>());

var redisConnection = builder.Configuration["REDIS_CONNECTION_STRING"] ?? "localhost:6379";
builder.Services.AddSingleton<IConnectionMultiplexer>(_ => ConnectionMultiplexer.Connect(redisConnection));
builder.Services.AddSingleton<IIdempotencyService, RedisIdempotencyService>();

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddOpenApi();

var app = builder.Build();
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<LaserDbContext>();
    await db.Database.EnsureCreatedAsync();
}
if (app.Environment.IsDevelopment()) app.MapOpenApi();
app.MapGet("/api/lasers", async (LaserDbContext db, CancellationToken ct) => Results.Ok(await db.Lasers.ToListAsync(ct)));
app.MapGet("/health", () => Results.Ok(new { status = "healthy", service = "laser-adapter" }));
app.Run();
