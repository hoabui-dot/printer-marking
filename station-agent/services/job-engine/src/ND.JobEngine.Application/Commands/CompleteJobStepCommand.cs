using Microsoft.Extensions.Logging;
using ND.JobEngine.Application.Interfaces;
using ND.JobEngine.Domain.Entities;
using ND.JobEngine.Domain.Enums;
using ND.JobEngine.Domain.Exceptions;
using ND.SharedKernel.Abstractions;
using ND.UnifiedContracts.Events;

namespace ND.JobEngine.Application.Commands;

public record CompleteJobStepCommand(string JobId, string StepName, bool Success, string? ErrorMessage = null);

public sealed class CompleteJobStepHandler
{
    private readonly IJobRepository _jobRepository;
    private readonly IJobAttemptRepository _attemptRepository;
    private readonly IJobStepRepository _stepRepository;
    private readonly IJobHistoryRepository _historyRepository;
    private readonly IJobStateTransitionRepository _transitionRepository;
    private readonly IJobEngineOutboxRepository _outboxRepository;
    private readonly IDistributedLock _distributedLock;
    private readonly IUnitOfWork _unitOfWork;
    private readonly ILogger<CompleteJobStepHandler> _logger;

    public CompleteJobStepHandler(
        IJobRepository jobRepository,
        IJobAttemptRepository attemptRepository,
        IJobStepRepository stepRepository,
        IJobHistoryRepository historyRepository,
        IJobStateTransitionRepository transitionRepository,
        IJobEngineOutboxRepository outboxRepository,
        IDistributedLock distributedLock,
        IUnitOfWork unitOfWork,
        ILogger<CompleteJobStepHandler> logger)
    {
        _jobRepository = jobRepository;
        _attemptRepository = attemptRepository;
        _stepRepository = stepRepository;
        _historyRepository = historyRepository;
        _transitionRepository = transitionRepository;
        _outboxRepository = outboxRepository;
        _distributedLock = distributedLock;
        _unitOfWork = unitOfWork;
        _logger = logger;
    }

