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
        "ALTER TABLE printer_printers ADD COLUMN cups_queue_name TEXT",
        "ALTER TABLE label_templates ADD COLUMN status TEXT NOT NULL DEFAULT 'published'",
        "ALTER TABLE label_templates ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE label_templates ADD COLUMN created_by TEXT",
        "ALTER TABLE label_templates ADD COLUMN updated_by TEXT",
        @"CREATE TABLE IF NOT EXISTS printer_template_assignments (
            id TEXT PRIMARY KEY,
            printer_code TEXT NOT NULL UNIQUE,
            template_id TEXT NOT NULL,
            template_name TEXT,
            assigned_by TEXT,
            assigned_at TEXT NOT NULL,
            created_at TEXT NOT NULL
        )"
    })
    {
        try
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = sql;
            await cmd.ExecuteNonQueryAsync();
        }
        catch { /* Column/table already exists — safe to ignore */ }
    }
    await conn.CloseAsync();

    // Seed default printers (including the physical CUPS printer)
    var printerHost = Environment.GetEnvironmentVariable("PRINTER_HOST") ?? app.Configuration["Printer:Host"] ?? "localhost";
    var printerPort = int.TryParse(Environment.GetEnvironmentVariable("PRINTER_PORT") ?? app.Configuration["Printer:Port"], out var p) ? p : 9100;
    await PrinterDbSeeder.SeedAsync(db, printerHost, printerPort);

    // Seed 5 default label templates
    await SeedDefaultTemplatesAsync(db);
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
    string? status,
    bool includeArchived = false,
    CancellationToken ct = default) =>
{
    var templates = await repo.ListAsync(search, dpi, status, includeArchived, ct);
    return Results.Ok(templates.Select(t => new
    {
        t.Id, t.Name, t.Description, t.Dpi,
        t.LabelWidth, t.LabelHeight,
        templateJson = System.Text.Json.JsonDocument.Parse(t.TemplateJson).RootElement,
        t.Version, t.Status, t.IsDefault,
        t.IsActive, t.CreatedBy, t.UpdatedBy, t.CreatedAt, t.UpdatedAt
    }));
});

// GET /api/label-templates/active — returns the default published template
app.MapGet("/api/label-templates/active", async (
    ILabelTemplateRepository repo,
    ILoggerFactory loggerFactory,
    CancellationToken ct) =>
{
    var logger = loggerFactory.CreateLogger("PrinterAdapter.Api");
    logger.LogInformation("[API] GET /api/label-templates/active called.");
    var template = await repo.GetDefaultAsync(ct);
    if (template is null)
    {
        logger.LogWarning("[API] No default template found.");
        return Results.NotFound(new { error = "No default published template found." });
    }
    logger.LogInformation("[API] Returning active template '{Name}' v{Version}", template.Name, template.Version);
    try
    {
        var parsed = System.Text.Json.JsonDocument.Parse(template.TemplateJson).RootElement;
        return Results.Ok(new
        {
            template.Id, template.Name, template.Description,
            template.Dpi, template.LabelWidth, template.LabelHeight,
            templateJson = parsed, template.Version, template.Status,
            template.IsDefault, template.IsActive, template.CreatedAt, template.UpdatedAt
        });
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "[API] Failed to parse TemplateJson for '{Name}'", template.Name);
        throw;
    }
});

// GET /api/label-templates/default
app.MapGet("/api/label-templates/default", async (ILabelTemplateRepository repo, CancellationToken ct) =>
{
    var template = await repo.GetDefaultAsync(ct);
    if (template is null) return Results.NotFound(new { error = "No default template set." });
    return Results.Ok(new
    {
        template.Id, template.Name, template.Description,
        template.Dpi, template.LabelWidth, template.LabelHeight,
        templateJson = System.Text.Json.JsonDocument.Parse(template.TemplateJson).RootElement,
        template.Version, template.Status, template.IsDefault,
        template.IsActive, template.CreatedAt, template.UpdatedAt
    });
});

// POST /api/label-templates/{id}/publish
app.MapPost("/api/label-templates/{id}/publish", async (
    string id, ILabelTemplateRepository repo, IUnitOfWork uow, CancellationToken ct) =>
{
    var template = await repo.GetByIdAsync(id, ct);
    if (template is null) return Results.NotFound();
    template.Publish();
    await repo.UpdateAsync(template, ct);
    await uow.SaveChangesAsync(ct);
    return Results.Ok(new { template.Id, template.Status, template.Version });
});

