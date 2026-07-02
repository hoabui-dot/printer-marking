using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using ND.PrinterAdapter.Application.Interfaces;
using System;
using System.Threading;
using System.Threading.Tasks;

namespace ND.PrinterAdapter.Infrastructure.DeviceAdapters;

public sealed class PrintQueueProcessor : BackgroundService
{
    private readonly PrintQueue _queue;
    private readonly IPrinterAdapter _printerAdapter;
    private readonly ILogger<PrintQueueProcessor> _logger;

    public PrintQueueProcessor(
        IPrintQueue queue,
        IPrinterAdapter printerAdapter,
        ILogger<PrintQueueProcessor> logger)
    {
        _queue = (PrintQueue)queue;
        _printerAdapter = printerAdapter;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Print Queue Processor starting...");

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var job = await _queue.Reader.ReadAsync(stoppingToken);
                // Process sequentially (without await inside ReadAsync loop if we want concurrent, 
                // but since SingleReader=true is to avoid concurrent printer conflicts, 
                // we SHOULD await here to print sequentially one-by-one to avoid concurrent TCP connections to the printer!)
                await ProcessPrintJobAsync(job, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error occurred in Print Queue Processor loop.");
            }
        }

        _logger.LogInformation("Print Queue Processor stopped.");
    }

    private async Task ProcessPrintJobAsync(PrintJob job, CancellationToken ct)
    {
        _logger.LogInformation("Processing enqueued print job for printer {PrinterCode} ({IpAddress}:{Port}). JobId={JobId}, CorrelationId={CorrelationId}",
            job.PrinterCode, job.IpAddress, job.Port, job.JobId, job.CorrelationId);

        var attempt = 0;
        var maxRetries = 3;
        var success = false;

        while (attempt <= maxRetries && !ct.IsCancellationRequested)
        {
            if (attempt > 0)
            {
                _logger.LogInformation("Retrying print job for printer {PrinterCode} ({IpAddress}:{Port}). Attempt {Attempt}/{MaxRetries}",
                    job.PrinterCode, job.IpAddress, job.Port, attempt, maxRetries);
                await Task.Delay(1000 * attempt, ct);
            }

            try
            {
                success = await _printerAdapter.PrintAsync(job.IpAddress, job.Port, job.Content, ct);
                if (success)
                {
                    break;
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to print to {IpAddress}:{Port} on attempt {Attempt}", job.IpAddress, job.Port, attempt);
            }

            attempt++;
        }

        if (success)
        {
            _logger.LogInformation("Successfully printed enqueued job for printer {PrinterCode}.", job.PrinterCode);
            job.CompletionSource.TrySetResult(true);
        }
        else
        {
            _logger.LogError("Failed to print enqueued job for printer {PrinterCode} after {Attempts} attempts.", job.PrinterCode, attempt);
            job.CompletionSource.TrySetResult(false);
        }
    }
}
