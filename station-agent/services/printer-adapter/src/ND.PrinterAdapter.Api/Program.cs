using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ND.Infrastructure.Observability;
using ND.Infrastructure.Messaging;
using ND.PrinterAdapter.Application.Interfaces;
using ND.PrinterAdapter.Domain.Entities;
using ND.PrinterAdapter.Infrastructure.DeviceAdapters;
using ND.PrinterAdapter.Infrastructure.Messaging;
using ND.PrinterAdapter.Infrastructure.Persistence;
using ND.PrinterAdapter.Infrastructure.Rendering;
using ND.SharedKernel.Abstractions;
using ND.SharedKernel.Time;
using StackExchange.Redis;
using ND.Infrastructure.Redis;
using Serilog;
using FluentValidation;
using ND.PrinterAdapter.Application.DTOs;
using ND.PrinterAdapter.Application.Validation;
using ND.PrinterAdapter.Application.Dtos;

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
builder.Services.AddSingleton<IPrinterDriverFactory, PrinterDriverFactory>();

// Label rendering strategy
builder.Services.AddSingleton<ILabelRenderer, ZplRenderer>();

// Print Queue
builder.Services.AddSingleton<IPrintQueue, PrintQueue>();
builder.Services.AddHostedService<PrintQueueProcessor>();

// Repositories (scoped — use the DbContext's lifetime)
builder.Services.AddScoped<ILabelTemplateRepository, LabelTemplateRepository>();
builder.Services.AddScoped<IPrintHistoryRepository, PrintHistoryRepository>();

// Validators
builder.Services.AddValidatorsFromAssemblyContaining<CreateTemplateRequestValidator>();

// RabbitMQ registrations
builder.Services.Configure<RabbitMqOptions>(builder.Configuration.GetSection(RabbitMqOptions.SectionName));
builder.Services.AddSingleton<IRabbitMqConsumer, RabbitMqConsumer>();
builder.Services.AddSingleton<IRabbitMqPublisher, RabbitMqPublisher>();

// Register hosted consumer
builder.Services.AddHostedService<JobProcessingConsumer>();
builder.Services.AddHostedService<HeartbeatHostedService>();
builder.Services.AddHostedService<PrinterHealthService>();

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddOpenApi();
builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
    p.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader()));

var app = builder.Build();
app.UseCors();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<PrinterDbContext>();
    var dbDir = Path.GetDirectoryName(Path.GetFullPath(dbPath));
    if (!string.IsNullOrEmpty(dbDir)) Directory.CreateDirectory(dbDir);
    await db.Database.EnsureCreatedAsync();

    // Safe schema upgrade for existing databases — SQLite only.
    // EnsureCreated does not add new columns to existing tables, so we do it manually.
    // These are idempotent: SQLite throws "duplicate column name" if it already exists,
    // which we catch and ignore.
    var conn = db.Database.GetDbConnection();
    await conn.OpenAsync();
    foreach (var sql in new[]
    {
        "ALTER TABLE printer_printers ADD COLUMN driver_type TEXT NOT NULL DEFAULT 'simulation'",
        "ALTER TABLE printer_printers ADD COLUMN cups_queue_name TEXT"
    })
    {
        try
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = sql;
            await cmd.ExecuteNonQueryAsync();
        }
        catch { /* Column already exists — safe to ignore */ }
    }
    await conn.CloseAsync();

    // Seed default printers (including the physical CUPS printer)
    var printerHost = Environment.GetEnvironmentVariable("PRINTER_HOST") ?? app.Configuration["Printer:Host"] ?? "localhost";
    var printerPort = int.TryParse(Environment.GetEnvironmentVariable("PRINTER_PORT") ?? app.Configuration["Printer:Port"], out var p) ? p : 9100;
    await PrinterDbSeeder.SeedAsync(db, printerHost, printerPort);
}

if (app.Environment.IsDevelopment())
    app.MapOpenApi();

// ── Infrastructure endpoints ────────────────────────────────────────────────

