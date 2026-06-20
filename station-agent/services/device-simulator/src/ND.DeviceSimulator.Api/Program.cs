using Microsoft.EntityFrameworkCore;
using Serilog;
using ND.DeviceSimulator.Application.Abstractions;
using ND.DeviceSimulator.Application.Dtos;
using ND.DeviceSimulator.Infrastructure.Hubs;
using ND.DeviceSimulator.Infrastructure.Persistence;
using ND.DeviceSimulator.Infrastructure.State;
using ND.DeviceSimulator.Infrastructure.VirtualDevices;
using ND.DeviceSimulator.Infrastructure.Workers;

// ── Bootstrap Serilog ─────────────────────────────────────────────────────────
Log.Logger = new LoggerConfiguration().WriteTo.Console().CreateBootstrapLogger();

try
{
    var builder = WebApplication.CreateBuilder(args);

    builder.Host.UseSerilog((ctx, lc) => lc
        .ReadFrom.Configuration(ctx.Configuration)
        .Enrich.FromLogContext()
        .Enrich.WithProperty("Service", "device-simulator")
        .WriteTo.Console()
        .WriteTo.File("logs/device-simulator-.log", rollingInterval: RollingInterval.Day));

    // ── SQLite ────────────────────────────────────────────────────────────────
    var dbPath = builder.Configuration.GetConnectionString("Sqlite")
                 ?? "Data Source=/data/device-simulator.db";

    try
    {
        var connectionStringBuilder = new Microsoft.Data.Sqlite.SqliteConnectionStringBuilder(dbPath);
        var dataSource = connectionStringBuilder.DataSource;

        if (!string.IsNullOrEmpty(dataSource) && Path.IsPathRooted(dataSource))
        {
            var directory = Path.GetDirectoryName(dataSource);
            if (!string.IsNullOrEmpty(directory))
            {
                // Try to create directory to verify permissions
                if (!Directory.Exists(directory))
                {
                    Directory.CreateDirectory(directory);
                }

                // Verify write permission by creating and deleting a temp file
                var tempFile = Path.Combine(directory, $".write_test_{Guid.NewGuid()}");
                File.WriteAllText(tempFile, "test");
                File.Delete(tempFile);
            }
        }
    }
    catch (Exception ex)
    {
        var connectionStringBuilder = new Microsoft.Data.Sqlite.SqliteConnectionStringBuilder(dbPath);
        var dataSource = connectionStringBuilder.DataSource;
        var fileName = !string.IsNullOrEmpty(dataSource) ? Path.GetFileName(dataSource) : "device-simulator.db";
        var localDbDir = Path.Combine(builder.Environment.ContentRootPath, "data");
        
        if (!Directory.Exists(localDbDir))
        {
            Directory.CreateDirectory(localDbDir);
        }
        
        var localDbPath = Path.Combine(localDbDir, fileName);
        connectionStringBuilder.DataSource = localDbPath;
        dbPath = connectionStringBuilder.ConnectionString;

        Log.Warning(ex, "Could not write to configured database directory. Falling back to local database path: {FallbackPath}", localDbPath);
    }

    builder.Services.AddDbContext<SimulatorDbContext>(opt => opt.UseSqlite(dbPath));

    // ── Singleton state service ───────────────────────────────────────────────
    builder.Services.AddSingleton<ISimulatorStateService, SimulatorStateService>();

    // ── Virtual device services ───────────────────────────────────────────────
    builder.Services.AddSingleton<VirtualVisionService>();
    builder.Services.AddSingleton<VirtualFactoryGateway>();
    builder.Services.AddSingleton<VirtualPlcServer>();

    builder.Services.AddHostedService(sp => sp.GetRequiredService<VirtualFactoryGateway>());
    builder.Services.AddHostedService(sp => sp.GetRequiredService<VirtualPlcServer>());
    builder.Services.AddHostedService<VirtualPrinterServer>();
    builder.Services.AddHostedService<VirtualLaserServer>();
    builder.Services.AddHostedService<ConnectionCheckWorker>();

    // ── SignalR ───────────────────────────────────────────────────────────────
    builder.Services.AddSignalR();

    // ── CORS ──────────────────────────────────────────────────────────────────
    builder.Services.AddCors(opt => opt.AddDefaultPolicy(p =>
        p.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));

    builder.Services.AddOpenApi();

    var app = builder.Build();

    // ── Migrate + Seed ────────────────────────────────────────────────────────
    await using (var scope = app.Services.CreateAsyncScope())
    {
        var db = scope.ServiceProvider.GetRequiredService<SimulatorDbContext>();
        await db.Database.EnsureCreatedAsync();
        await SimulatorDbSeeder.SeedAsync(db);
    }

    app.UseSerilogRequestLogging();
    app.UseCors();

    if (app.Environment.IsDevelopment())
        app.MapOpenApi();

    app.UseDefaultFiles();
    app.UseStaticFiles();

    app.MapHub<SimulatorHub>("/hubs/simulator");

    // ── Health ────────────────────────────────────────────────────────────────
    app.MapGet("/health", () => Results.Ok(new { status = "healthy", service = "device-simulator" }));

    // ── Status snapshot ───────────────────────────────────────────────────────
    app.MapGet("/api/status", (ISimulatorStateService state) =>
        Results.Ok(state.GetStatus()));

    // ── Printer ───────────────────────────────────────────────────────────────
    app.MapGet("/api/printer/jobs", async (SimulatorDbContext db, int limit = 50) =>
    {
        var jobs = await db.PrinterJobs
            .OrderByDescending(j => j.ReceivedAt)
            .Take(Math.Clamp(limit, 1, 500))
            .ToListAsync();
        return Results.Ok(jobs.Select(j => new PrinterJobDto(
            j.Id, j.Status, j.ZplContent?[..Math.Min(200, j.ZplContent.Length)], j.DurationMs, j.ReceivedAt)));
    });

    // ── Laser ─────────────────────────────────────────────────────────────────
    app.MapGet("/api/laser/commands", async (SimulatorDbContext db, int limit = 50) =>
    {
        var cmds = await db.LaserCommands
            .OrderByDescending(c => c.ExecutedAt)
            .Take(Math.Clamp(limit, 1, 500))
            .ToListAsync();
        return Results.Ok(cmds.Select(c => new LaserCommandDto(c.Id, c.RawCommand, c.Status, c.DurationMs, c.ExecutedAt)));
    });

    // ── Vision ────────────────────────────────────────────────────────────────
    app.MapPost("/api/vision/verify", async (
        VisionVerifyRequest req,
        VirtualVisionService vision,
        IConfiguration config) =>
    {
        var delayMs = int.TryParse(config["Simulator:VISION_DELAY_MS"] ?? "500", out var d) ? d : 500;
        var result = await vision.VerifyAsync(req.JobId, delayMs);
        return result.Result == "PASS" ? Results.Ok(result) : Results.UnprocessableEntity(result);
    });

    app.MapPut("/api/vision/config", (UpdateVisionConfigRequest req, VirtualVisionService vision, ISimulatorStateService state) =>
    {
        vision.UpdateConfig(req.PassRate, req.FailureRate);
        return Results.Ok(state.GetVisionState());
    });

    app.MapGet("/api/vision/results", async (SimulatorDbContext db, int limit = 50) =>
    {
        var results = await db.VisionResults
            .OrderByDescending(r => r.VerifiedAt)
            .Take(Math.Clamp(limit, 1, 500))
            .ToListAsync();
        return Results.Ok(results.Select(r => new VisionResultDto(
            r.Id, r.JobId, r.Result, r.DefectCode, r.Confidence, r.OcrText, r.DurationMs, r.VerifiedAt)));
    });

    // ── PLC ───────────────────────────────────────────────────────────────────
    app.MapGet("/api/plc/registers", (ISimulatorStateService state) =>
        Results.Ok(state.GetPlcState().Registers));

    app.MapPut("/api/plc/registers/{name}", async (
        string name,
        PlcRegisterUpdateRequest req,
        VirtualPlcServer plc) =>
    {
        await plc.SetRegisterFromApiAsync(name, req.Value);
        return Results.Ok();
    });

    app.MapGet("/api/plc/events", async (SimulatorDbContext db, int limit = 50) =>
    {
        var evts = await db.PlcRegisterEvents
            .OrderByDescending(e => e.OccurredAt)
            .Take(Math.Clamp(limit, 1, 500))
            .ToListAsync();
        return Results.Ok(evts.Select(e => new PlcRegisterDto(e.RegisterName, e.Value, e.Source, e.OccurredAt)));
    });

    // ── Gateway ───────────────────────────────────────────────────────────────
    app.MapPost("/api/gateway/publish", async (
        GatewayPublishRequest req,
        VirtualFactoryGateway gateway) =>
    {
        try
        {
            await gateway.PublishAsync(req);
            return Results.Ok();
        }
        catch (InvalidOperationException ex)
        {
            return Results.BadRequest(new { error = ex.Message });
        }
    });

    app.MapGet("/api/gateway/events", async (SimulatorDbContext db, int limit = 50) =>
    {
        var evts = await db.GatewayEvents
            .OrderByDescending(e => e.OccurredAt)
            .Take(Math.Clamp(limit, 1, 500))
            .ToListAsync();
        return Results.Ok(evts.Select(e => new GatewayEventDto(e.Id, e.Direction, e.Topic, e.PayloadJson, e.OccurredAt)));
    });

    // ── Timeline ──────────────────────────────────────────────────────────────
    app.MapGet("/api/timeline", async (SimulatorDbContext db, int limit = 100) =>
    {
        var evts = await db.TimelineEvents
            .OrderByDescending(e => e.OccurredAt)
            .Take(Math.Clamp(limit, 1, 1000))
            .ToListAsync();
        return Results.Ok(evts.Select(e => new TimelineEventDto(e.Id, e.Stage, e.Status, e.Detail, e.OccurredAt)));
    });

    // ── Config ────────────────────────────────────────────────────────────────
    app.MapGet("/api/config", async (SimulatorDbContext db) =>
    {
        var values = await db.ConfigurationValues.OrderBy(c => c.Key).ToListAsync();
        return Results.Ok(values.Select(c => new ConfigValueDto(c.Id, c.Key, c.Value, c.Description, c.IsEditable)));
    });

    app.MapPut("/api/config/{key}", async (string key, UpdateConfigValueRequest req, SimulatorDbContext db) =>
    {
        var cfg = await db.ConfigurationValues.FirstOrDefaultAsync(c => c.Key == key);
        if (cfg is null) return Results.NotFound();
        if (!cfg.IsEditable) return Results.BadRequest(new { error = "Read-only config value" });
        cfg.UpdateValue(req.Value);
        await db.SaveChangesAsync();
        return Results.Ok();
    });

    // ── Connections ───────────────────────────────────────────────────────────
    app.MapGet("/api/connections", async (SimulatorDbContext db) =>
    {
        var conns = await db.SystemConnections.ToListAsync();
        return Results.Ok(conns.Select(c => new ConnectionStatusDto(c.ConnectionName, c.Status, c.Detail, c.CheckedAt)));
    });

    app.MapFallbackToFile("index.html");

    await app.RunAsync();
}
catch (Exception ex)
{
    Log.Fatal(ex, "Device Simulator host terminated unexpectedly");
    return 1;
}
finally
{
    await Log.CloseAndFlushAsync();
}

return 0;
