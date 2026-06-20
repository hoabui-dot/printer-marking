using Microsoft.EntityFrameworkCore;
using ND.JobEngine.Domain.Entities;
using ND.SharedKernel.Abstractions;

namespace ND.JobEngine.Infrastructure.Persistence;

public sealed class JobEngineDbContext : DbContext, IUnitOfWork
{
    public JobEngineDbContext(DbContextOptions<JobEngineDbContext> options) : base(options) { }

    public DbSet<Job> Jobs => Set<Job>();
    public DbSet<JobAttempt> JobAttempts => Set<JobAttempt>();
    public DbSet<JobStep> JobSteps => Set<JobStep>();
    public DbSet<JobHistory> JobHistories => Set<JobHistory>();
    public DbSet<JobStateTransition> JobStateTransitions => Set<JobStateTransition>();
    public DbSet<OverwriteRequest> OverwriteRequests => Set<OverwriteRequest>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Job>(e =>
        {
            e.ToTable("job_engine_jobs");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.JobNo).HasColumnName("job_no").IsRequired();
            e.HasIndex(x => x.JobNo).IsUnique();
            e.Property(x => x.SourceSystem).HasColumnName("source_system").IsRequired();
            e.Property(x => x.JobType).HasColumnName("job_type").IsRequired();
            e.Property(x => x.CurrentStatus).HasColumnName("current_status").IsRequired();
            e.Property(x => x.ProductCode).HasColumnName("product_code").IsRequired();
            e.Property(x => x.ProductSerial).HasColumnName("product_serial");
            e.Property(x => x.PayloadJson).HasColumnName("payload_json").IsRequired();
            e.Property(x => x.Priority).HasColumnName("priority");
            e.Property(x => x.IdempotencyKey).HasColumnName("idempotency_key").IsRequired();
            e.HasIndex(x => x.IdempotencyKey).IsUnique();
            e.Property(x => x.CreatedAt).HasColumnName("created_at").IsRequired();
            e.Property(x => x.UpdatedAt).HasColumnName("updated_at").IsRequired();
            e.Property(x => x.CompletedAt).HasColumnName("completed_at");
        });

        modelBuilder.Entity<JobAttempt>(e =>
        {
            e.ToTable("job_engine_job_attempts");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.JobId).HasColumnName("job_id").IsRequired();
            e.Property(x => x.AttemptNo).HasColumnName("attempt_no").IsRequired();
            e.Property(x => x.TriggerType).HasColumnName("trigger_type").IsRequired();
            e.Property(x => x.TriggeredByUserId).HasColumnName("triggered_by_user_id");
            e.Property(x => x.ResultStatus).HasColumnName("result_status").IsRequired();
            e.Property(x => x.StartedAt).HasColumnName("started_at").IsRequired();
            e.Property(x => x.FinishedAt).HasColumnName("finished_at");
            e.Property(x => x.ErrorMessage).HasColumnName("error_message");
            e.Property(x => x.CreatedAt).HasColumnName("created_at").IsRequired();
        });

        modelBuilder.Entity<JobStep>(e =>
        {
            e.ToTable("job_engine_job_steps");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.AttemptId).HasColumnName("attempt_id").IsRequired();
            e.Property(x => x.StepName).HasColumnName("step_name").IsRequired();
            e.Property(x => x.StepOrder).HasColumnName("step_order").IsRequired();
            e.Property(x => x.Status).HasColumnName("status").IsRequired();
            e.Property(x => x.StartedAt).HasColumnName("started_at");
            e.Property(x => x.FinishedAt).HasColumnName("finished_at");
            e.Property(x => x.ResultJson).HasColumnName("result_json");
            e.Property(x => x.ErrorMessage).HasColumnName("error_message");
            e.Property(x => x.CreatedAt).HasColumnName("created_at").IsRequired();
        });

        modelBuilder.Entity<JobHistory>(e =>
        {
            e.ToTable("job_engine_job_history");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.JobId).HasColumnName("job_id").IsRequired();
            e.Property(x => x.AttemptId).HasColumnName("attempt_id");
            e.Property(x => x.OldStatus).HasColumnName("old_status").IsRequired();
            e.Property(x => x.NewStatus).HasColumnName("new_status").IsRequired();
            e.Property(x => x.ActionName).HasColumnName("action_name").IsRequired();
            e.Property(x => x.PerformedBy).HasColumnName("performed_by").IsRequired();
            e.Property(x => x.Note).HasColumnName("note");
            e.Property(x => x.CreatedAt).HasColumnName("created_at").IsRequired();
        });

        modelBuilder.Entity<JobStateTransition>(e =>
        {
            e.ToTable("job_engine_state_transitions");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.JobId).HasColumnName("job_id").IsRequired();
            e.Property(x => x.FromState).HasColumnName("from_state").IsRequired();
            e.Property(x => x.ToState).HasColumnName("to_state").IsRequired();
            e.Property(x => x.Trigger).HasColumnName("trigger").IsRequired();
            e.Property(x => x.CreatedAt).HasColumnName("created_at").IsRequired();
        });

        modelBuilder.Entity<OverwriteRequest>(e =>
        {
            e.ToTable("job_engine_overwrite_requests");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.JobId).HasColumnName("job_id").IsRequired();
            e.Property(x => x.OverwriteType).HasColumnName("overwrite_type").IsRequired();
            e.Property(x => x.Reason).HasColumnName("reason").IsRequired();
            e.Property(x => x.RequestedBy).HasColumnName("requested_by").IsRequired();
            e.Property(x => x.ApprovedBy).HasColumnName("approved_by");
            e.Property(x => x.Status).HasColumnName("status").IsRequired();
            e.Property(x => x.RequestedAt).HasColumnName("requested_at").IsRequired();
            e.Property(x => x.ResolvedAt).HasColumnName("resolved_at");
            e.Property(x => x.CreatedAt).HasColumnName("created_at").IsRequired();
        });
    }
}