app.MapGet("/api/printers", async (PrinterDbContext db, CancellationToken ct) =>
    Results.Ok(await db.Printers.Select(p => new
    {
        p.Id, p.PrinterCode, p.DisplayName, p.IpAddress, p.Port,
        p.Protocol, p.Vendor, p.Status, p.DriverType, p.CupsQueueName,
        p.GroupId, p.LastHeartbeatAt
    }).ToListAsync(ct)));

app.MapGet("/api/printers/discover", async (IPrinterDriverFactory driverFactory, ILoggerFactory loggerFactory, CancellationToken ct) =>
{
    // Use CupsPrinterDriver discovery to enumerate CUPS queues
    var cupsQueue = Environment.GetEnvironmentVariable("CUPS_QUEUE") ?? "Zebra_Technologies_ZTC_GK420t";
    var cupsDriver = driverFactory.ResolveByType("cups", cupsQueueName: cupsQueue);
    var discovered = await cupsDriver.DiscoverAsync(ct);
    return Results.Ok(discovered);
});

app.MapGet("/api/printers/{code}/health", async (string code, PrinterDbContext db, IPrinterDriverFactory driverFactory, CancellationToken ct) =>
{
    var printer = await db.Printers.FirstOrDefaultAsync(p => p.PrinterCode == code, ct);
    if (printer is null)
        return Results.NotFound(new { error = $"Printer '{code}' not found" });

    var driver = driverFactory.Resolve(printer);
    var status = await driver.GetStatusAsync(ct);
    var isReady = status is ND.PrinterAdapter.Application.Dtos.PrinterDriverStatus.Idle
                       or ND.PrinterAdapter.Application.Dtos.PrinterDriverStatus.Printing;

    return Results.Ok(new
    {
        printerCode = printer.PrinterCode,
        displayName = printer.DisplayName,
        driverType = printer.DriverType,
        cupsQueueName = printer.CupsQueueName,
        status = status.ToString(),
        isReady,
        checkedAt = DateTimeOffset.UtcNow
    });
});

app.MapPost("/api/printers/{code}/test-connection", async (string code, PrinterDbContext db, IPrinterDriverFactory driverFactory, CancellationToken ct) =>
{
    var printer = await db.Printers.FirstOrDefaultAsync(p => p.PrinterCode == code, ct);
    if (printer is null)
        return Results.NotFound(new { error = $"Printer '{code}' not found" });

    var driver = driverFactory.Resolve(printer);
    var isHealthy = await driver.HealthCheckAsync(ct);
    var status = await driver.GetStatusAsync(ct);

    return Results.Ok(new
    {
        printerCode = printer.PrinterCode,
        driverType = printer.DriverType,
        cupsQueueName = printer.CupsQueueName,
        status = status.ToString(),
        isReachable = isHealthy,
        checkedAt = DateTimeOffset.UtcNow
    });
});

app.MapGet("/health", () => Results.Ok(new { status = "healthy", service = "printer-adapter" }));

// ── Label Template API ──────────────────────────────────────────────────────

// GET /api/label-templates
app.MapGet("/api/label-templates", async (
    ILabelTemplateRepository repo,
    string? search,
    int? dpi,
    CancellationToken ct) =>
{
    var templates = await repo.ListAsync(search, dpi, ct);
    return Results.Ok(templates.Select(t => new
    {
        t.Id, t.Name, t.Description, t.Dpi,
        t.LabelWidth, t.LabelHeight, t.TemplateJson, t.Version,
        t.IsActive, t.CreatedAt, t.UpdatedAt
    }));
});