    public async Task HandleAsync(CompleteJobStepCommand command, CancellationToken cancellationToken = default)
    {
        var lockKey = $"lock:job:{command.JobId}";

        await using var lockHandle = await _distributedLock.TryAcquireAsync(lockKey, TimeSpan.FromSeconds(30), cancellationToken);
        if (lockHandle is null)
        {
            _logger.LogWarning("Could not acquire lock for job {JobId}. Another process may be handling it.", command.JobId);
            return;
        }

        var job = await _jobRepository.GetByIdAsync(command.JobId, cancellationToken)
            ?? throw new JobNotFoundException(command.JobId);

        var attempts = await _attemptRepository.GetByJobIdAsync(job.Id, cancellationToken);
        var activeAttempt = attempts.OrderByDescending(a => a.AttemptNo).FirstOrDefault();
        if (activeAttempt is null || activeAttempt.ResultStatus != "RUNNING")
        {
            _logger.LogWarning("Active attempt not found or not running for job {JobId}.", command.JobId);
            return;
        }

        var steps = await _stepRepository.GetByAttemptIdAsync(activeAttempt.Id, cancellationToken);
        var step = steps.FirstOrDefault(s => s.StepName.Equals(command.StepName, StringComparison.OrdinalIgnoreCase));
        if (step is null)
        {
            _logger.LogWarning("Step {StepName} not found in active attempt {AttemptId} for job {JobId}.", command.StepName, activeAttempt.Id, command.JobId);
            return;
        }

        if (step.Status != StepStatus.Pending && step.Status != StepStatus.Running)
        {
            _logger.LogInformation("Step {StepName} in attempt {AttemptId} already in status {Status}.", command.StepName, activeAttempt.Id, step.Status);
            return;
        }

        if (command.Success)
        {
            step.Complete();
            _logger.LogInformation("Step {StepName} completed successfully for job {JobId}.", command.StepName, command.JobId);
        }
        else
        {
            step.Fail(command.ErrorMessage ?? "Unknown step failure");
            _logger.LogError("Step {StepName} failed for job {JobId}: {Error}", command.StepName, command.JobId, command.ErrorMessage);
        }

        await _stepRepository.UpdateAsync(step, cancellationToken);

        // Record step update history
        var historyNote = $"Step {command.StepName} finished with success={command.Success}";
        var stepHistory = JobHistory.Record(job.Id, job.CurrentStatus, job.CurrentStatus, $"STEP_{command.StepName}_FINISHED", performedBy: "system", attemptId: activeAttempt.Id, note: historyNote);
        await _historyRepository.AddAsync(stepHistory, cancellationToken);

        if (command.Success)
        {
            // If the completed step was VISION_CHECK, we skip PLC_REJECT
            if (command.StepName.Equals("VISION_CHECK", StringComparison.OrdinalIgnoreCase))
            {
                var plcRejectStep = steps.FirstOrDefault(s => s.StepName.Equals("PLC_REJECT", StringComparison.OrdinalIgnoreCase));
                if (plcRejectStep is not null && plcRejectStep.Status == StepStatus.Pending)
                {
                    plcRejectStep.Skip();
                    await _stepRepository.UpdateAsync(plcRejectStep, cancellationToken);
                    var skipHistory = JobHistory.Record(job.Id, job.CurrentStatus, job.CurrentStatus, "STEP_PLC_REJECT_SKIPPED", performedBy: "system", attemptId: activeAttempt.Id, note: "Vision check passed, PLC reject skipped.");
                    await _historyRepository.AddAsync(skipHistory, cancellationToken);
                }
            }

            // Find next pending step
            var nextStep = steps
                .Where(s => s.Status == StepStatus.Pending)
                .OrderBy(s => s.StepOrder)
                .FirstOrDefault();

            if (nextStep is not null)
            {
                nextStep.Start();
                await _stepRepository.UpdateAsync(nextStep, cancellationToken);

                var startHistory = JobHistory.Record(job.Id, job.CurrentStatus, job.CurrentStatus, $"STEP_{nextStep.StepName}_STARTED", performedBy: "system", attemptId: activeAttempt.Id, note: $"Bắt đầu bước {nextStep.StepName}");
                await _historyRepository.AddAsync(startHistory, cancellationToken);

                var jobEvent = JobProcessingEvent.From(
                    job.Id,
                    job.JobNo,
                    job.JobType,
                    job.ProductCode,
                    job.ProductSerial,
                    job.SourceSystem,
                    activeAttempt.AttemptNo);

                var nextRoutingKey = GetStepRoutingKey(nextStep.StepName);
                var outboxEvent = JobEngineOutboxEvent.Create(
                    nameof(Job),
                    job.Id,
                    jobEvent.EventType,
                    nextRoutingKey,
                    System.Text.Json.JsonSerializer.Serialize(jobEvent));

                await _outboxRepository.AddAsync(outboxEvent, cancellationToken);
            }
            else
            {
                // No pending steps left. Check if there was a failed step (specifically VISION_CHECK)
                var hasFailedStep = steps.Any(s => s.Status == StepStatus.Failed);
                if (hasFailedStep)
                {
                    await FailJobAndAttemptAsync(job, activeAttempt, command.ErrorMessage, steps, cancellationToken);
                }
                else
                {
                    var oldStatus = job.CurrentStatus;
                    job.Complete();
                    activeAttempt.Succeed();

                    await _jobRepository.UpdateAsync(job, cancellationToken);
                    await _attemptRepository.UpdateAsync(activeAttempt, cancellationToken);

                    var jobHistory = JobHistory.Record(job.Id, oldStatus, job.CurrentStatus, "JOB_COMPLETED", performedBy: "system", attemptId: activeAttempt.Id);
                    await _historyRepository.AddAsync(jobHistory, cancellationToken);

                    var transition = JobStateTransition.Record(job.Id, oldStatus, job.CurrentStatus, "JOB_COMPLETED");
                    await _transitionRepository.AddAsync(transition, cancellationToken);

                    var jobEvent = JobCompletedEvent.From(
                        job.Id,
                        job.JobNo,
                        job.JobType,
                        job.ProductCode,
                        job.ProductSerial,
                        job.SourceSystem);

                    var outboxEvent = JobEngineOutboxEvent.Create(
                        nameof(Job),
                        job.Id,
                        jobEvent.EventType,
                        JobEventRoutingKeys.Completed,
                        System.Text.Json.JsonSerializer.Serialize(jobEvent));

                    await _outboxRepository.AddAsync(outboxEvent, cancellationToken);
                }
            }
        }
        else
        {
            if (command.StepName.Equals("VISION_CHECK", StringComparison.OrdinalIgnoreCase))
            {
                var plcRejectStep = steps.FirstOrDefault(s => s.StepName.Equals("PLC_REJECT", StringComparison.OrdinalIgnoreCase));
                if (plcRejectStep is not null && plcRejectStep.Status == StepStatus.Pending)
                {
                    plcRejectStep.Start();
                    await _stepRepository.UpdateAsync(plcRejectStep, cancellationToken);

                    var startHistory = JobHistory.Record(job.Id, job.CurrentStatus, job.CurrentStatus, "STEP_PLC_REJECT_STARTED", performedBy: "system", attemptId: activeAttempt.Id, note: "Bắt đầu bước PLC_REJECT do Vision check lỗi");
                    await _historyRepository.AddAsync(startHistory, cancellationToken);

                    var jobEvent = JobProcessingEvent.From(
                        job.Id,
                        job.JobNo,
                        job.JobType,
                        job.ProductCode,
                        job.ProductSerial,
                        job.SourceSystem,
                        activeAttempt.AttemptNo);

                    var outboxEvent = JobEngineOutboxEvent.Create(
                        nameof(Job),
                        job.Id,
                        jobEvent.EventType,
                        "command.plc.reject",
                        System.Text.Json.JsonSerializer.Serialize(jobEvent));

                    await _outboxRepository.AddAsync(outboxEvent, cancellationToken);
                }
                else
                {
                    await FailJobAndAttemptAsync(job, activeAttempt, command.ErrorMessage, steps, cancellationToken);
                }
            }
            else
            {
                await FailJobAndAttemptAsync(job, activeAttempt, command.ErrorMessage, steps, cancellationToken);
            }
        }

        await _unitOfWork.SaveChangesAsync(cancellationToken);
    }

