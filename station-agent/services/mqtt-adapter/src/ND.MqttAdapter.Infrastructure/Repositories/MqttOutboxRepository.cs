using Microsoft.EntityFrameworkCore;
using ND.MqttAdapter.Application.Interfaces;
using ND.MqttAdapter.Domain.Entities;
using ND.MqttAdapter.Infrastructure.Persistence;

namespace ND.MqttAdapter.Infrastructure.Repositories;

public sealed class MqttOutboxRepository : IMqttOutboxRepository
{
    private readonly MqttDbContext _context;

    public MqttOutboxRepository(MqttDbContext context)
    {
        _context = context;
    }

    public async Task<MqttOutboxEvent?> GetByIdAsync(string id, CancellationToken cancellationToken = default)
        => await _context.MqttOutboxEvents.FindAsync([id], cancellationToken);

    public async Task<IReadOnlyList<MqttOutboxEvent>> GetAllAsync(CancellationToken cancellationToken = default)
        => await _context.MqttOutboxEvents.ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<MqttOutboxEvent>> GetPendingAsync(int batchSize, CancellationToken cancellationToken = default)
    {
        var nowIso = DateTime.UtcNow.ToString("o");
        // Fetch PENDING records and filter NextRetryAt in memory — EF Core SQLite
        // cannot translate string comparison methods (CompareTo, string.Compare, etc.).
        var pending = await _context.MqttOutboxEvents
            .Where(e => e.Status == "PENDING")
            .OrderBy(e => e.CreatedAt)
            .ToListAsync(cancellationToken);

        return pending
            .Where(e => e.NextRetryAt == null ||
                        string.Compare(e.NextRetryAt, nowIso, StringComparison.Ordinal) <= 0)
            .Take(batchSize)
            .ToList();
    }

    public async Task AddAsync(MqttOutboxEvent entity, CancellationToken cancellationToken = default)
        => await _context.MqttOutboxEvents.AddAsync(entity, cancellationToken);

    public Task UpdateAsync(MqttOutboxEvent entity, CancellationToken cancellationToken = default)
    {
        _context.MqttOutboxEvents.Update(entity);
        return Task.CompletedTask;
    }

    public async Task DeleteAsync(string id, CancellationToken cancellationToken = default)
    {
        var entity = await GetByIdAsync(id, cancellationToken);
        if (entity is not null)
            _context.MqttOutboxEvents.Remove(entity);
    }
}