// GET /api/label-templates/active
app.MapGet("/api/label-templates/active", async (
    PrinterDbContext db,
    CancellationToken ct) =>
{
    var targetTemplate = await db.LabelTemplates.FirstOrDefaultAsync(t => t.Name == "Basic Product Barcode", ct);
    if (targetTemplate is null)
    {
        var defaultJson = @"
{
  ""width"": 100,
  ""height"": 60,
  ""dpi"": 203,
  ""elements"": [
    { ""type"": ""barcode"", ""x"": 100, ""y"": 140, ""height"": 180, ""symbology"": ""Code128"", ""binding"": ""serial_number"" }
  ]
}
";
        targetTemplate = LabelTemplate.Create(
            "Basic Product Barcode",
            "Clean label template displaying only a 1D Code128 barcode and its human-readable serial number.",
            203,
            100,
            60,
            defaultJson
        );

        await db.LabelTemplates.AddAsync(targetTemplate, ct);
        await db.SaveChangesAsync(ct);
    }

    if (!targetTemplate.IsActive)
    {
        var allTemplates = await db.LabelTemplates.ToListAsync(ct);
        foreach (var t in allTemplates)
        {
            if (t.Name == "Basic Product Barcode")
                t.Activate();
            else
                t.Deactivate();
        }
        await db.SaveChangesAsync(ct);
    }
    else
    {
        var otherActive = await db.LabelTemplates.AnyAsync(t => t.Name != "Basic Product Barcode" && t.IsActive, ct);
        if (otherActive)
        {
            var allTemplates = await db.LabelTemplates.ToListAsync(ct);
            foreach (var t in allTemplates)
            {
                if (t.Name == "Basic Product Barcode")
                    t.Activate();
                else
                    t.Deactivate();
            }
            await db.SaveChangesAsync(ct);
        }
    }

    return Results.Ok(targetTemplate);
});

// POST /api/label-templates/preview

app.MapPost("/api/label-templates/preview", async (LabelPreviewRequest req, CancellationToken ct) =>
{
    try
    {
        using var client = new HttpClient();
        client.Timeout = TimeSpan.FromSeconds(15);

        // Labelary API uses dots-per-mm (dpmm) — not raw DPI:
        //   8dpmm  = 203 DPI  (most common desktop/industrial label printer)
        //   12dpmm = 300 DPI
        //   24dpmm = 600 DPI
        var dpiStr = req.Dpi switch
        {
            >= 500 => "24dpmm",
            >= 250 => "12dpmm",
            _      => "8dpmm"    // default: 203 DPI
        };

        // Labelary format: /v1/printers/{dpmm}/labels/{widthInch}x{heightInch}/0/
        var widthInch  = req.Width  > 0 ? req.Width  : 4.0;
        var heightInch = req.Height > 0 ? req.Height : 2.0;
        var url = $"http://api.labelary.com/v1/printers/{dpiStr}/labels/{widthInch}x{heightInch}/0/";

        using var content = new StringContent(req.Zpl, System.Text.Encoding.UTF8, "application/x-www-form-urlencoded");
        client.DefaultRequestHeaders.Add("Accept", "image/png");

        var response = await client.PostAsync(url, content, ct);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            return Results.BadRequest(new { error = $"Labelary returned {response.StatusCode}: {body}" });
        }

        var bytes = await response.Content.ReadAsByteArrayAsync(ct);
        return Results.File(bytes, "image/png");
    }
    catch (TaskCanceledException)
    {
        return Results.BadRequest(new { error = "Preview request timed out (Labelary API unreachable)" });
    }
    catch (Exception ex)
    {
        return Results.BadRequest(new { error = $"Failed to proxy preview request: {ex.Message}" });
    }
});


// GET /api/label-templates/{id}
app.MapGet("/api/label-templates/{id}", async (string id, ILabelTemplateRepository repo, CancellationToken ct) =>
{
    var template = await repo.GetByIdAsync(id, ct);
    return template is null ? Results.NotFound() : Results.Ok(template);
});

// POST /api/label-templates
app.MapPost("/api/label-templates", async (
    CreateTemplateRequest req,
    IValidator<CreateTemplateRequest> validator,
    ILabelTemplateRepository repo,
    IUnitOfWork uow,
    CancellationToken ct) =>
{
    var validationResult = await validator.ValidateAsync(req, ct);
    if (!validationResult.IsValid)
    {
        return Results.ValidationProblem(validationResult.ToDictionary());
    }

    var template = LabelTemplate.Create(req.Name, req.Description, req.Dpi, req.LabelWidth, req.LabelHeight, req.TemplateJson);
    await repo.AddAsync(template, ct);
    await uow.SaveChangesAsync(ct);
    return Results.Created($"/api/label-templates/{template.Id}", template);
});

