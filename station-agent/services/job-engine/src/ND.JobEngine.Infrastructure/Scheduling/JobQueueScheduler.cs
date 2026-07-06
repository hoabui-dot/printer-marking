using System.Net.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using ND.JobEngine.Application.Commands;
using ND.JobEngine.Application.Interfaces;
using ND.JobEngine.Domain.Enums;
using ND.SharedKernel.Abstractions;

namespace ND.JobEngine.Infrastructure.Scheduling;

public record PrinterDetailDto(
    string PrinterCode,
    string Name,
    int Port,
    string IpAddress,
    string Status,
    bool Online,
    string SimulatorMode);

public sealed class JobQueueScheduler : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<JobQueueScheduler> _logger;
    private readonly HttpClient _httpClient;

    public JobQueueScheduler(
        IServiceScopeFactory scopeFactory,
        ILogger<JobQueueScheduler> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
        _httpClient = new HttpClient();
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Job Queue Scheduler starting...");

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ProcessQueueAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogError(ex, "Error processing job queue scheduler loop");
            }

            await Task.Delay(1500, stoppingToken);
        }
    }

    private async Task ProcessQueueAsync(CancellationToken cancellationToken)
    {
        using var scope = _scopeFactory.CreateScope();
        var jobRepository = scope.ServiceProvider.GetRequiredService<IJobRepository>();
        var itemRepository = scope.ServiceProvider.GetRequiredService<IProductionItemRepository>();
        var processHandler = scope.ServiceProvider.GetRequiredService<ProcessJobHandler>();
        var unitOfWork = scope.ServiceProvider.GetRequiredService<IUnitOfWork>();

        // 1. Discover printers from simulator
        List<PrinterDetailDto>? printers = null;
        try
        {
            printers = await _httpClient.GetFromJsonAsync<List<PrinterDetailDto>>(
                "http://device-simulator:8080/api/devices/printers", cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning("Failed to discover virtual printers from simulator: {Message}", ex.Message);
        }

        if (printers == null || !printers.Any())
        {
            return;
        }

        // Filter for eligible idle printers
        var idlePrinters = printers.Where(p => 
            p.Online && 
            p.Status.Equals("IDLE", StringComparison.OrdinalIgnoreCase) && 
            !p.SimulatorMode.Equals("Offline", StringComparison.OrdinalIgnoreCase) && 
            !p.SimulatorMode.Equals("TcpConnectionRefused", StringComparison.OrdinalIgnoreCase)
        ).ToList();

        if (!idlePrinters.Any())
        {
            return;
        }

        // 2. Fetch QUEUED jobs
        var queuedJobs = await jobRepository.GetByStatusAsync(JobStatus.Queued, cancellationToken);
        if (!queuedJobs.Any())
        {
            return;
        }

        // Sort: Oldest first, then highest priority
        var jobsToAssign = queuedJobs
            .OrderBy(j => j.CreatedAt)
            .ThenByDescending(j => j.Priority)
            .ToList();

        // 3. Match jobs to idle printers
        int assignedCount = 0;
        foreach (var printer in idlePrinters)
        {
            if (assignedCount >= jobsToAssign.Count) break;

            var job = jobsToAssign[assignedCount];
            
            // Check if there is already an active job running on this printer to be safe
            var activeJobs = await jobRepository.GetByStatusAsync(JobStatus.Processing, cancellationToken);
            if (activeJobs.Any(j => j.AssignedPrinter == printer.PrinterCode))
            {
                continue; // printer is busy, skip
            }

            _logger.LogInformation("Scheduler: Assigning Job {JobId} ({JobNo}) to Printer {PrinterCode}",
                job.Id, job.JobNo, printer.PrinterCode);

            // Assign printer to job
            job.AssignPrinter(printer.PrinterCode);
            await jobRepository.UpdateAsync(job, cancellationToken);

            // Update corresponding production item status to PROCESSING
            var items = await itemRepository.GetByOrderNoAsync(job.JobNo, cancellationToken);
            var item = items.FirstOrDefault(i => i.CurrentJobId == job.Id);
            if (item != null)
            {
                item.StartProcessing();
                await itemRepository.UpdateAsync(item, cancellationToken);
            }

            // Save database changes
            await unitOfWork.SaveChangesAsync(cancellationToken);

            // Start processing the job
            var processCommand = new ProcessJobCommand(job.Id, TriggerType.Auto);
            try
            {
                await processHandler.HandleAsync(processCommand, cancellationToken);
                assignedCount++;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to start processing job {JobId} on printer {PrinterCode}", 
                    job.Id, printer.PrinterCode);
            }
        }
    }
}
