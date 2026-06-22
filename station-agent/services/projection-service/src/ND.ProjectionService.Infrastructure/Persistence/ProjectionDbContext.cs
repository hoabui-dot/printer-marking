using Microsoft.EntityFrameworkCore;
using ND.ProjectionService.Domain.Entities;
using ND.SharedKernel.Abstractions;

namespace ND.ProjectionService.Infrastructure.Persistence;

public sealed class ProjectionDbContext : DbContext, IUnitOfWork
{
    public ProjectionDbContext(DbContextOptions<ProjectionDbContext> options) : base(options) { }

    public DbSet<ProductionView> ProductionViews => Set<ProductionView>();
    public DbSet<ActivityLog> ActivityLogs => Set<ActivityLog>();
    public DbSet<DeviceStatus> DeviceStatuses => Set<DeviceStatus>();
    public DbSet<ProductionRecord> ProductionRecords => Set<ProductionRecord>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<ProductionView>(e =>
        {
            e.ToTable("projection_production_view");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.StationId).HasColumnName("station_id").IsRequired();
            e.HasIndex(x => x.StationId).IsUnique();
            e.Property(x => x.JobId).HasColumnName("job_id").IsRequired();
            e.Property(x => x.WorkOrderNo).HasColumnName("work_order_no").IsRequired();
            e.Property(x => x.ProductCode).HasColumnName("product_code").IsRequired();
            e.Property(x => x.ProductSerial).HasColumnName("product_serial");
            e.Property(x => x.JobStatus).HasColumnName("job_status").IsRequired();
            e.Property(x => x.UpdatedAt).HasColumnName("updated_at").IsRequired();
            e.Property(x => x.CreatedAt).HasColumnName("created_at").IsRequired();
        });

        modelBuilder.Entity<ActivityLog>(e =>
        {
            e.ToTable("projection_activity_log");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.EventType).HasColumnName("event_type").IsRequired();
            e.Property(x => x.JobId).HasColumnName("job_id").IsRequired();
            e.Property(x => x.JobNo).HasColumnName("job_no").IsRequired();
            e.Property(x => x.ProductCode).HasColumnName("product_code").IsRequired();
            e.Property(x => x.Status).HasColumnName("status").IsRequired();
            e.Property(x => x.Message).HasColumnName("message").IsRequired();
            e.Property(x => x.OccurredAt).HasColumnName("occurred_at").IsRequired();
            e.Property(x => x.CreatedAt).HasColumnName("created_at").IsRequired();
        });

        modelBuilder.Entity<DeviceStatus>(e =>
        {
            e.ToTable("projection_device_status");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.DeviceId).HasColumnName("device_id").IsRequired();
            e.HasIndex(x => x.DeviceId).IsUnique();
            e.Property(x => x.DeviceType).HasColumnName("device_type").IsRequired();
            e.Property(x => x.IsOnline).HasColumnName("is_online").IsRequired();
            e.Property(x => x.LastSeenAt).HasColumnName("last_seen_at").IsRequired();
            e.Property(x => x.CreatedAt).HasColumnName("created_at").IsRequired();
        });

        modelBuilder.Entity<ProductionRecord>(e =>
        {
            e.ToTable("projection_production_records");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.JobId).HasColumnName("job_id").IsRequired();
            e.HasIndex(x => x.JobId).IsUnique();
            e.Property(x => x.JobNo).HasColumnName("job_no").IsRequired();
            e.Property(x => x.ProductCode).HasColumnName("product_code").IsRequired();
            e.Property(x => x.ProductSerial).HasColumnName("product_serial");
            e.Property(x => x.JobType).HasColumnName("job_type").IsRequired();
            e.Property(x => x.CurrentStatus).HasColumnName("current_status").IsRequired();
            e.Property(x => x.StationId).HasColumnName("station_id").IsRequired();
            e.Property(x => x.CreatedAt).HasColumnName("created_at").IsRequired();
            e.Property(x => x.UpdatedAt).HasColumnName("updated_at").IsRequired();
        });
    }
}

