using ND.JobEngine.Domain.Enums;
using ND.JobEngine.Domain.Exceptions;
using ND.SharedKernel.Primitives;

namespace ND.JobEngine.Domain.Entities;

/// <summary>
/// Master record of a production job.
/// Table: job_engine_jobs
/// </summary>
public sealed class Job : AuditableEntity
{
    public string JobNo { get; private set; } = default!;
    public string SourceSystem { get; private set; } = default!;
    public string JobType { get; private set; } = default!;
    public string CurrentStatus { get; private set; } = JobStatus.Created;
    public string ProductCode { get; private set; } = default!;
    public string? ProductSerial { get; private set; }
    public string PayloadJson { get; private set; } = "{}";
    public int Priority { get; private set; } = 0;
    public string IdempotencyKey { get; private set; } = default!;
    public string? CompletedAt { get; private set; }
    public string? AssignedPrinter { get; private set; }
    
    public string? ParentJobId { get; private set; }
    public string? RootJobId { get; private set; }
    public int RetrySequence { get; private set; } = 0;
    public string? ExecutionType { get; private set; } = "OriginalProduction";
    public string? TriggeredByUserId { get; private set; }
    public string? ReasonCode { get; private set; }
    public string? ReasonDescription { get; private set; }

    private Job() { }

    public static Job Create(
        string jobNo,
        string sourceSystem,
        string jobType,
        string productCode,
        string idempotencyKey,
        string payloadJson,
        string? productSerial = null,
        int priority = 0,
        string? parentJobId = null,
        string? rootJobId = null,
        int retrySequence = 0,
        string? executionType = "OriginalProduction",
        string? triggeredByUserId = null,
        string? reasonCode = null,
        string? reasonDescription = null)
    {
        return new Job
        {
            JobNo = jobNo,
            SourceSystem = sourceSystem,
            JobType = jobType,
            ProductCode = productCode,
            ProductSerial = productSerial,
            IdempotencyKey = idempotencyKey,
            PayloadJson = payloadJson,
            Priority = priority,
            CurrentStatus = JobStatus.Created,
            ParentJobId = parentJobId,
            RootJobId = rootJobId,
            RetrySequence = retrySequence,
            ExecutionType = executionType,
            TriggeredByUserId = triggeredByUserId,
            ReasonCode = reasonCode,
            ReasonDescription = reasonDescription
        };
    }

    public void Queue()
    {
        EnsureCanTransition(JobStatus.Queued);
        CurrentStatus = JobStatus.Queued;
        Touch();
    }

    public void StartProcessing()
    {
        if (CurrentStatus != JobStatus.Queued && CurrentStatus != JobStatus.WaitRework)
            throw new InvalidJobTransitionException(Id, CurrentStatus, JobStatus.Processing);
        CurrentStatus = JobStatus.Processing;
        Touch();
    }

    public void Complete()
    {
        EnsureCanTransition(JobStatus.Completed);
        CurrentStatus = JobStatus.Completed;
        CompletedAt = DateTime.UtcNow.ToString("o");
        Touch();
    }

    public void Fail()
    {
        EnsureCanTransition(JobStatus.Failed);
        CurrentStatus = JobStatus.Failed;
        Touch();
    }

    public void WaitForRework()
    {
        if (CurrentStatus != JobStatus.Failed)
            throw new InvalidJobTransitionException(Id, CurrentStatus, JobStatus.WaitRework);
        CurrentStatus = JobStatus.WaitRework;
        Touch();
    }

    public void Cancel()
    {
        if (CurrentStatus == JobStatus.Completed)
            throw new InvalidJobTransitionException(Id, CurrentStatus, JobStatus.Cancelled);
        CurrentStatus = JobStatus.Cancelled;
        Touch();
    }

    public void AssignPrinter(string printerCode)
    {
        AssignedPrinter = printerCode;
        Touch();
    }

    private void EnsureCanTransition(string targetStatus)
    {
        var allowed = targetStatus switch
        {
            JobStatus.Queued => CurrentStatus == JobStatus.Created,
            JobStatus.Completed => CurrentStatus == JobStatus.Processing,
            JobStatus.Failed => CurrentStatus == JobStatus.Processing,
            _ => false
        };

        if (!allowed)
            throw new InvalidJobTransitionException(Id, CurrentStatus, targetStatus);
    }
}
