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
        => await _context.MqttOutboxEvents
            .Where(e => e.Status == "PENDING" &&
                        (e.NextRetryAt == null || string.Compare(e.NextRetryAt, DateTime.UtcNow.ToString("o"), StringComparison.Ordinal) <= 0))
            .OrderBy(e => e.CreatedAt)
            .Take(batchSize)
            .ToListAsync(cancellationToken);

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
