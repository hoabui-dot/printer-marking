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

        var allStepsCompleted = steps.All(s => s.Status == StepStatus.Completed || s.Status == StepStatus.Skipped);
        var anyStepFailed = steps.Any(s => s.Status == StepStatus.Failed);

        if (!anyStepFailed)
        {
            // Auto-complete all remaining non-automated steps (all steps other than PRINT_LABEL)
            var remainingPendingSteps = steps
                .Where(s => s.Status == StepStatus.Pending && !s.StepName.Equals("PRINT_LABEL", StringComparison.OrdinalIgnoreCase))
                .OrderBy(s => s.StepOrder)
                .ToList();

            foreach (var pendingStep in remainingPendingSteps)
            {
                _logger.LogInformation("Auto-completing simulated step {StepName} for job {JobId}.", pendingStep.StepName, command.JobId);
                pendingStep.Complete();
                await _stepRepository.UpdateAsync(pendingStep, cancellationToken);

                var nextHistory = JobHistory.Record(job.Id, job.CurrentStatus, job.CurrentStatus, $"STEP_{pendingStep.StepName}_FINISHED", performedBy: "system", attemptId: activeAttempt.Id, note: "Simulated step auto-completed");
                await _historyRepository.AddAsync(nextHistory, cancellationToken);
            }

            // Re-evaluate completion flags
            allStepsCompleted = steps.All(s => s.Status == StepStatus.Completed || s.Status == StepStatus.Skipped);
            anyStepFailed = steps.Any(s => s.Status == StepStatus.Failed);
        }

        if (anyStepFailed)
        {
            var oldStatus = job.CurrentStatus;
            job.Fail();
            activeAttempt.Fail(command.ErrorMessage ?? "A step failed");

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
                command.ErrorMessage);

            var outboxEvent = JobEngineOutboxEvent.Create(
                nameof(Job),
                job.Id,
                jobEvent.EventType,
                JobEventRoutingKeys.Failed,
                System.Text.Json.JsonSerializer.Serialize(jobEvent));

            await _outboxRepository.AddAsync(outboxEvent, cancellationToken);
        }
        else if (allStepsCompleted)
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

        await _unitOfWork.SaveChangesAsync(cancellationToken);
    }
}
