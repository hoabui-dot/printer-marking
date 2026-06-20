using Microsoft.EntityFrameworkCore;
using ND.MqttAdapter.Application.Interfaces;
using ND.MqttAdapter.Domain.Entities;
using ND.MqttAdapter.Infrastructure.Persistence;

namespace ND.MqttAdapter.Infrastructure.Repositories;

public sealed class MqttMessageRepository : IMqttMessageRepository
{
    private readonly MqttDbContext _context;

    public MqttMessageRepository(MqttDbContext context)
    {
        _context = context;
    }

    public async Task<MqttMessage?> GetByIdAsync(string id, CancellationToken cancellationToken = default)
        => await _context.MqttMessages.FindAsync([id], cancellationToken);

    public async Task<MqttMessage?> GetByMessageIdAsync(string messageId, CancellationToken cancellationToken = default)
        => await _context.MqttMessages.FirstOrDefaultAsync(m => m.MessageId == messageId, cancellationToken);

    public async Task<IReadOnlyList<MqttMessage>> GetAllAsync(CancellationToken cancellationToken = default)
        => await _context.MqttMessages.ToListAsync(cancellationToken);

    public async Task AddAsync(MqttMessage entity, CancellationToken cancellationToken = default)
        => await _context.MqttMessages.AddAsync(entity, cancellationToken);

    public Task UpdateAsync(MqttMessage entity, CancellationToken cancellationToken = default)
    {
        _context.MqttMessages.Update(entity);
        return Task.CompletedTask;
    }

    public async Task DeleteAsync(string id, CancellationToken cancellationToken = default)
    {
        var entity = await GetByIdAsync(id, cancellationToken);
        if (entity is not null)
            _context.MqttMessages.Remove(entity);
    }
}