// PUT /api/label-templates/{id}
app.MapPut("/api/label-templates/{id}", async (
    string id,
    UpdateTemplateRequest req,
    IValidator<UpdateTemplateRequest> validator,
    ILabelTemplateRepository repo,
    IUnitOfWork uow,
    CancellationToken ct) =>
{
    var validationResult = await validator.ValidateAsync(req, ct);
    if (!validationResult.IsValid)
    {
        return Results.ValidationProblem(validationResult.ToDictionary());
    }

    var template = await repo.GetByIdAsync(id, ct);
    if (template is null) return Results.NotFound();

    // Snapshot the current version before overwriting
    var snapshot = LabelTemplateVersion.Snapshot(template.Id, template.Version, template.TemplateJson);
    await repo.AddVersionAsync(snapshot, ct);

    template.Update(req.Name, req.Description, req.Dpi, req.LabelWidth, req.LabelHeight, req.TemplateJson);
    await repo.UpdateAsync(template, ct);
    await uow.SaveChangesAsync(ct);
    return Results.Ok(template);
});

// DELETE /api/label-templates/{id}
app.MapDelete("/api/label-templates/{id}", async (
    string id, ILabelTemplateRepository repo, IUnitOfWork uow, CancellationToken ct) =>
{
    await repo.DeleteAsync(id, ct);
    await uow.SaveChangesAsync(ct);
    return Results.NoContent();
});

// POST /api/label-templates/{id}/duplicate
app.MapPost("/api/label-templates/{id}/duplicate", async (
    string id,
    ILabelTemplateRepository repo,
    IUnitOfWork uow,
    CancellationToken ct) =>
{
    var original = await repo.GetByIdAsync(id, ct);
    if (original is null) return Results.NotFound();

    var copy = LabelTemplate.Create(
        $"{original.Name} (copy)", original.Description,
        original.Dpi, original.LabelWidth, original.LabelHeight, original.TemplateJson);
    await repo.AddAsync(copy, ct);
    await uow.SaveChangesAsync(ct);
    return Results.Created($"/api/label-templates/{copy.Id}", copy);
});

// GET /api/label-templates/{id}/versions
app.MapGet("/api/label-templates/{id}/versions", async (
    string id, ILabelTemplateRepository repo, CancellationToken ct) =>
{
    var versions = await repo.GetVersionHistoryAsync(id, ct);
    return Results.Ok(versions.Select(v => new
    {
        v.Id, v.TemplateId, v.Version, v.CreatedBy, v.CreatedAt
    }));
});

// GET /api/label-templates/{id}/versions/{version}
app.MapGet("/api/label-templates/{id}/versions/{version}", async (
    string id, int version, ILabelTemplateRepository repo, CancellationToken ct) =>
{
    var snap = await repo.GetVersionAsync(id, version, ct);
    return snap is null ? Results.NotFound() : Results.Ok(snap);
});

// ── Render API ───────────────────────────────────────────────────────────────

// POST /api/label-templates/render
// Body: { "templateJson": "...", "data": { "ProductName": "Coffee", ... } }
app.MapPost("/api/label-templates/render", (RenderRequest req, ILabelRenderer renderer) =>
{
    try
    {
        var zpl = renderer.Render(req.TemplateJson, req.Data ?? new Dictionary<string, string>());
        return Results.Ok(new { zpl, rendererType = renderer.RendererType });
    }
    catch (InvalidOperationException ex)
    {
        return Results.BadRequest(new { error = ex.Message });
    }
});

// POST /api/label-templates/{id}/render-with-data
// Renders a stored template with provided runtime data
app.MapPost("/api/label-templates/{id}/render-with-data", async (
    string id,
    RenderWithDataRequest req,
    ILabelTemplateRepository repo,
    ILabelRenderer renderer,
    CancellationToken ct) =>
{
    var template = await repo.GetByIdAsync(id, ct);
    if (template is null) return Results.NotFound();

    try
    {
        var zpl = renderer.Render(template.TemplateJson, req.Data ?? new Dictionary<string, string>());
        return Results.Ok(new
        {
            templateId = template.Id,
            templateVersion = template.Version,
            zpl,
            rendererType = renderer.RendererType
        });
    }
    catch (InvalidOperationException ex)
    {
        return Results.BadRequest(new { error = ex.Message });
    }
});

