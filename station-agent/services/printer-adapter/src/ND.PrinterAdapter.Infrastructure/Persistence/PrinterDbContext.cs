using Microsoft.EntityFrameworkCore;
using ND.PrinterAdapter.Domain.Entities;
using ND.SharedKernel.Abstractions;

namespace ND.PrinterAdapter.Infrastructure.Persistence;

public sealed class PrinterDbContext : DbContext, IUnitOfWork
{
    public PrinterDbContext(DbContextOptions<PrinterDbContext> options) : base(options) { }

    public DbSet<Printer> Printers => Set<Printer>();
    public DbSet<PrinterJob> PrinterJobs => Set<PrinterJob>();
    public DbSet<PrinterEvent> PrinterEvents => Set<PrinterEvent>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Printer>(e =>
        {
            e.ToTable("printer_printers");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.PrinterCode).HasColumnName("printer_code").IsRequired();
            e.HasIndex(x => x.PrinterCode).IsUnique();
            e.Property(x => x.DisplayName).HasColumnName("display_name").IsRequired();
            e.Property(x => x.IpAddress).HasColumnName("ip_address").IsRequired();
            e.Property(x => x.Port).HasColumnName("port");
            e.Property(x => x.Protocol).HasColumnName("protocol").IsRequired();
            e.Property(x => x.Vendor).HasColumnName("vendor").IsRequired();
            e.Property(x => x.Status).HasColumnName("status").IsRequired();
            e.Property(x => x.GroupId).HasColumnName("group_id");
            e.Property(x => x.LastHeartbeatAt).HasColumnName("last_heartbeat_at");
            e.Property(x => x.CreatedAt).HasColumnName("created_at").IsRequired();
        });

        modelBuilder.Entity<PrinterJob>(e =>
        {
            e.ToTable("printer_jobs");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.JobId).HasColumnName("job_id").IsRequired();
            e.Property(x => x.AttemptId).HasColumnName("attempt_id").IsRequired();
            e.Property(x => x.PrinterId).HasColumnName("printer_id").IsRequired();
            e.Property(x => x.LabelTemplate).HasColumnName("label_template").IsRequired();
            e.Property(x => x.RenderedContent).HasColumnName("rendered_content").IsRequired();
            e.Property(x => x.PrintStatus).HasColumnName("print_status").IsRequired();
            e.Property(x => x.Copies).HasColumnName("copies");
            e.Property(x => x.SentAt).HasColumnName("sent_at");
            e.Property(x => x.FinishedAt).HasColumnName("finished_at");
            e.Property(x => x.ErrorMessage).HasColumnName("error_message");
            e.Property(x => x.CreatedAt).HasColumnName("created_at").IsRequired();
        });

        modelBuilder.Entity<PrinterEvent>(e =>
        {
            e.ToTable("printer_events");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.PrinterId).HasColumnName("printer_id").IsRequired();
            e.Property(x => x.EventType).HasColumnName("event_type").IsRequired();
            e.Property(x => x.EventData).HasColumnName("event_data");
            e.Property(x => x.OccurredAt).HasColumnName("occurred_at").IsRequired();
            e.Property(x => x.CreatedAt).HasColumnName("created_at").IsRequired();
        });
    }
}