    public static string GetStepRoutingKey(string stepName)
    {
        return stepName.ToUpperInvariant() switch
        {
            "PRINT_LABEL" => "command.printer.print",
            "LASER_MARK" => "command.laser.mark",
            "VISION_CHECK" => "command.vision.check",
            "PLC_REJECT" => "command.plc.reject",
            _ => "job.processing"
        };
    }

    private async Task FailJobAndAttemptAsync(
        Job job,
        JobAttempt activeAttempt,
        string? errorMessage,
        IEnumerable<JobStep> steps,
        CancellationToken cancellationToken)
    {
        var visionCheckStep = steps.FirstOrDefault(s => s.StepName.Equals("VISION_CHECK", StringComparison.OrdinalIgnoreCase));
        var finalError = errorMessage;
        if (visionCheckStep is not null && !string.IsNullOrEmpty(visionCheckStep.ErrorMessage))
        {
            finalError = visionCheckStep.ErrorMessage;
        }

        var oldStatus = job.CurrentStatus;
        job.Fail();
        activeAttempt.Fail(finalError ?? "A step failed");

        await _jobRepository.UpdateAsync(job, cancellationToken);
        await _attemptRepository.UpdateAsync(activeAttempt, cancellationToken);

        var jobHistory = JobHistory.Record(job.Id, oldStatus, job.CurrentStatus, "JOB_FAILED", performedBy: "system", attemptId: activeAttempt.Id);
        await _historyRepository.AddAsync(jobHistory, cancellationToken);

        var transition = JobStateTransition.Record(job.Id, oldStatus, job.CurrentStatus, "JOB_FAILED");
        await _transitionRepository.AddAsync(transition, cancellationToken);

        var jobEvent = JobFailedEvent.From(
            job.Id,
            job.JobNo,
            job.JobType,
            job.ProductCode,
            job.ProductSerial,
            job.SourceSystem,
            finalError);

        var outboxEvent = JobEngineOutboxEvent.Create(
            nameof(Job),
            job.Id,
            jobEvent.EventType,
            JobEventRoutingKeys.Failed,
            System.Text.Json.JsonSerializer.Serialize(jobEvent));

        await _outboxRepository.AddAsync(outboxEvent, cancellationToken);
    }
}
