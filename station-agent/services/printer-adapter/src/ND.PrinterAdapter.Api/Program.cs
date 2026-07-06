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

    // Seed default printer (printer-01)
    var printerHost = Environment.GetEnvironmentVariable("PRINTER_HOST") ?? app.Configuration["Printer:Host"] ?? "localhost";
    var printerPort = int.TryParse(Environment.GetEnvironmentVariable("PRINTER_PORT") ?? app.Configuration["Printer:Port"], out var p) ? p : 9100;
    await PrinterDbSeeder.SeedAsync(db, printerHost, printerPort);
}

if (app.Environment.IsDevelopment())
    app.MapOpenApi();

// ── Infrastructure endpoints ────────────────────────────────────────────────

app.MapGet("/api/printers", async (PrinterDbContext db, CancellationToken ct) =>
    Results.Ok(await db.Printers.ToListAsync(ct)));

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
    var template = await db.LabelTemplates.FirstOrDefaultAsync(t => t.IsActive, ct);
    if (template is null)
    {
        // Seed default template if none exists
        var defaultJson = @"
{
  ""width"": 100,
  ""height"": 60,
  ""dpi"": 203,
  ""elements"": [
    { ""type"": ""text"", ""x"": 50, ""y"": 40, ""fontSize"": 18, ""text"": ""PRODUCT:"" },
    { ""type"": ""text"", ""x"": 220, ""y"": 40, ""fontSize"": 18, ""binding"": ""product_name"" },
    { ""type"": ""text"", ""x"": 50, ""y"": 80, ""fontSize"": 14, ""text"": ""SKU:"" },
    { ""type"": ""text"", ""x"": 120, ""y"": 80, ""fontSize"": 14, ""binding"": ""product_code"" },
    { ""type"": ""text"", ""x"": 280, ""y"": 80, ""fontSize"": 14, ""text"": ""REV:"" },
    { ""type"": ""text"", ""x"": 340, ""y"": 80, ""fontSize"": 14, ""binding"": ""revision"" },
    { ""type"": ""text"", ""x"": 50, ""y"": 120, ""fontSize"": 14, ""text"": ""LOT:"" },
    { ""type"": ""text"", ""x"": 120, ""y"": 120, ""fontSize"": 14, ""binding"": ""lot_number"" },
    { ""type"": ""text"", ""x"": 280, ""y"": 120, ""fontSize"": 14, ""text"": ""BATCH:"" },
    { ""type"": ""text"", ""x"": 360, ""y"": 120, ""fontSize"": 14, ""binding"": ""batch_number"" },
    { ""type"": ""text"", ""x"": 50, ""y"": 160, ""fontSize"": 14, ""text"": ""PO:"" },
    { ""type"": ""text"", ""x"": 120, ""y"": 160, ""fontSize"": 14, ""binding"": ""production_order"" },
    { ""type"": ""text"", ""x"": 280, ""y"": 160, ""fontSize"": 14, ""text"": ""WO:"" },
    { ""type"": ""text"", ""x"": 340, ""y"": 160, ""fontSize"": 14, ""binding"": ""work_order"" },
    { ""type"": ""text"", ""x"": 50, ""y"": 200, ""fontSize"": 14, ""text"": ""SERIAL:"" },
    { ""type"": ""text"", ""x"": 150, ""y"": 200, ""fontSize"": 14, ""binding"": ""serial_number"" },
    { ""type"": ""text"", ""x"": 50, ""y"": 240, ""fontSize"": 14, ""text"": ""MFG DATE:"" },
    { ""type"": ""text"", ""x"": 180, ""y"": 240, ""fontSize"": 14, ""binding"": ""manufacture_date"" },
    { ""type"": ""text"", ""x"": 50, ""y"": 280, ""fontSize"": 14, ""text"": ""OPERATOR:"" },
    { ""type"": ""text"", ""x"": 180, ""y"": 280, ""fontSize"": 14, ""binding"": ""operator"" },
    { ""type"": ""text"", ""x"": 50, ""y"": 320, ""fontSize"": 14, ""text"": ""STATION:"" },
    { ""type"": ""text"", ""x"": 160, ""y"": 320, ""fontSize"": 14, ""binding"": ""station"" },
    { ""type"": ""text"", ""x"": 50, ""y"": 360, ""fontSize"": 14, ""text"": ""ORIGIN:"" },
    { ""type"": ""text"", ""x"": 150, ""y"": 360, ""fontSize"": 14, ""binding"": ""country"" },
    { ""type"": ""datamatrix"", ""x"": 500, ""y"": 100, ""magnification"": 6, ""binding"": ""trace_id"" },
    { ""type"": ""barcode"", ""x"": 50, ""y"": 420, ""height"": 60, ""symbology"": ""Code128"", ""binding"": ""serial_number"" }
  ]
}
";
        template = LabelTemplate.Create(
            "Standard Industrial Rubber Label",
            "Professional standard template containing ECC200 Data Matrix, Code 128 barcode, and planning variables.",
            203,
            100,
            60,
            defaultJson
        );

        await db.LabelTemplates.AddAsync(template, ct);
        await db.SaveChangesAsync(ct);
    }
    return Results.Ok(template);
});

// POST /api/label-templates/preview

app.MapPost("/api/label-templates/preview", async (LabelPreviewRequest req, CancellationToken ct) =>
{
    try
    {
        using var client = new HttpClient();
        var dpiStr = req.Dpi == 300 ? "300dpmm" : "8dpmm";
        var url = $"http://api.labelary.com/v1/printers/{dpiStr}/labels/{req.Width}x{req.Height}/0/";
        
        using var content = new StringContent(req.Zpl, System.Text.Encoding.UTF8, "application/x-www-form-urlencoded");
        client.DefaultRequestHeaders.Add("Accept", "image/png");
        
        var response = await client.PostAsync(url, content, ct);
        if (!response.IsSuccessStatusCode)
        {
            return Results.BadRequest(new { error = $"Labelary returned error: {response.StatusCode}" });
        }
        
        var bytes = await response.Content.ReadAsByteArrayAsync(ct);
        return Results.File(bytes, "image/png");
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
