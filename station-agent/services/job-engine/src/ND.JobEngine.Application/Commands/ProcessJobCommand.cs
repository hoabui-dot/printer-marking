using Microsoft.Extensions.Logging;
using ND.JobEngine.Application.Interfaces;
using ND.JobEngine.Domain.Entities;
using ND.JobEngine.Domain.Enums;
using ND.JobEngine.Domain.Exceptions;
using ND.SharedKernel.Abstractions;
using ND.UnifiedContracts.Events;

namespace ND.JobEngine.Application.Commands;

public record ProcessJobCommand(string JobId, string TriggerType = TriggerType.Auto, string? TriggeredByUserId = null);

public sealed class ProcessJobHandler
{
    private readonly IJobRepository _jobRepository;
    private readonly IJobAttemptRepository _attemptRepository;
    private readonly IJobStepRepository _stepRepository;
    private readonly IJobHistoryRepository _historyRepository;
    private readonly IJobStateTransitionRepository _transitionRepository;
    private readonly IJobEngineOutboxRepository _outboxRepository;
    private readonly IDistributedLock _distributedLock;
    private readonly IUnitOfWork _unitOfWork;
    private readonly ILogger<ProcessJobHandler> _logger;

    public ProcessJobHandler(
        IJobRepository jobRepository,
        IJobAttemptRepository attemptRepository,
        IJobStepRepository stepRepository,
        IJobHistoryRepository historyRepository,
        IJobStateTransitionRepository transitionRepository,
        IJobEngineOutboxRepository outboxRepository,
        IDistributedLock distributedLock,
        IUnitOfWork unitOfWork,
        ILogger<ProcessJobHandler> logger)
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

    public async Task HandleAsync(ProcessJobCommand command, CancellationToken cancellationToken = default)
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

        var oldStatus = job.CurrentStatus;
        job.StartProcessing();

        var attemptCount = await _attemptRepository.GetAttemptCountAsync(command.JobId, cancellationToken);
        var attempt = JobAttempt.Create(job.Id, attemptCount + 1, command.TriggerType, command.TriggeredByUserId);
        await _attemptRepository.AddAsync(attempt, cancellationToken);

        // Create steps based on job type
        var steps = CreateStepsForJobType(job.JobType, attempt.Id);
        foreach (var step in steps)
            await _stepRepository.AddAsync(step, cancellationToken);

        await _jobRepository.UpdateAsync(job, cancellationToken);

        var history = JobHistory.Record(job.Id, oldStatus, job.CurrentStatus, "START_PROCESSING", attempt.Id);
        await _historyRepository.AddAsync(history, cancellationToken);

        var transition = JobStateTransition.Record(job.Id, oldStatus, job.CurrentStatus, "START_PROCESSING");
        await _transitionRepository.AddAsync(transition, cancellationToken);

        // Record outbox event for job processing
        var jobEvent = JobProcessingEvent.From(
            job.Id,
            job.JobNo,
            job.JobType,
            job.ProductCode,
            job.ProductSerial,
            job.SourceSystem,
            attempt.AttemptNo);

        var outboxEvent = JobEngineOutboxEvent.Create(
            nameof(Job),
            job.Id,
            jobEvent.EventType,
            JobEventRoutingKeys.Processing,
            System.Text.Json.JsonSerializer.Serialize(jobEvent));

        await _outboxRepository.AddAsync(outboxEvent, cancellationToken);

        await _unitOfWork.SaveChangesAsync(cancellationToken);

        _logger.LogInformation(
            "Job {JobId} processing started. Attempt #{AttemptNo}",
            job.Id, attempt.AttemptNo);
    }

    private static List<JobStep> CreateStepsForJobType(string jobType, string attemptId)
    {
        return jobType switch
        {
            "PRINT_ONLY" =>
            [
                JobStep.Create(attemptId, "PRINT_LABEL", 1),
                JobStep.Create(attemptId, "VISION_CHECK", 2)
            ],
            "MARK_ONLY" =>
            [
                JobStep.Create(attemptId, "LASER_MARK", 1),
                JobStep.Create(attemptId, "VISION_CHECK", 2)
            ],
            "PRINT_AND_MARK" =>
            [
                JobStep.Create(attemptId, "PRINT_LABEL", 1),
                JobStep.Create(attemptId, "LASER_MARK", 2),
                JobStep.Create(attemptId, "VISION_CHECK", 3)
            ],
            "VERIFY_ONLY" =>
            [
                JobStep.Create(attemptId, "VISION_CHECK", 1)
            ],
            "REWORK" =>
            [
                JobStep.Create(attemptId, "PRINT_LABEL", 1),
                JobStep.Create(attemptId, "LASER_MARK", 2),
                JobStep.Create(attemptId, "VISION_CHECK", 3)
            ],
            "PRINT_LABEL" =>
            [
                JobStep.Create(attemptId, "PRINT_LABEL", 1)
            ],
            "LASER_MARK" =>
            [
                JobStep.Create(attemptId, "LASER_MARK", 1)
            ],
            "FULL_PROCESS" =>
            [
                JobStep.Create(attemptId, "PRINT_LABEL", 1),
                JobStep.Create(attemptId, "LASER_MARK", 2),
                JobStep.Create(attemptId, "VISION_CHECK", 3),
                JobStep.Create(attemptId, "PLC_REJECT", 4)
            ],
            _ => [JobStep.Create(attemptId, "DEFAULT", 1)]
        };
    }
}
