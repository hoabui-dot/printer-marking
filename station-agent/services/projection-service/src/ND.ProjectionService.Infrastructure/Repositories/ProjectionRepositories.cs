using Microsoft.EntityFrameworkCore;
using ND.ProjectionService.Application.Interfaces;
using ND.ProjectionService.Domain.Entities;
using ND.ProjectionService.Infrastructure.Persistence;

namespace ND.ProjectionService.Infrastructure.Repositories;

public sealed class ProductionViewRepository : IProductionViewRepository
{
    private readonly ProjectionDbContext _context;

    public ProductionViewRepository(ProjectionDbContext context)
    {
        _context = context;
    }

    public async Task<ProductionView?> GetByIdAsync(string id, CancellationToken ct = default)
        => await _context.ProductionViews.FindAsync([id], ct);

    public async Task<IReadOnlyList<ProductionView>> GetAllAsync(CancellationToken ct = default)
        => await _context.ProductionViews.ToListAsync(ct);

    public async Task<ProductionView?> GetByStationIdAsync(string stationId, CancellationToken ct = default)
        => await _context.ProductionViews.FirstOrDefaultAsync(v => v.StationId == stationId, ct);

    public async Task AddAsync(ProductionView entity, CancellationToken ct = default)
        => await _context.ProductionViews.AddAsync(entity, ct);

    public Task UpdateAsync(ProductionView entity, CancellationToken ct = default)
    {
        _context.ProductionViews.Update(entity);
        return Task.CompletedTask;
    }

    public async Task DeleteAsync(string id, CancellationToken ct = default)
    {
        var entity = await GetByIdAsync(id, ct);
        if (entity is not null)
            _context.ProductionViews.Remove(entity);
    }
}

public sealed class ActivityLogRepository : IActivityLogRepository
{
    private readonly ProjectionDbContext _context;

    public ActivityLogRepository(ProjectionDbContext context)
    {
        _context = context;
    }

    public async Task<ActivityLog?> GetByIdAsync(string id, CancellationToken ct = default)
        => await _context.ActivityLogs.FindAsync([id], ct);

    public async Task<IReadOnlyList<ActivityLog>> GetAllAsync(CancellationToken ct = default)
        => await _context.ActivityLogs.ToListAsync(ct);

    public async Task<IReadOnlyList<ActivityLog>> GetLatestAsync(int limit, CancellationToken ct = default)
    {
        return await _context.ActivityLogs
            .OrderByDescending(e => e.OccurredAt)
            .Take(limit)
            .ToListAsync(ct);
    }

    public async Task TrimExcessAsync(int keepCount, CancellationToken ct = default)
    {
        var count = await _context.ActivityLogs.CountAsync(ct);
        if (count > keepCount)
        {
            var itemsToRemove = await _context.ActivityLogs
                .OrderBy(e => e.OccurredAt)
                .Take(count - keepCount)
                .ToListAsync(ct);

            _context.ActivityLogs.RemoveRange(itemsToRemove);
        }
    }

    public async Task AddAsync(ActivityLog entity, CancellationToken ct = default)
        => await _context.ActivityLogs.AddAsync(entity, ct);

    public Task UpdateAsync(ActivityLog entity, CancellationToken ct = default)
    {
        _context.ActivityLogs.Update(entity);
        return Task.CompletedTask;
    }

    public async Task DeleteAsync(string id, CancellationToken ct = default)
    {
        var entity = await GetByIdAsync(id, ct);
        if (entity is not null)
            _context.ActivityLogs.Remove(entity);
    }
}

public sealed class DeviceStatusRepository : IDeviceStatusRepository
{
    private readonly ProjectionDbContext _context;

    public DeviceStatusRepository(ProjectionDbContext context)
    {
        _context = context;
    }

    public async Task<DeviceStatus?> GetByIdAsync(string id, CancellationToken ct = default)
        => await _context.DeviceStatuses.FindAsync([id], ct);

    public async Task<IReadOnlyList<DeviceStatus>> GetAllAsync(CancellationToken ct = default)
        => await _context.DeviceStatuses.ToListAsync(ct);

    public async Task<DeviceStatus?> GetByDeviceIdAsync(string deviceId, CancellationToken ct = default)
        => await _context.DeviceStatuses.FirstOrDefaultAsync(d => d.DeviceId == deviceId, ct);

    public async Task AddAsync(DeviceStatus entity, CancellationToken ct = default)
        => await _context.DeviceStatuses.AddAsync(entity, ct);

    public Task UpdateAsync(DeviceStatus entity, CancellationToken ct = default)
    {
        _context.DeviceStatuses.Update(entity);
        return Task.CompletedTask;
    }

    public async Task DeleteAsync(string id, CancellationToken ct = default)
    {
        var entity = await GetByIdAsync(id, ct);
        if (entity is not null)
            _context.DeviceStatuses.Remove(entity);
    }
}