// ── Print Test API ────────────────────────────────────────────────────────────

// POST /api/label-templates/{id}/print-test
app.MapPost("/api/label-templates/{id}/print-test", async (
    string id,
    PrintTestRequest req,
    ILabelTemplateRepository templateRepo,
    IPrintHistoryRepository historyRepo,
    ILabelRenderer renderer,
    IPrintQueue printQueue,
    PrinterDbContext db,
    IUnitOfWork uow,
    CancellationToken ct) =>
{
    var template = await templateRepo.GetByIdAsync(id, ct);
    if (template is null) return Results.NotFound();

    var printer = await db.Printers.FirstOrDefaultAsync(p => p.PrinterCode == (req.PrinterCode ?? "printer-01"), ct);
    if (printer is null) return Results.BadRequest(new { error = "Printer not found" });

    var data = req.Data ?? new Dictionary<string, string>();
    string zpl;
    try
    {
        zpl = renderer.Render(template.TemplateJson, data);
    }
    catch (Exception ex)
    {
        return Results.BadRequest(new { error = $"Render error: {ex.Message}" });
    }

    var runtimeDataJson = JsonSerializer.Serialize(data);
    var traceId = Guid.NewGuid().ToString("N");
    var correlationId = req.CorrelationId ?? Guid.NewGuid().ToString("N");

    var history = PrintHistory.Create(
        template.Id, template.Name, template.Version,
        printer.PrinterCode, runtimeDataJson, zpl, traceId, correlationId);

    await historyRepo.AddAsync(history, ct);
    await uow.SaveChangesAsync(ct);

    var sw = System.Diagnostics.Stopwatch.StartNew();
    var requestHex = BitConverter.ToString(System.Text.Encoding.UTF8.GetBytes(zpl)).Replace("-", " ");

    var tcs = new TaskCompletionSource<bool>();
    var printJob = new PrintJob(
        printer.PrinterCode,
        printer.IpAddress,
        printer.Port,
        zpl,
        Guid.NewGuid().ToString("N"),
        Guid.NewGuid().ToString("N"),
        template.Id,
        1,
        traceId,
        correlationId,
        tcs);

    await printQueue.QueuePrintJobAsync(printJob);
    var success = await tcs.Task;
    sw.Stop();

    if (success)
        history.MarkSuccess(sw.ElapsedMilliseconds, "ACK");
    else
        history.MarkFailed(sw.ElapsedMilliseconds, "TCP connection failed or timeout");

    history.RecordTcpTraffic(requestHex, success ? "ACK" : null);
    await uow.SaveChangesAsync(ct);

    return Results.Ok(new
    {
        historyId = history.Id,
        success,
        durationMs = sw.ElapsedMilliseconds,
        zpl
    });
});

// ── Print History API ─────────────────────────────────────────────────────────

// GET /api/print-history?page=1&pageSize=50
app.MapGet("/api/print-history", async (
    IPrintHistoryRepository repo,
    int page = 1,
    int pageSize = 50,
    CancellationToken ct = default) =>
{
    var records = await repo.ListAsync(page, pageSize, ct);
    return Results.Ok(records.Select(h => new
    {
        h.Id, h.TemplateName, h.TemplateVersion, h.PrinterCode,
        h.Status, h.DurationMs, h.RetryCount, h.TraceId, h.CorrelationId, h.CreatedAt
    }));
});

// GET /api/print-history/{id}
app.MapGet("/api/print-history/{id}", async (string id, IPrintHistoryRepository repo, CancellationToken ct) =>
{
    var record = await repo.GetByIdAsync(id, ct);
    return record is null ? Results.NotFound() : Results.Ok(record);
});


app.Run();

public record LabelPreviewRequest(string Zpl, int Dpi = 203, double Width = 4, double Height = 2.4);
