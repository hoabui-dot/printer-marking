using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using ND.MqttAdapter.Domain.Entities;
using ND.SharedKernel.Abstractions;

namespace ND.MqttAdapter.Infrastructure.Persistence;

public sealed class MqttDbContext : DbContext, ITransactionalUnitOfWork
{
    public MqttDbContext(DbContextOptions<MqttDbContext> options) : base(options) { }

    /// <inheritdoc />
    public async Task<IDbTransaction> BeginTransactionAsync(CancellationToken cancellationToken = default)
    {
        var efTx = await Database.BeginTransactionAsync(cancellationToken);
        return new EfCoreDbTransaction(efTx);
    }

    /// <summary>
    /// Adapter that wraps an EF Core <see cref="IDbContextTransaction"/>
    /// behind the <see cref="IDbTransaction"/> abstraction.
    /// </summary>
    private sealed class EfCoreDbTransaction : IDbTransaction
    {
        private readonly IDbContextTransaction _tx;
        public EfCoreDbTransaction(IDbContextTransaction tx) => _tx = tx;
        public Task CommitAsync(CancellationToken ct = default) => _tx.CommitAsync(ct);
        public Task RollbackAsync(CancellationToken ct = default) => _tx.RollbackAsync(ct);
        public ValueTask DisposeAsync() => _tx.DisposeAsync();
    }

    public DbSet<MqttMessage> MqttMessages => Set<MqttMessage>();
    public DbSet<MqttOutboxEvent> MqttOutboxEvents => Set<MqttOutboxEvent>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<MqttMessage>(e =>
        {
            e.ToTable("mqtt_messages");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.MessageId).HasColumnName("message_id").IsRequired();
            e.HasIndex(x => x.MessageId).IsUnique();
            e.Property(x => x.Topic).HasColumnName("topic").IsRequired();
            e.Property(x => x.PayloadJson).HasColumnName("payload_json").IsRequired();
            e.Property(x => x.Direction).HasColumnName("direction").IsRequired();
            e.Property(x => x.Status).HasColumnName("status").IsRequired();
            e.Property(x => x.ReceivedAt).HasColumnName("received_at").IsRequired();
            e.Property(x => x.ProcessedAt).HasColumnName("processed_at");
            e.Property(x => x.ErrorMessage).HasColumnName("error_message");
            e.Property(x => x.CreatedAt).HasColumnName("created_at").IsRequired();
        });

        modelBuilder.Entity<MqttOutboxEvent>(e =>
        {
            e.ToTable("mqtt_outbox_events");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.AggregateType).HasColumnName("aggregate_type").IsRequired();
            e.Property(x => x.AggregateId).HasColumnName("aggregate_id").IsRequired();
            e.Property(x => x.EventType).HasColumnName("event_type").IsRequired();
            e.Property(x => x.PayloadJson).HasColumnName("payload_json").IsRequired();
            e.Property(x => x.Topic).HasColumnName("topic").IsRequired();
            e.Property(x => x.Status).HasColumnName("status").IsRequired();
            e.Property(x => x.RetryCount).HasColumnName("retry_count");
            e.Property(x => x.NextRetryAt).HasColumnName("next_retry_at");
            e.Property(x => x.PublishedAt).HasColumnName("published_at");
            e.Property(x => x.CreatedAt).HasColumnName("created_at").IsRequired();
        });
    }
}
