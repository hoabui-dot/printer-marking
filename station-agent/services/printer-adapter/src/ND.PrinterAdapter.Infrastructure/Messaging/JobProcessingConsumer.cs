using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.EntityFrameworkCore;
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
        ILogger<JobProcessingConsumer> logger)
    {
        _scopeFactory = scopeFactory;
        _consumer = consumer;
        _printQueue = printQueue;
        _publisher = publisher;
        _logger = logger;
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

        // Fetch registered printer
        var printer = await db.Printers.FirstOrDefaultAsync(p => p.PrinterCode == "printer-01", cancellationToken);
        if (printer is null)
        {
            _logger.LogError("Default printer (printer-01) not found in database — cannot print");
            return;
        }

        // Render simple ZPL content
        var renderedZpl = $"^XA\n^FO50,50^A0N,36,36^FDJob: {evt.JobNo}^FS\n^FO50,100^A0N,36,36^FDSKU: {evt.ProductCode}^FS\n^FO50,150^A0N,36,36^FDSerial: {evt.ProductSerial ?? "N/A"}^FS\n^XZ";

        var printerJob = PrinterJob.Create(evt.JobId, evt.EventId, printer.Id, "STANDARD_ZPL", renderedZpl, copies: 1);
        await db.PrinterJobs.AddAsync(printerJob, cancellationToken);
        printerJob.MarkSent();
        await unitOfWork.SaveChangesAsync(cancellationToken);

        _logger.LogInformation("Queuing ZPL print command for Job {JobNo}...", evt.JobNo);

        var tcs = new TaskCompletionSource<bool>();
        var queuedJob = new PrintJob(
            printer.PrinterCode,
            printer.IpAddress,
            printer.Port,
            renderedZpl,
            evt.JobId,
            evt.EventId,
            "STANDARD_ZPL",
            1,
            Guid.NewGuid().ToString("N"),
            Guid.NewGuid().ToString("N"),
            tcs);

        await _printQueue.QueuePrintJobAsync(queuedJob);
        var success = await tcs.Task;

        if (success)
        {
            printerJob.MarkSuccess();
            _logger.LogInformation("Successfully printed label for Job {JobNo}.", evt.JobNo);
        }
        else
        {
            printerJob.MarkFailed("Connection failed / socket timeout / queue print error");
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
            // We do not fail the processing of the original message because the print was already sent to hardware,
            // but in production, outbox pattern is preferred.
        }
    }
}
