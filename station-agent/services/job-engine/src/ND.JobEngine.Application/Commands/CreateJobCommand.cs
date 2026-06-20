using Microsoft.Extensions.Logging;
using ND.JobEngine.Application.Dtos;
using ND.JobEngine.Application.Interfaces;
using ND.JobEngine.Domain.Entities;
using ND.JobEngine.Domain.Enums;
using ND.JobEngine.Domain.Exceptions;
using ND.SharedKernel.Abstractions;

namespace ND.JobEngine.Application.Commands;

public record CreateJobCommand(
    string JobNo,
    string SourceSystem,
    string JobType,
    string ProductCode,
    string IdempotencyKey,
    string PayloadJson,
    string? ProductSerial = null,
    int Priority = 0);

public sealed class CreateJobHandler
{
    private readonly IJobRepository _jobRepository;
    private readonly IJobHistoryRepository _historyRepository;
    private readonly IJobStateTransitionRepository _transitionRepository;
    private readonly IIdempotencyService _idempotency;
    private readonly IUnitOfWork _unitOfWork;
    private readonly ILogger<CreateJobHandler> _logger;

    public CreateJobHandler(
        IJobRepository jobRepository,
        IJobHistoryRepository historyRepository,
        IJobStateTransitionRepository transitionRepository,
        IIdempotencyService idempotency,
        IUnitOfWork unitOfWork,
        ILogger<CreateJobHandler> logger)
    {
        _jobRepository = jobRepository;
        _historyRepository = historyRepository;
        _transitionRepository = transitionRepository;
        _idempotency = idempotency;
        _unitOfWork = unitOfWork;
        _logger = logger;
    }

    public async Task<JobDto> HandleAsync(CreateJobCommand command, CancellationToken cancellationToken = default)
    {
        // Idempotency: skip if already created
        var idempotencyKey = $"idempotency:job:{command.IdempotencyKey}";
        var isNew = await _idempotency.TryRegisterAsync(idempotencyKey, TimeSpan.FromHours(24), cancellationToken);

        if (!isNew)
        {
            var existing = await _jobRepository.GetByIdempotencyKeyAsync(command.IdempotencyKey, cancellationToken);
            if (existing is not null)
            {
                _logger.LogInformation("Duplicate job creation skipped. IdempotencyKey={Key}", command.IdempotencyKey);
                return MapToDto(existing);
            }
        }

        var job = Job.Create(
            command.JobNo,
            command.SourceSystem,
            command.JobType,
            command.ProductCode,
            command.IdempotencyKey,
            command.PayloadJson,
            command.ProductSerial,
            command.Priority);

        job.Queue();

        await _jobRepository.AddAsync(job, cancellationToken);

        // Record history
        var history = JobHistory.Record(job.Id, JobStatus.Created, JobStatus.Queued, "CREATE_JOB");
        await _historyRepository.AddAsync(history, cancellationToken);

        var transition = JobStateTransition.Record(job.Id, JobStatus.Created, JobStatus.Queued, "CREATE_JOB");
        await _transitionRepository.AddAsync(transition, cancellationToken);

        await _unitOfWork.SaveChangesAsync(cancellationToken);

        _logger.LogInformation(
            "Job created: {JobNo} ({JobId}), Type={JobType}, Status={Status}",
            job.JobNo, job.Id, job.JobType, job.CurrentStatus);

        return MapToDto(job);
    }

    private static JobDto MapToDto(Job job) => new(
        job.Id, job.JobNo, job.SourceSystem, job.JobType,
        job.CurrentStatus, job.ProductCode, job.ProductSerial,
        job.Priority, job.CreatedAt, job.CompletedAt);
}
