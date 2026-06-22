using Microsoft.EntityFrameworkCore;
using ND.Infrastructure.Observability;
using ND.Infrastructure.Messaging;
using ND.PrinterAdapter.Application.Interfaces;
using ND.PrinterAdapter.Infrastructure.DeviceAdapters;
using ND.PrinterAdapter.Infrastructure.Messaging;
using ND.PrinterAdapter.Infrastructure.Persistence;
using ND.SharedKernel.Abstractions;
using ND.SharedKernel.Time;
using StackExchange.Redis;
using ND.Infrastructure.Redis;
using Serilog;

var builder = WebApplication.CreateBuilder(args);

Log.Logger = SerilogConfiguration.Configure(
    new LoggerConfiguration(), builder.Configuration, "printer-adapter").CreateLogger();
builder.Host.UseSerilog();

var dbPath = builder.Configuration["SQLITE_PRINTER_PATH"] ?? "data/printer.db";
builder.Services.AddDbContext<PrinterDbContext>(opts => opts.UseSqlite($"Data Source={dbPath}"));
builder.Services.AddScoped<IUnitOfWork>(sp => sp.GetRequiredService<PrinterDbContext>());

var redisConnection = builder.Configuration["REDIS_CONNECTION_STRING"] ?? "localhost:6379";
builder.Services.AddSingleton<IConnectionMultiplexer>(_ => ConnectionMultiplexer.Connect(redisConnection));
builder.Services.AddSingleton<IIdempotencyService, RedisIdempotencyService>();
builder.Services.AddSingleton<RedisHeartbeatCache>();

builder.Services.AddSingleton<ISystemClock, SystemClock>();
builder.Services.AddSingleton<IPrinterAdapter, ZplTcpPrinterAdapter>();

// RabbitMQ registrations
builder.Services.Configure<RabbitMqOptions>(builder.Configuration.GetSection(RabbitMqOptions.SectionName));
builder.Services.AddSingleton<IRabbitMqConsumer, RabbitMqConsumer>();
builder.Services.AddSingleton<IRabbitMqPublisher, RabbitMqPublisher>();

// Register hosted consumer
builder.Services.AddHostedService<JobProcessingConsumer>();

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddOpenApi();

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<PrinterDbContext>();
    var dbDir = Path.GetDirectoryName(Path.GetFullPath(dbPath));
    if (!string.IsNullOrEmpty(dbDir)) Directory.CreateDirectory(dbDir);
    await db.Database.EnsureCreatedAsync();

    // Seed default printer (printer-01)
    var printerHost = Environment.GetEnvironmentVariable("PRINTER_HOST") ?? app.Configuration["Printer:Host"] ?? "localhost";
    var printerPort = int.TryParse(Environment.GetEnvironmentVariable("PRINTER_PORT") ?? app.Configuration["Printer:Port"], out var p) ? p : 9100;
    await PrinterDbSeeder.SeedAsync(db, printerHost, printerPort);
}

if (app.Environment.IsDevelopment())
    app.MapOpenApi();

app.MapGet("/api/printers", async (PrinterDbContext db, CancellationToken ct) =>
    Results.Ok(await db.Printers.ToListAsync(ct)));

app.MapGet("/health", () => Results.Ok(new { status = "healthy", service = "printer-adapter" }));

app.Run();
