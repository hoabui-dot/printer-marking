using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.EntityFrameworkCore;
using Microsoft.Data.Sqlite;
using ND.Infrastructure.Messaging;
using ND.PrinterAdapter.Application.Interfaces;
using ND.PrinterAdapter.Domain.Entities;
using ND.PrinterAdapter.Infrastructure.Persistence;
using ND.SharedKernel.Abstractions;
using ND.UnifiedContracts.Events;

namespace ND.PrinterAdapter.Infrastructure.Messaging;

public sealed class JobProcessingConsumer : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IRabbitMqConsumer _consumer;
    private readonly IPrintQueue _printQueue;
    private readonly IRabbitMqPublisher _publisher;
    private readonly ILabelRenderer _labelRenderer;
    private readonly ILogger<JobProcessingConsumer> _logger;

    private const string Exchange = "station.events";
    private const string Queue = "printer-adapter.job-events";
    private const string Pattern = "command.printer.print";

    private static readonly JsonSerializerOptions JsonSerializerOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public JobProcessingConsumer(
        IServiceScopeFactory scopeFactory,
        IRabbitMqConsumer consumer,
        IPrintQueue printQueue,
        IRabbitMqPublisher publisher,
        ILabelRenderer labelRenderer,
        ILogger<JobProcessingConsumer> _logger)
    {
        _scopeFactory = scopeFactory;
        _consumer = consumer;
        _printQueue = printQueue;
        _publisher = publisher;
        _labelRenderer = labelRenderer;
        this._logger = _logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Printer Adapter Job Processing consumer starting...");

        await _consumer.StartConsumingAsync(
            exchange: Exchange,
            queue: Queue,
            routingKeyPattern: Pattern,
            onMessage: (routingKey, json) => HandleMessageAsync(json, stoppingToken),
            cancellationToken: stoppingToken);

        await Task.Delay(Timeout.Infinite, stoppingToken).ConfigureAwait(false);
    }

    private async Task<LabelTemplate> EnsureDefaultTemplateAsync(PrinterDbContext db, CancellationToken ct)
    {
        var targetTemplate = await db.LabelTemplates.FirstOrDefaultAsync(t => t.Name == "Industrial Product QR Label", ct);
        if (targetTemplate is null)
        {
            var defaultJson = @"
{
  ""width"": 50,
  ""height"": 30,
  ""dpi"": 203,
  ""elements"": [
    { ""type"": ""text"", ""x"": 15, ""y"": 15, ""fontSize"": 10, ""text"": ""WON SEAL TECH CO., LTD."" },
    { ""type"": ""text"", ""x"": 15, ""y"": 55, ""fontSize"": 10, ""binding"": ""product_name"", ""defaultValue"": ""Bearing Seal"" },
    { ""type"": ""text"", ""x"": 15, ""y"": 95, ""fontSize"": 9, ""text"": ""Product :"" },
    { ""type"": ""text"", ""x"": 100, ""y"": 95, ""fontSize"": 9, ""binding"": ""product_code"", ""defaultValue"": ""BEARING-SEAL-01"" },
    { ""type"": ""text"", ""x"": 15, ""y"": 140, ""fontSize"": 9, ""text"": ""Serial  :"" },
    { ""type"": ""text"", ""x"": 100, ""y"": 140, ""fontSize"": 9, ""binding"": ""serial_number"", ""defaultValue"": ""SN-PO-2026-0001-000001"" },
    { ""type"": ""text"", ""x"": 15, ""y"": 185, ""fontSize"": 9, ""text"": ""Batch   :"" },
    { ""type"": ""text"", ""x"": 100, ""y"": 185, ""fontSize"": 9, ""binding"": ""batch_number"", ""defaultValue"": ""BATCH-01"" },
    { ""type"": ""text"", ""x"": 220, ""y"": 185, ""fontSize"": 9, ""text"": ""Rev :"" },
    { ""type"": ""text"", ""x"": 280, ""y"": 185, ""fontSize"": 9, ""binding"": ""revision"", ""defaultValue"": ""A"" },
    {
      ""type"": ""qr"",
      ""x"": 280,
      ""y"": 15,
      ""magnification"": 4,
      ""payloadTemplate"": ""{\""serial\"":\""{serial_number}\"",\""product\"":\""{product_code}\"",\""revision\"":\""{revision}\"",\""batch\"":\""{batch_number}\""}""
    }
  ]
}
";
            targetTemplate = LabelTemplate.Create(
                "Industrial Product QR Label",
                "Won Seal Tech Co., Ltd. 50x30mm Professional QR Code manufacturing label.",
                203,
                50,
                30,
                defaultJson
            );

            await db.LabelTemplates.AddAsync(targetTemplate, ct);
            await db.SaveChangesAsync(ct);
        }
        else
        {
            if (targetTemplate.TemplateJson.Contains("\n  \"\"serial\"\"") || targetTemplate.TemplateJson.Contains("\\n") || targetTemplate.TemplateJson.Contains("\n"))
            {
                var defaultJson = @"
{
  ""width"": 50,
  ""height"": 30,
  ""dpi"": 203,
  ""elements"": [
    { ""type"": ""text"", ""x"": 15, ""y"": 15, ""fontSize"": 10, ""text"": ""WON SEAL TECH CO., LTD."" },
    { ""type"": ""text"", ""x"": 15, ""y"": 55, ""fontSize"": 10, ""binding"": ""product_name"", ""defaultValue"": ""Bearing Seal"" },
    { ""type"": ""text"", ""x"": 15, ""y"": 95, ""fontSize"": 9, ""text"": ""Product :"" },
    { ""type"": ""text"", ""x"": 100, ""y"": 95, ""fontSize"": 9, ""binding"": ""product_code"", ""defaultValue"": ""BEARING-SEAL-01"" },
    { ""type"": ""text"", ""x"": 15, ""y"": 140, ""fontSize"": 9, ""text"": ""Serial  :"" },
    { ""type"": ""text"", ""x"": 100, ""y"": 140, ""fontSize"": 9, ""binding"": ""serial_number"", ""defaultValue"": ""SN-PO-2026-0001-000001"" },
    { ""type"": ""text"", ""x"": 15, ""y"": 185, ""fontSize"": 9, ""text"": ""Batch   :"" },
    { ""type"": ""text"", ""x"": 100, ""y"": 185, ""fontSize"": 9, ""binding"": ""batch_number"", ""defaultValue"": ""BATCH-01"" },
    { ""type"": ""text"", ""x"": 220, ""y"": 185, ""fontSize"": 9, ""text"": ""Rev :"" },
    { ""type"": ""text"", ""x"": 280, ""y"": 185, ""fontSize"": 9, ""binding"": ""revision"", ""defaultValue"": ""A"" },
    {
      ""type"": ""qr"",
      ""x"": 280,
      ""y"": 15,
      ""magnification"": 4,
      ""payloadTemplate"": ""{\""serial\"":\""{serial_number}\"",\""product\"":\""{product_code}\"",\""revision\"":\""{revision}\"",\""batch\"":\""{batch_number}\""}""
    }
  ]
}
";
                targetTemplate.Update(
                    "Industrial Product QR Label",
                    "Won Seal Tech Co., Ltd. 50x30mm Professional QR Code manufacturing label.",
                    203,
                    50,
                    30,
                    defaultJson
                );
                db.LabelTemplates.Update(targetTemplate);
                await db.SaveChangesAsync(ct);
            }
        }

        if (!targetTemplate.IsActive)
        {
            var allTemplates = await db.LabelTemplates.ToListAsync(ct);
            foreach (var t in allTemplates)
            {
                if (t.Name == "Industrial Product QR Label")
                    t.Activate();
                else
                    t.Deactivate();
            }
            await db.SaveChangesAsync(ct);
        }
        else
        {
            var otherActive = await db.LabelTemplates.AnyAsync(t => t.Name != "Industrial Product QR Label" && t.IsActive, ct);
            if (otherActive)
            {
                var allTemplates = await db.LabelTemplates.ToListAsync(ct);
                foreach (var t in allTemplates)
                {
                    if (t.Name == "Industrial Product QR Label")
                        t.Activate();
                    else
                        t.Deactivate();
                }
                await db.SaveChangesAsync(ct);
            }
        }

        return targetTemplate;
    }

    private async Task HandleMessageAsync(string payloadJson, CancellationToken cancellationToken)
    {
        _logger.LogInformation("Printer Adapter received job event. Processing...");

        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PrinterDbContext>();
        var unitOfWork = scope.ServiceProvider.GetRequiredService<IUnitOfWork>();

        JobProcessingEvent? evt;
        try
        {
            evt = JsonSerializer.Deserialize<JobProcessingEvent>(payloadJson, JsonSerializerOptions);
        }
        catch (JsonException ex)
        {
            _logger.LogError(ex, "Failed to deserialise JobProcessingEvent payload");
            throw; // Nack
        }

        if (evt is null)
        {
            _logger.LogWarning("Received null JobProcessingEvent — skipping");
            return;
        }

        // Check if job type requires printing
        var requiresPrinting = evt.JobType.Equals("PRINT_ONLY", StringComparison.OrdinalIgnoreCase) ||
                               evt.JobType.Equals("PRINT_AND_MARK", StringComparison.OrdinalIgnoreCase) ||
                               evt.JobType.Equals("REWORK", StringComparison.OrdinalIgnoreCase) ||
                               evt.JobType.Equals("PRINT_LABEL", StringComparison.OrdinalIgnoreCase) ||
                               evt.JobType.Equals("FULL_PROCESS", StringComparison.OrdinalIgnoreCase);

        if (!requiresPrinting)
        {
            _logger.LogInformation("Job {JobNo} of type {JobType} does not require printing — skipping", evt.JobNo, evt.JobType);
            return;
        }

        // Determine dispatch target (simulation vs physical printer)
        var dispatchTarget = evt.DispatchTarget?.ToLowerInvariant() ?? "simulation";
        var isPhysicalPrinter = dispatchTarget == "production-printer";

        // Fetch registered printer based on dispatch target
        Domain.Entities.Printer? printer;
        if (isPhysicalPrinter)
        {
            // Physical: use the CUPS printer
            printer = await db.Printers.FirstOrDefaultAsync(
                p => p.DriverType == "cups", cancellationToken);
            if (printer is null)
            {
                // Fallback to default CUPS code
                printer = await db.Printers.FirstOrDefaultAsync(
                    p => p.PrinterCode == "Zebra-GK420t-CUPS", cancellationToken);
            }
            _logger.LogInformation(
                "Dispatch target: PRODUCTION-PRINTER → using CUPS printer '{Code}'",
                printer?.PrinterCode ?? "none");
        }
        else
        {
            // Simulation: use the configured target printer
            var targetPrinterCode = evt.TargetPrinter ?? "Printer-01";
            printer = await db.Printers.FirstOrDefaultAsync(
                p => p.PrinterCode == targetPrinterCode, cancellationToken);
            _logger.LogInformation(
                "Dispatch target: SIMULATION → using printer '{Code}'",
                printer?.PrinterCode ?? targetPrinterCode);
        }

        if (printer is null)
        {
            _logger.LogError(
                "No printer found for dispatch_target='{Target}' — cannot print",
                dispatchTarget);
            return;
        }

        // 1. Ensure active template is seeded & loaded
        var template = await EnsureDefaultTemplateAsync(db, cancellationToken);

        // 2. Read payload json variables directly from event payload
        var variables = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        string payloadJsonFromDb = evt.PayloadJson ?? "";

        if (!string.IsNullOrWhiteSpace(payloadJsonFromDb))
        {
            try
            {
                using var doc = JsonDocument.Parse(payloadJsonFromDb);
                var root = doc.RootElement;
                if (root.TryGetProperty("event_id", out var evId))
                    variables["trace_id"] = evId.GetString() ?? "";

                if (root.TryGetProperty("data", out var dataArr) && dataArr.ValueKind == JsonValueKind.Array)
                {
                    foreach (var item in dataArr.EnumerateArray())
                    {
                        var tag = item.TryGetProperty("tag", out var tProp) ? tProp.GetString() : null;
                        var val = item.TryGetProperty("value", out var vProp) ? vProp.GetString() : null;
                        if (!string.IsNullOrEmpty(tag))
                        {
                            variables[tag] = val ?? "";
                            var simpleName = tag.Split('.').Last();
                            if (!variables.ContainsKey(simpleName))
                                variables[simpleName] = val ?? "";
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to parse payload_json from job database");
            }
        }

        // Build resolved dictionary
        var resolvedData = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["production_order"] = evt.JobNo,
            ["work_order"] = evt.ProductSerial ?? "N/A",
            ["workflow"] = "Default Workflow",
            ["operation"] = evt.JobType,
            ["station"] = "STATION-01",
            ["team"] = "Team A",
            ["operator"] = "admin.operator",
            ["product_name"] = evt.ProductCode + " Industrial Part",
            ["product_code"] = evt.ProductCode,
            ["revision"] = "Rev A",
            ["customer"] = "Won Seal Tech",
            ["material"] = "NBR-70",
            ["rubber_type"] = "Synthetic Rubber",
            ["lot_number"] = "LOT-2026-07-A",
            ["batch_number"] = "BATCH-01",
            ["manufacture_date"] = DateTime.UtcNow.ToString("yyyy-MM-dd"),
            ["expiry_date"] = DateTime.UtcNow.AddYears(2).ToString("yyyy-MM-dd"),
            ["country"] = "Vietnam",
            ["serial_number"] = evt.ProductSerial ?? "N/A",
            ["trace_id"] = evt.JobId
        };

        foreach (var kvp in variables)
        {
            var simpleKey = kvp.Key.Split('.').Last();
            resolvedData[kvp.Key] = kvp.Value;
            resolvedData[simpleKey] = kvp.Value;
        }

        // Apply explicit standard overrides
        if (variables.TryGetValue("production.order_number", out var poNum)) resolvedData["production_order"] = poNum;
        if (variables.TryGetValue("production.workflow", out var wfName)) resolvedData["workflow"] = wfName;
        if (variables.TryGetValue("product.name", out var prodName)) resolvedData["product_name"] = prodName;
        if (variables.TryGetValue("product.revision", out var prodRev)) resolvedData["revision"] = prodRev;
        if (variables.TryGetValue("customer.name", out var custName)) resolvedData["customer"] = custName;
        if (variables.TryGetValue("product.material", out var mat)) resolvedData["material"] = mat;
        if (variables.TryGetValue("product.rubber_type", out var rub)) resolvedData["rubber_type"] = rub;
        if (variables.TryGetValue("product.lot", out var lotVal)) resolvedData["lot_number"] = lotVal;
        if (variables.TryGetValue("product.batch", out var batVal)) resolvedData["batch_number"] = batVal;
        if (variables.TryGetValue("product.mfg_date", out var mfgVal)) resolvedData["manufacture_date"] = mfgVal;
        if (variables.TryGetValue("product.exp_date", out var expVal)) resolvedData["expiry_date"] = expVal;
        if (variables.TryGetValue("product.country", out var countVal)) resolvedData["country"] = countVal;
        if (variables.TryGetValue("marking.serial", out var serVal)) resolvedData["serial_number"] = serVal;
        if (variables.TryGetValue("trace_id", out var trId)) resolvedData["trace_id"] = trId;

        // Render ZPL dynamically using template & resolvedData
        var renderedZpl = _labelRenderer.Render(template.TemplateJson, resolvedData);

        var printerJob = PrinterJob.Create(evt.JobId, evt.EventId, printer.Id, template.Name, renderedZpl, copies: 1);
        await db.PrinterJobs.AddAsync(printerJob, cancellationToken);
        printerJob.MarkSent();
        await unitOfWork.SaveChangesAsync(cancellationToken);

        // Audit print history
        var runtimeDataJson = JsonSerializer.Serialize(resolvedData, JsonSerializerOptions);
        var printHistory = PrintHistory.Create(
            template.Id,
            template.Name,
            template.Version,
            printer.PrinterCode,
            runtimeDataJson,
            renderedZpl,
            evt.JobId,
            evt.EventId
        );
        await db.PrintHistories.AddAsync(printHistory, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);

        _logger.LogInformation("Queuing ZPL print command for Job {JobNo} using template '{Template}'...", evt.JobNo, template.Name);

        var stopwatch = System.Diagnostics.Stopwatch.StartNew();
        var tcs = new TaskCompletionSource<bool>();
        var queuedJob = new PrintJob(
            printer.PrinterCode,
            printer.IpAddress,
            printer.Port,
            renderedZpl,
            evt.JobId,
            evt.EventId,
            template.Name,
            1,
            Guid.NewGuid().ToString("N"),
            Guid.NewGuid().ToString("N"),
            tcs,
            DriverType: printer.DriverType,
            CupsQueueName: printer.CupsQueueName,
            DispatchTarget: dispatchTarget);

        await _printQueue.QueuePrintJobAsync(queuedJob);
        var success = await tcs.Task;
        stopwatch.Stop();

        if (success)
        {
            printerJob.MarkSuccess();
            printHistory.MarkSuccess(stopwatch.ElapsedMilliseconds, "Printed successfully");
            _logger.LogInformation("Successfully printed label for Job {JobNo}.", evt.JobNo);
        }
        else
        {
            printerJob.MarkFailed("Connection failed / socket timeout / queue print error");
            printHistory.MarkFailed(stopwatch.ElapsedMilliseconds, "Connection failed / socket timeout / queue print error");
            _logger.LogError("Failed to send ZPL print command to printer for Job {JobNo}.", evt.JobNo);
        }

        await unitOfWork.SaveChangesAsync(cancellationToken);

        // Publish print event to RabbitMQ
        var printEvent = new PrinterPrintedEvent
        {
            EventId = $"evt-printer-printed-{Guid.NewGuid():N}",
            JobId = evt.JobId,
            JobNo = evt.JobNo,
            PrinterCode = printer.PrinterCode,
            Success = success,
            ErrorMessage = success ? null : "Connection failed / socket timeout",
            Timestamp = DateTimeOffset.UtcNow.ToString("o")
        };

        try
        {
            var eventJson = JsonSerializer.Serialize(printEvent, JsonSerializerOptions);
            await _publisher.PublishAsync(Exchange, JobEventRoutingKeys.PrinterPrinted, eventJson, cancellationToken);
            _logger.LogInformation("Published PrinterPrintedEvent for Job {JobNo} (Success={Success})", evt.JobNo, success);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to publish PrinterPrintedEvent for Job {JobNo}", evt.JobNo);
        }
    }
}
