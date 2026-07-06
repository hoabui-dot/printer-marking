using Serilog;
using ND.Infrastructure.Observability;
using ND.ProjectionService.Infrastructure.DependencyInjection;
using ND.ProjectionService.Infrastructure.Persistence;
using ND.ProjectionService.Infrastructure.SignalR;
using ND.ProjectionService.Application.Interfaces;
using ND.ProjectionService.Application.Dtos;
using ND.ProjectionService.Domain.Entities;
using System.Net.Sockets;
using System.Net.Http;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ND.SharedKernel.Abstractions;

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

    // Safely add lifecycle_state to device statuses read model and create alarms table
    using (var cmd = db.Database.GetDbConnection().CreateCommand())
    {
        await db.Database.OpenConnectionAsync();
        cmd.CommandText = "ALTER TABLE projection_device_status ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'Offline';";
        try { await cmd.ExecuteNonQueryAsync(); } catch { }

        cmd.CommandText = @"
            CREATE TABLE IF NOT EXISTS projection_alarms (
                id TEXT PRIMARY KEY,
                severity TEXT NOT NULL,
                source TEXT NOT NULL,
                message TEXT NOT NULL,
                device_id TEXT NULL,
                is_acknowledged INTEGER NOT NULL DEFAULT 0,
                acknowledged_by TEXT NULL,
                acknowledged_at TEXT NULL,
                created_at TEXT NOT NULL
            );";
        try { await cmd.ExecuteNonQueryAsync(); } catch { }
    }

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
        d.LastSeenAt,
        d.LifecycleState));

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

