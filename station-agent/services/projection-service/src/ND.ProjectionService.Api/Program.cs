using Serilog;
using ND.Infrastructure.Observability;
using ND.ProjectionService.Infrastructure.DependencyInjection;
using ND.ProjectionService.Infrastructure.Persistence;
using ND.ProjectionService.Infrastructure.SignalR;
using ND.ProjectionService.Application.Interfaces;
using ND.ProjectionService.Application.Dtos;

var builder = WebApplication.CreateBuilder(args);

// Configure Serilog
Log.Logger = SerilogConfiguration.Configure(
    new LoggerConfiguration(), builder.Configuration, "projection-service").CreateLogger();
builder.Host.UseSerilog();

// Add Infrastructure
builder.Services.AddProjectionInfrastructure(builder.Configuration);

// Add SignalR
builder.Services.AddSignalR();

// CORS for frontend / browser connection
builder.Services.AddCors(opts =>
    opts.AddDefaultPolicy(policy =>
        policy.SetIsOriginAllowed(_ => true) // Allow any local origin for development / Kiosk deployment
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials()));

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddOpenApi();

var app = builder.Build();

// Ensure DB is created and seeded on startup
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<ProjectionDbContext>();
    var dbPath = app.Configuration["SQLITE_PROJECTION_PATH"] ?? "data/projection.db";
    var dbDir = Path.GetDirectoryName(Path.GetFullPath(dbPath));
    if (!string.IsNullOrEmpty(dbDir)) 
        Directory.CreateDirectory(dbDir);
    
    await db.Database.EnsureCreatedAsync();
    await ProjectionDbSeeder.SeedAsync(db);
}

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseCors();

// ── REST Query Endpoints ────────────────────────────────────────────────────

app.MapGet("/api/projection/production", async (
    string? stationId,
    IConfiguration config,
    IProductionViewRepository repo,
    CancellationToken ct) =>
{
    var targetStationId = stationId ?? config["STATION_ID"] ?? "STATION-01";
    var view = await repo.GetByStationIdAsync(targetStationId, ct);
    if (view is null)
        return Results.NotFound(new { error = $"No production view found for station: {targetStationId}" });

    var dto = new ProductionViewDto(
        view.StationId,
        view.JobId,
        view.WorkOrderNo,
        view.ProductCode,
        view.ProductSerial,
        view.JobStatus,
        view.UpdatedAt);

    return Results.Ok(dto);
});

app.MapGet("/api/projection/activities", async (
    int? limit,
    IActivityLogRepository repo,
    CancellationToken ct) =>
{
    var batchSize = limit ?? 10;
    var logs = await repo.GetLatestAsync(batchSize, ct);
    var dtos = logs.Select(l => new ActivityLogDto(
        l.Id,
        l.EventType,
        l.JobId,
        l.JobNo,
        l.ProductCode,
        l.Status,
        l.Message,
        l.OccurredAt));

    return Results.Ok(dtos);
});

app.MapGet("/api/projection/devices", async (
    IDeviceStatusRepository repo,
    CancellationToken ct) =>
{
    var devices = await repo.GetAllAsync(ct);
    var dtos = devices.Select(d => new DeviceStatusDto(
        d.DeviceId,
        d.DeviceType,
        d.IsOnline,
        d.LastSeenAt));

    return Results.Ok(dtos);
});

app.MapGet("/api/projection/records/today", async (
    int? page,
    int? pageSize,
    IProductionRecordRepository repo,
    CancellationToken ct) =>
{
    var p = page ?? 1;
    var ps = pageSize ?? 10;
    var (items, totalCount) = await repo.GetTodayAsync(p, ps, ct);

    var dtos = items.Select(r => new ProductionRecordDto(
        r.Id,
        r.JobId,
        r.JobNo,
        r.ProductCode,
        r.ProductSerial,
        r.JobType,
        r.CurrentStatus,
        r.StationId,
        r.CreatedAt,
        r.UpdatedAt)).ToList();

    return Results.Ok(new PagedResult<ProductionRecordDto>(dtos, totalCount, p, ps));
});

app.MapGet("/api/projection/records/history", async (
    int? page,
    int? pageSize,
    string? status,
    string? productCode,
    string? workOrder,
    string? dateFrom,
    string? dateTo,
    IProductionRecordRepository repo,
    CancellationToken ct) =>
{
    var p = page ?? 1;
    var ps = pageSize ?? 10;
    var (items, totalCount) = await repo.GetHistoryAsync(p, ps, status, productCode, workOrder, dateFrom, dateTo, ct);

    var dtos = items.Select(r => new ProductionRecordDto(
        r.Id,
        r.JobId,
        r.JobNo,
        r.ProductCode,
        r.ProductSerial,
        r.JobType,
        r.CurrentStatus,
        r.StationId,
        r.CreatedAt,
        r.UpdatedAt)).ToList();

    return Results.Ok(new PagedResult<ProductionRecordDto>(dtos, totalCount, p, ps));
});

app.MapGet("/health", () => Results.Ok(new { status = "healthy", service = "projection-service" }));

// ── SignalR Hubs ────────────────────────────────────────────────────────────
app.MapHub<ProductionHub>("/hubs/production");

app.Run();