// POST /api/label-templates/{id}/archive
app.MapPost("/api/label-templates/{id}/archive", async (
    string id, ILabelTemplateRepository repo, IUnitOfWork uow, CancellationToken ct) =>
{
    var template = await repo.GetByIdAsync(id, ct);
    if (template is null) return Results.NotFound();
    template.Archive();
    await repo.UpdateAsync(template, ct);
    await uow.SaveChangesAsync(ct);
    return Results.Ok(new { template.Id, template.Status, template.Version });
});

// POST /api/label-templates/{id}/set-default
app.MapPost("/api/label-templates/{id}/set-default", async (
    string id, ILabelTemplateRepository repo, IUnitOfWork uow, CancellationToken ct) =>
{
    var template = await repo.GetByIdAsync(id, ct);
    if (template is null) return Results.NotFound();
    if (template.Status == "archived")
        return Results.BadRequest(new { error = "Cannot set an archived template as default." });
    await repo.ClearDefaultFlagAsync(ct);
    template.SetAsDefault();
    await repo.UpdateAsync(template, ct);
    await uow.SaveChangesAsync(ct);
    return Results.Ok(new { template.Id, template.IsDefault, template.Status });
});

// GET /api/label-templates/{id}/export
app.MapGet("/api/label-templates/{id}/export", async (
    string id, ILabelTemplateRepository repo, CancellationToken ct) =>
{
    var template = await repo.GetByIdAsync(id, ct);
    if (template is null) return Results.NotFound();
    var export = new
    {
        exportVersion = 1,
        exportedAt = DateTime.UtcNow.ToString("o"),
        template = new
        {
            template.Name, template.Description, template.Dpi,
            template.LabelWidth, template.LabelHeight,
            templateJson = System.Text.Json.JsonDocument.Parse(template.TemplateJson).RootElement,
            template.Version, template.Status
        }
    };
    var json = System.Text.Json.JsonSerializer.Serialize(export, new System.Text.Json.JsonSerializerOptions { WriteIndented = true });
    var bytes = System.Text.Encoding.UTF8.GetBytes(json);
    var filename = $"{template.Name.Replace(" ", "_")}_v{template.Version}.json";
    return Results.File(bytes, "application/json", filename);
});

// POST /api/label-templates/import
app.MapPost("/api/label-templates/import", async (
    System.Text.Json.JsonElement body,
    ILabelTemplateRepository repo,
    IUnitOfWork uow,
    CancellationToken ct) =>
{
    try
    {
        var tmpl = body.GetProperty("template");
        var name = tmpl.GetProperty("name").GetString() ?? "Imported Template";
        var desc = tmpl.TryGetProperty("description", out var d) ? d.GetString() : null;
        var dpiVal = tmpl.TryGetProperty("dpi", out var dpiP) ? dpiP.GetInt32() : 203;
        var wVal = tmpl.TryGetProperty("labelWidth", out var wP) ? wP.GetDouble() : 50;
        var hVal = tmpl.TryGetProperty("labelHeight", out var hP) ? hP.GetDouble() : 30;
        var templateJsonProp = tmpl.GetProperty("templateJson");
        var templateJsonStr = templateJsonProp.ValueKind == System.Text.Json.JsonValueKind.String
            ? templateJsonProp.GetString()!
            : templateJsonProp.GetRawText();
        // Validate JSON
        System.Text.Json.JsonDocument.Parse(templateJsonStr);
        var imported = LabelTemplate.Create($"{name} (imported)", desc, dpiVal, wVal, hVal, templateJsonStr, "draft");
        await repo.AddAsync(imported, ct);
        await uow.SaveChangesAsync(ct);
        return Results.Created($"/api/label-templates/{imported.Id}", new { imported.Id, imported.Name, imported.Status });
    }
    catch (Exception ex)
    {
        return Results.BadRequest(new { error = $"Import failed: {ex.Message}" });
    }
});

// ── Printer Assignment API ────────────────────────────────────────────────────

// GET /api/printer-template-assignments
app.MapGet("/api/printer-template-assignments", async (ILabelTemplateRepository repo, CancellationToken ct) =>
    Results.Ok(await repo.GetAllAssignmentsAsync(ct)));

// GET /api/printer-template-assignments/{printerCode}
app.MapGet("/api/printer-template-assignments/{printerCode}", async (
    string printerCode, ILabelTemplateRepository repo, CancellationToken ct) =>
{
    var assignment = await repo.GetAssignmentForPrinterAsync(printerCode, ct);
    return assignment is null ? Results.NotFound() : Results.Ok(assignment);
});