app.MapGet("/api/projection/records/work-order/{workOrderNo}", async (
    string workOrderNo,
    ProjectionDbContext db,
    CancellationToken ct) =>
{
    var records = await db.ProductionRecords
        .Where(r => r.JobNo == workOrderNo)
        .OrderBy(r => r.CreatedAt)
        .ToListAsync(ct);

    var dtos = records.Select(r => new ProductionRecordDto(
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

    return Results.Ok(dtos);
});

// Production Order Views (new architecture - replaces old job-engine direct access)
app.MapGet("/api/projection/orders", async (
    IProductionOrderViewRepository repo,
    CancellationToken ct) =>
{
    var orders = await repo.GetLatestAsync(100, ct);
    return Results.Ok(orders.Select(o => new {
        o.Id,
        o.OrderNo,
        o.ProductCode,
        o.PlannedQty,
        o.CompletedQty,
        o.RemainingQty,
        o.Status,
        o.CreatedAt,
        o.UpdatedAt,
        ProgressPercent = o.PlannedQty > 0 ? (int)Math.Round((double)o.CompletedQty / o.PlannedQty * 100) : 0
    }));
});

app.MapGet("/api/projection/orders/{orderNo}/items", async (
    string orderNo,
    IProductionRecordRepository repo,
    CancellationToken ct) =>
{
    var (records, _) = await repo.GetHistoryAsync(
        page: 1, pageSize: 500,
        workOrder: orderNo,
        cancellationToken: ct);
    return Results.Ok(records.Select(r => new {
        r.Id,
        r.JobId,
        r.JobNo,
        r.ProductCode,
        r.ProductSerial,
        r.JobType,
        r.CurrentStatus,
        r.AssignedPrinter,
        r.StartTime,
        r.EndTime,
        r.RetryCount,
        r.ErrorMessage,
        r.CreatedAt,
        r.UpdatedAt
    }).OrderBy(r => r.CreatedAt));
});

app.MapGet("/api/projection/alarms", async (
    IAlarmRepository repo,
    CancellationToken ct) =>
{
    var alarms = await repo.GetAllAsync(ct);
    var dtos = alarms.Select(a => new AlarmDto(
        a.Id,
        a.Severity,
        a.Source,
        a.Message,
        a.DeviceId,
        a.IsAcknowledged,
        a.AcknowledgedBy,
        a.AcknowledgedAt,
        a.CreatedAt
    )).OrderByDescending(a => a.CreatedAt).ToList();
    return Results.Ok(dtos);
});

app.MapPost("/api/projection/alarms/{id}/acknowledge", async (
    string id,
    IAlarmRepository repo,
    IUnitOfWork uow,
    CancellationToken ct) =>
{
    var alarm = await repo.GetByIdAsync(id, ct);
    if (alarm == null) return Results.NotFound();

    alarm.Acknowledge("Operator");
    await repo.UpdateAsync(alarm, ct);
    await uow.SaveChangesAsync(ct);

    return Results.Ok();
});

app.MapGet("/api/projection/diagnostics/health", async (
    ProjectionDbContext db,
    IConfiguration configuration,
    CancellationToken ct) =>
{
    var report = new Dictionary<string, object>();

    // 1. SQLite
    var sqliteOk = false;
    var sqliteTime = 0L;
    try
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        sqliteOk = await db.Database.CanConnectAsync(ct);
        sw.Stop();
        sqliteTime = sw.ElapsedMilliseconds;
    }
    catch {}
    report["sqlite"] = new { status = sqliteOk ? "Healthy" : "Unhealthy", latencyMs = sqliteTime };

    // Helper for TCP check
    async Task<object> CheckTcpAsync(string host, int port)
    {
        var ok = false;
        var time = 0L;
        try
        {
            var sw = System.Diagnostics.Stopwatch.StartNew();
            using var tcp = new TcpClient();
            var connectTask = tcp.ConnectAsync(host, port, ct).AsTask();
            var delayTask = Task.Delay(1000, ct);
            var completedTask = await Task.WhenAny(connectTask, delayTask);
            if (completedTask == connectTask && tcp.Connected)
            {
                ok = true;
            }
            sw.Stop();
            time = sw.ElapsedMilliseconds;
        }
        catch {}
        return new { status = ok ? "Healthy" : "Unhealthy", latencyMs = time };
    }

    // 2. RabbitMQ
    var rabbitHost = configuration["RabbitMq:Host"] ?? "rabbitmq";
    var rabbitPort = 5672;
    report["rabbitmq"] = await CheckTcpAsync(rabbitHost, rabbitPort);

    // 3. MQTT Broker
    var mqttHost = configuration["MQTT_BROKER_HOST"] ?? "mosquitto";
    var mqttPort = 1883;
    report["mqtt"] = await CheckTcpAsync(mqttHost, mqttPort);

    // 4. Printer
    report["printer"] = await CheckTcpAsync("device-simulator", 9100);

    // 5. Laser
    report["laser"] = await CheckTcpAsync("device-simulator", 8901);

    // 6. PLC
    report["plc"] = await CheckTcpAsync("device-simulator", 5020);

    return Results.Ok(report);
});

app.MapGet("/api/projection/diagnostics/metrics", async (
    IProductionRecordRepository recordRepo,
    IHttpClientFactory httpClientFactory,
    IConfiguration configuration,
    CancellationToken ct) =>
{
    // Aggregate production record metrics
    var allRecords = await recordRepo.GetAllAsync(ct);
    var todayRecords = allRecords.Where(r => {
        if (DateTime.TryParse(r.CreatedAt, out var created)) {
            return created.Date == DateTime.UtcNow.Date;
        }
        return false;
    }).ToList();

    var totalToday = todayRecords.Count;
    var completedToday = todayRecords.Count(r => r.CurrentStatus == "Completed");
    var failedToday = todayRecords.Count(r => r.CurrentStatus == "FAILED" || r.CurrentStatus == "Failed");

    double passRate = totalToday > 0 ? ((double)completedToday / totalToday) * 100 : 100.0;
    double failRate = totalToday > 0 ? ((double)failedToday / totalToday) * 100 : 0.0;

    // Fetch step averages from job-engine
    var stepAverages = new Dictionary<string, double>();
    var jobEngineUrl = configuration["JOB_ENGINE_URL"] ?? "http://job-engine:5002";
    try
    {
        using var client = httpClientFactory.CreateClient();
        var response = await client.GetAsync($"{jobEngineUrl}/api/jobs/metrics", ct);
        if (response.IsSuccessStatusCode)
        {
            var content = await response.Content.ReadAsStringAsync(ct);
            var root = JsonDocument.Parse(content).RootElement;
            if (root.TryGetProperty("averages", out var averagesProp) && averagesProp.ValueKind == JsonValueKind.Object)
            {
                foreach (var prop in averagesProp.EnumerateObject())
                {
                    if (prop.Value.TryGetDouble(out var val))
                    {
                        stepAverages[prop.Name] = val;
                    }
                }
            }
        }
    }
    catch
    {
        // Log or fallback
        stepAverages["error"] = 0.0;
    }

    return Results.Ok(new {
        throughput = totalToday,
        passRate = Math.Round(passRate, 1),
        failureRate = Math.Round(failRate, 1),
        stepAverages
    });
});

app.MapGet("/api/projection/config", async (
    IHttpClientFactory httpClientFactory,
    IConfiguration configuration,
    CancellationToken ct) =>
{
    var simulatorUrl = configuration["SIMULATOR_URL"] ?? "http://device-simulator:8080";
    using var client = httpClientFactory.CreateClient();
    try
    {
        var response = await client.GetAsync($"{simulatorUrl}/api/config", ct);
        if (response.IsSuccessStatusCode)
        {
            var content = await response.Content.ReadAsStringAsync(ct);
            return Results.Content(content, "application/json");
        }
        return Results.StatusCode((int)response.StatusCode);
    }
    catch (Exception ex)
    {
        return Results.Problem(ex.Message);
    }
});

app.MapPut("/api/projection/config/{key}", async (
    string key,
    JsonElement reqBody,
    IHttpClientFactory httpClientFactory,
    IConfiguration configuration,
    CancellationToken ct) =>
{
    var simulatorUrl = configuration["SIMULATOR_URL"] ?? "http://device-simulator:8080";
    using var client = httpClientFactory.CreateClient();
    try
    {
        var response = await client.PutAsJsonAsync($"{simulatorUrl}/api/config/{key}", reqBody, ct);
        if (response.IsSuccessStatusCode)
        {
            return Results.Ok();
        }
        return Results.StatusCode((int)response.StatusCode);
    }
    catch (Exception ex)
    {
        return Results.Problem(ex.Message);
    }
});

app.MapGet("/health", () => Results.Ok(new { status = "healthy", service = "projection-service" }));

// ── SignalR Hubs ────────────────────────────────────────────────────────────
app.MapHub<ProductionHub>("/hubs/production");

app.Run();
