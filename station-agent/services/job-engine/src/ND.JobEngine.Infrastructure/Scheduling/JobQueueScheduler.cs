using System.Net.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Configuration;
using ND.JobEngine.Application.Commands;
using ND.JobEngine.Application.Interfaces;
using ND.JobEngine.Domain.Entities;
using ND.JobEngine.Domain.Enums;
using ND.SharedKernel.Abstractions;

namespace ND.JobEngine.Infrastructure.Scheduling;

public record PrinterDetailDto(
    string PrinterCode,
    string DisplayName,
    int Port,
    string IpAddress,
    string Status,
    bool IsActiveForWork);

public sealed class JobQueueScheduler : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IConfiguration _configuration;
    private readonly ILogger<JobQueueScheduler> _logger;
    private readonly HttpClient _httpClient;

    public JobQueueScheduler(
        IServiceScopeFactory scopeFactory,
        IConfiguration configuration,
        ILogger<JobQueueScheduler> logger)
    {
        _scopeFactory = scopeFactory;
        _configuration = configuration;
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
        var historyRepository = scope.ServiceProvider.GetRequiredService<IJobHistoryRepository>();
        var transitionRepository = scope.ServiceProvider.GetRequiredService<IJobStateTransitionRepository>();
        var processHandler = scope.ServiceProvider.GetRequiredService<ProcessJobHandler>();
        var unitOfWork = scope.ServiceProvider.GetRequiredService<IUnitOfWork>();

        // 1. Fetch QUEUED and WAITING jobs
        var queuedJobs = await jobRepository.GetByStatusAsync(JobStatus.Queued, cancellationToken);
        var waitingJobs = await jobRepository.GetByStatusAsync(JobStatus.Waiting, cancellationToken);
        var allPendingJobs = queuedJobs.Concat(waitingJobs).OrderBy(j => j.CreatedAt).ThenByDescending(j => j.Priority).ToList();

        if (!allPendingJobs.Any())
        {
            return;
        }

        // 2. Timeout Check (Fail if queued/waiting > 60s)
        var now = DateTime.UtcNow;
        var timeoutJobs = new List<Job>();
        var remainingJobs = new List<Job>();

        foreach (var job in allPendingJobs)
        {
            if (DateTime.TryParse(job.CreatedAt, out var createdAtUtc) && (now - createdAtUtc).TotalSeconds > 60)
            {
                timeoutJobs.Add(job);
            }
            else
            {
                remainingJobs.Add(job);
            }
        }

        foreach (var job in timeoutJobs)
        {
            _logger.LogWarning("Job {JobId} ({JobNo}) timed out in queue (over 60s). Marking as FAILED.", job.Id, job.JobNo);
            
            var oldStatus = job.CurrentStatus;
            job.Fail("QUEUE_TIMEOUT", "Yêu cầu trong hàng đợi quá 60 giây (lỗi timeout).");
            await jobRepository.UpdateAsync(job, cancellationToken);

            var history = JobHistory.Record(
                job.Id,
                oldStatus,
                JobStatus.Failed,
                "TIMEOUT_IN_QUEUE",
                performedBy: "system",
                note: "Yêu cầu trong hàng đợi quá 60 giây (lỗi timeout).");
            await historyRepository.AddAsync(history, cancellationToken);

            var transition = JobStateTransition.Record(job.Id, oldStatus, JobStatus.Failed, "TIMEOUT_IN_QUEUE");
            await transitionRepository.AddAsync(transition, cancellationToken);
        }

        if (timeoutJobs.Any())
        {
            await unitOfWork.SaveChangesAsync(cancellationToken);
        }

        if (!remainingJobs.Any())
        {
            return;
        }

        // 3. Discover active printers from printer-adapter
        var adapterUrl = _configuration["PRINTER_ADAPTER_URL"] ?? "http://printer-adapter:5003";
        List<PrinterDetailDto>? activePrinters = null;
        try
        {
            activePrinters = await _httpClient.GetFromJsonAsync<List<PrinterDetailDto>>(
                $"{adapterUrl}/api/printers/active", cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning("Failed to fetch active printers from printer-adapter: {Message}", ex.Message);
        }

        // 4. If no active printer devices exist in print marking: FAIL all remaining pending jobs
        if (activePrinters == null || !activePrinters.Any())
        {
            _logger.LogWarning("No active printer devices found in marking. Failing all remaining pending jobs.");
            foreach (var job in remainingJobs)
            {
                var oldStatus = job.CurrentStatus;
                job.Fail("NO_ACTIVE_PRINTER", "Không có thiết bị máy in nào được kích hoạt trong hệ thống.");
                await jobRepository.UpdateAsync(job, cancellationToken);

                var history = JobHistory.Record(
                    job.Id,
                    oldStatus,
                    JobStatus.Failed,
                    "NO_ACTIVE_PRINTER",
                    performedBy: "system",
                    note: "Không có thiết bị máy in nào được kích hoạt.");
                await historyRepository.AddAsync(history, cancellationToken);

                var transition = JobStateTransition.Record(job.Id, oldStatus, JobStatus.Failed, "NO_ACTIVE_PRINTER");
                await transitionRepository.AddAsync(transition, cancellationToken);
            }

            await unitOfWork.SaveChangesAsync(cancellationToken);
            return;
        }

        // 5. Check busy state and identify idle active printers
        var activeJobs = await jobRepository.GetByStatusAsync(JobStatus.Processing, cancellationToken);
        var busyPrinterCodes = activeJobs.Select(j => j.AssignedPrinter).Where(p => p != null).ToHashSet();

        var idlePrinters = activePrinters.Where(p =>
            p.Status.Equals("ONLINE", StringComparison.OrdinalIgnoreCase) &&
            !busyPrinterCodes.Contains(p.PrinterCode)
        ).ToList();

        // 6. If all active devices are busy: change status to WAITING and keep in queue
        if (!idlePrinters.Any())
        {
            _logger.LogInformation("All active printers are busy. Changing any QUEUED jobs to WAITING status.");
            foreach (var job in remainingJobs)
            {
                if (job.CurrentStatus == JobStatus.Queued)
                {
                    job.SetWaiting();
                    await jobRepository.UpdateAsync(job, cancellationToken);

                    var history = JobHistory.Record(
                        job.Id,
                        JobStatus.Queued,
                        JobStatus.Waiting,
                        "MARK_WAITING",
                        performedBy: "system",
                        note: "Tất cả máy in bận. Chuyển sang trạng thái chờ.");
                    await historyRepository.AddAsync(history, cancellationToken);

                    var transition = JobStateTransition.Record(job.Id, JobStatus.Queued, JobStatus.Waiting, "MARK_WAITING");
                    await transitionRepository.AddAsync(transition, cancellationToken);
                }
            }

            await unitOfWork.SaveChangesAsync(cancellationToken);
            return;
        }

        // 7. Dispatch jobs to available idle printers
        int assignedCount = 0;
        foreach (var printer in idlePrinters)
        {
            if (assignedCount >= remainingJobs.Count) break;

            var job = remainingJobs[assignedCount];

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

            // Save database changes before handling Command (which requires updated DB state)
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