// POST /api/printer-template-assignments
app.MapPost("/api/printer-template-assignments", async (
    AssignPrinterRequest req,
    ILabelTemplateRepository repo,
    IUnitOfWork uow,
    CancellationToken ct) =>
{
    var template = await repo.GetByIdAsync(req.TemplateId, ct);
    if (template is null) return Results.BadRequest(new { error = "Template not found." });
    await repo.UpsertAssignmentAsync(req.PrinterCode, req.TemplateId, template.Name, req.AssignedBy, ct);
    await uow.SaveChangesAsync(ct);
    return Results.Ok(new { req.PrinterCode, req.TemplateId, templateName = template.Name });
});

// DELETE /api/printer-template-assignments/{printerCode}
app.MapDelete("/api/printer-template-assignments/{printerCode}", async (
    string printerCode, ILabelTemplateRepository repo, IUnitOfWork uow, CancellationToken ct) =>
{
    await repo.RemoveAssignmentAsync(printerCode, ct);
    await uow.SaveChangesAsync(ct);
    return Results.NoContent();
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
    if (template is null) return Results.NotFound();
    return Results.Ok(new
    {
        template.Id,
        template.Name,
        template.Description,
        template.Dpi,
        template.LabelWidth,
        template.LabelHeight,
        templateJson = System.Text.Json.JsonDocument.Parse(template.TemplateJson).RootElement,
        template.Version,
        template.IsActive,
        template.CreatedAt,
        template.UpdatedAt
    });
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
    
    var response = new
    {
        template.Id,
        template.Name,
        template.Description,
        template.Dpi,
        template.LabelWidth,
        template.LabelHeight,
        templateJson = System.Text.Json.JsonDocument.Parse(template.TemplateJson).RootElement,
        template.Version,
        template.IsActive,
        template.CreatedAt,
        template.UpdatedAt
    };
    return Results.Created($"/api/label-templates/{template.Id}", response);
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

    return Results.Ok(new
    {
        template.Id,
        template.Name,
        template.Description,
        template.Dpi,
        template.LabelWidth,
        template.LabelHeight,
        templateJson = System.Text.Json.JsonDocument.Parse(template.TemplateJson).RootElement,
        template.Version,
        template.IsActive,
        template.CreatedAt,
        template.UpdatedAt
    });
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
    
    var response = new
    {
        copy.Id,
        copy.Name,
        copy.Description,
        copy.Dpi,
        copy.LabelWidth,
        copy.LabelHeight,
        templateJson = System.Text.Json.JsonDocument.Parse(copy.TemplateJson).RootElement,
        copy.Version,
        copy.IsActive,
        copy.CreatedAt,
        copy.UpdatedAt
    };
    return Results.Created($"/api/label-templates/{copy.Id}", response);
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

// ── Request records ─────────────────────────────────────────────────────────
public record LabelPreviewRequest(string Zpl, int Dpi = 203, double Width = 4, double Height = 2.4);
public record AssignPrinterRequest(string PrinterCode, string TemplateId, string? AssignedBy = null);

// ── Default template seeder ─────────────────────────────────────────────────
static async Task SeedDefaultTemplatesAsync(PrinterDbContext db)
{
    var seeded = new[]
    {
        new
        {
            Name = "50x30 QR Label (Default)",
            Description = "Won Seal Tech Co., Ltd. — 50x30mm landscape QR label for industrial products. DEFAULT.",
            Dpi = 203, Width = 50.0, Height = 30.0, IsDefault = true,
            Json = "{\"width\":50,\"height\":30,\"dpi\":203,\"elements\":[{\"type\":\"text\",\"x\":15,\"y\":20,\"fontSize\":14,\"text\":\"WON SEAL TECH CO., LTD.\"},{\"type\":\"text\",\"x\":15,\"y\":55,\"fontSize\":11,\"binding\":\"product_name\",\"defaultValue\":\"Bearing Seal\"},{\"type\":\"text\",\"x\":15,\"y\":95,\"fontSize\":9,\"text\":\"Product:\"},{\"type\":\"text\",\"x\":100,\"y\":95,\"fontSize\":10,\"binding\":\"product_code\",\"defaultValue\":\"BEARING-SEAL-01\"},{\"type\":\"text\",\"x\":15,\"y\":135,\"fontSize\":9,\"text\":\"Serial:\"},{\"type\":\"text\",\"x\":100,\"y\":135,\"fontSize\":10,\"binding\":\"serial_number\",\"defaultValue\":\"SN-PO-2026-0001-000001\"},{\"type\":\"text\",\"x\":15,\"y\":175,\"fontSize\":9,\"text\":\"Batch:\"},{\"type\":\"text\",\"x\":80,\"y\":175,\"fontSize\":9,\"binding\":\"batch_number\",\"defaultValue\":\"BATCH-01\"},{\"type\":\"text\",\"x\":170,\"y\":175,\"fontSize\":9,\"text\":\"Rev:\"},{\"type\":\"text\",\"x\":215,\"y\":175,\"fontSize\":9,\"binding\":\"revision\",\"defaultValue\":\"A\"},{\"type\":\"text\",\"x\":15,\"y\":210,\"fontSize\":9,\"text\":\"Date:\"},{\"type\":\"text\",\"x\":100,\"y\":210,\"fontSize\":9,\"binding\":\"production_date\",\"defaultValue\":\"2026-07-07\"},{\"type\":\"qr\",\"x\":270,\"y\":70,\"magnification\":4,\"payloadTemplate\":\"{\\\"serial\\\":\\\"{serial_number}\\\",\\\"product\\\":\\\"{product_code}\\\",\\\"revision\\\":\\\"{revision}\\\",\\\"batch\\\":\\\"{batch_number}\\\"}\"}]}"
        },
        new
        {
            Name = "30x50 QR Label (Portrait)",
            Description = "30x50mm portrait QR label for products requiring vertical layout.",
            Dpi = 203, Width = 30.0, Height = 50.0, IsDefault = false,
            Json = "{\"width\":30,\"height\":50,\"dpi\":203,\"elements\":[{\"type\":\"text\",\"x\":10,\"y\":15,\"fontSize\":11,\"text\":\"WON SEAL TECH\"},{\"type\":\"text\",\"x\":10,\"y\":45,\"fontSize\":9,\"binding\":\"product_name\",\"defaultValue\":\"Bearing Seal\"},{\"type\":\"text\",\"x\":10,\"y\":75,\"fontSize\":8,\"text\":\"P/N:\"},{\"type\":\"text\",\"x\":55,\"y\":75,\"fontSize\":8,\"binding\":\"product_code\",\"defaultValue\":\"BEARING-SEAL-01\"},{\"type\":\"text\",\"x\":10,\"y\":105,\"fontSize\":8,\"text\":\"SN:\"},{\"type\":\"text\",\"x\":55,\"y\":105,\"fontSize\":8,\"binding\":\"serial_number\",\"defaultValue\":\"SN-001\"},{\"type\":\"qr\",\"x\":25,\"y\":135,\"magnification\":3,\"payloadTemplate\":\"{\\\"serial\\\":\\\"{serial_number}\\\",\\\"product\\\":\\\"{product_code}\\\"}\"},{\"type\":\"text\",\"x\":10,\"y\":300,\"fontSize\":8,\"binding\":\"production_date\",\"defaultValue\":\"2026-07-07\"}]}"
        },
        new
        {
            Name = "1D Barcode Label 80x40",
            Description = "80x40mm landscape label featuring a Code128 barcode for tracking.",
            Dpi = 203, Width = 80.0, Height = 40.0, IsDefault = false,
            Json = "{\"width\":80,\"height\":40,\"dpi\":203,\"elements\":[{\"type\":\"text\",\"x\":15,\"y\":15,\"fontSize\":14,\"text\":\"WON SEAL TECH CO., LTD.\"},{\"type\":\"text\",\"x\":15,\"y\":50,\"fontSize\":11,\"binding\":\"product_name\",\"defaultValue\":\"Bearing Seal\"},{\"type\":\"text\",\"x\":15,\"y\":85,\"fontSize\":9,\"text\":\"Serial No:\"},{\"type\":\"text\",\"x\":120,\"y\":85,\"fontSize\":9,\"binding\":\"serial_number\",\"defaultValue\":\"SN-001\"},{\"type\":\"barcode\",\"x\":15,\"y\":115,\"height\":80,\"barWidth\":2,\"symbology\":\"Code128\",\"binding\":\"serial_number\",\"defaultValue\":\"SN-001\"},{\"type\":\"text\",\"x\":15,\"y\":215,\"fontSize\":8,\"text\":\"Batch:\"},{\"type\":\"text\",\"x\":80,\"y\":215,\"fontSize\":8,\"binding\":\"batch_number\",\"defaultValue\":\"BATCH-01\"},{\"type\":\"text\",\"x\":250,\"y\":215,\"fontSize\":8,\"text\":\"Date:\"},{\"type\":\"text\",\"x\":315,\"y\":215,\"fontSize\":8,\"binding\":\"production_date\",\"defaultValue\":\"2026-07-07\"}]}"
        },
        new
        {
            Name = "Shipping Label 100x150",
            Description = "100x150mm large shipping label with full product info and QR code.",
            Dpi = 300, Width = 100.0, Height = 150.0, IsDefault = false,
            Json = "{\"width\":100,\"height\":150,\"dpi\":300,\"elements\":[{\"type\":\"text\",\"x\":20,\"y\":20,\"fontSize\":18,\"text\":\"WON SEAL TECH CO., LTD.\"},{\"type\":\"text\",\"x\":20,\"y\":65,\"fontSize\":14,\"binding\":\"product_name\",\"defaultValue\":\"Bearing Seal\"},{\"type\":\"text\",\"x\":20,\"y\":110,\"fontSize\":11,\"text\":\"Product Code:\"},{\"type\":\"text\",\"x\":230,\"y\":110,\"fontSize\":11,\"binding\":\"product_code\",\"defaultValue\":\"BEARING-SEAL-01\"},{\"type\":\"text\",\"x\":20,\"y\":150,\"fontSize\":11,\"text\":\"Serial No:\"},{\"type\":\"text\",\"x\":180,\"y\":150,\"fontSize\":11,\"binding\":\"serial_number\",\"defaultValue\":\"SN-001\"},{\"type\":\"text\",\"x\":20,\"y\":190,\"fontSize\":11,\"text\":\"Batch:\"},{\"type\":\"text\",\"x\":130,\"y\":190,\"fontSize\":11,\"binding\":\"batch_number\",\"defaultValue\":\"BATCH-01\"},{\"type\":\"text\",\"x\":20,\"y\":230,\"fontSize\":11,\"text\":\"Rev:\"},{\"type\":\"text\",\"x\":110,\"y\":230,\"fontSize\":11,\"binding\":\"revision\",\"defaultValue\":\"A\"},{\"type\":\"text\",\"x\":20,\"y\":270,\"fontSize\":11,\"text\":\"Prod. Date:\"},{\"type\":\"text\",\"x\":200,\"y\":270,\"fontSize\":11,\"binding\":\"production_date\",\"defaultValue\":\"2026-07-07\"},{\"type\":\"qr\",\"x\":630,\"y\":80,\"magnification\":5,\"payloadTemplate\":\"{\\\"serial\\\":\\\"{serial_number}\\\",\\\"product\\\":\\\"{product_code}\\\",\\\"revision\\\":\\\"{revision}\\\",\\\"batch\\\":\\\"{batch_number}\\\"}\"},{\"type\":\"text\",\"x\":20,\"y\":340,\"fontSize\":8,\"text\":\"FRAGILE — HANDLE WITH CARE\"}]}"
        },
        new
        {
            Name = "Internal Production Label 50x25",
            Description = "Compact 50x25mm internal label for work-in-progress tracking.",
            Dpi = 203, Width = 50.0, Height = 25.0, IsDefault = false,
            Json = "{\"width\":50,\"height\":25,\"dpi\":203,\"elements\":[{\"type\":\"text\",\"x\":10,\"y\":15,\"fontSize\":10,\"text\":\"WON SEAL TECH\"},{\"type\":\"text\",\"x\":10,\"y\":45,\"fontSize\":9,\"binding\":\"product_code\",\"defaultValue\":\"BEARING-SEAL-01\"},{\"type\":\"text\",\"x\":10,\"y\":75,\"fontSize\":9,\"binding\":\"serial_number\",\"defaultValue\":\"SN-001\"},{\"type\":\"text\",\"x\":10,\"y\":105,\"fontSize\":8,\"binding\":\"batch_number\",\"defaultValue\":\"BATCH-01\"},{\"type\":\"qr\",\"x\":240,\"y\":25,\"magnification\":3,\"payloadTemplate\":\"{\\\"serial\\\":\\\"{serial_number}\\\",\\\"product\\\":\\\"{product_code}\\\"}\"}]}"
        }
    };

    bool changed = false;
    foreach (var s in seeded)
    {
        var existing = await db.LabelTemplates.FirstOrDefaultAsync(t => t.Name == s.Name);
        if (existing is null)
        {
            var t = LabelTemplate.Create(s.Name, s.Description, s.Dpi, s.Width, s.Height, s.Json, "published", "system");
            if (s.IsDefault) t.SetAsDefault();
            await db.LabelTemplates.AddAsync(t);
            changed = true;
        }
        else
        {
            // Ensure default flag is correctly set on existing record
            if (s.IsDefault && !existing.IsDefault)
            {
                existing.SetAsDefault();
                db.LabelTemplates.Update(existing);
                changed = true;
            }
            // Ensure status is published (not archived) for seeded templates
            if (existing.Status == "archived")
            {
                existing.Publish("system");
                db.LabelTemplates.Update(existing);
                changed = true;
            }
        }
    }
    if (changed) await db.SaveChangesAsync();
}
