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

public sealed class ProductionRecordRepository : IProductionRecordRepository
{
    private readonly ProjectionDbContext _context;

    public ProductionRecordRepository(ProjectionDbContext context)
    {
        _context = context;
    }

    public async Task<ProductionRecord?> GetByIdAsync(string id, CancellationToken ct = default)
        => await _context.ProductionRecords.FindAsync([id], ct);

    public async Task<IReadOnlyList<ProductionRecord>> GetAllAsync(CancellationToken ct = default)
        => await _context.ProductionRecords.ToListAsync(ct);

    public async Task AddAsync(ProductionRecord entity, CancellationToken ct = default)
        => await _context.ProductionRecords.AddAsync(entity, ct);

    public Task UpdateAsync(ProductionRecord entity, CancellationToken ct = default)
    {
        _context.ProductionRecords.Update(entity);
        return Task.CompletedTask;
    }

    public async Task DeleteAsync(string id, CancellationToken ct = default)
    {
        var entity = await GetByIdAsync(id, ct);
        if (entity is not null)
            _context.ProductionRecords.Remove(entity);
    }

    public async Task<ProductionRecord?> GetByJobIdAsync(string jobId, CancellationToken ct = default)
        => await _context.ProductionRecords.FirstOrDefaultAsync(r => r.JobId == jobId, ct);

    public async Task<(IReadOnlyList<ProductionRecord> Items, int TotalCount)> GetTodayAsync(
        int page, int pageSize, CancellationToken ct = default)
    {
        var todayUtc = DateTime.UtcNow.Date;
        var startOfToday = todayUtc.ToString("o");
        var endOfToday = todayUtc.AddDays(1).ToString("o");

        var query = _context.ProductionRecords
            .Where(r => string.Compare(r.CreatedAt, startOfToday) >= 0 && string.Compare(r.CreatedAt, endOfToday) < 0)
            .OrderByDescending(r => r.CreatedAt);

        var totalCount = await query.CountAsync(ct);
        var items = await query
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(ct);

        return (items, totalCount);
    }

    public async Task<(IReadOnlyList<ProductionRecord> Items, int TotalCount)> GetHistoryAsync(
        int page,
        int pageSize,
        string? status = null,
        string? productCode = null,
        string? workOrder = null,
        string? dateFrom = null,
        string? dateTo = null,
        CancellationToken ct = default)
    {
        var query = _context.ProductionRecords.AsQueryable();

        if (!string.IsNullOrWhiteSpace(status))
        {
            query = query.Where(r => r.CurrentStatus == status);
        }
        if (!string.IsNullOrWhiteSpace(productCode))
        {
            query = query.Where(r => r.ProductCode.Contains(productCode));
        }
        if (!string.IsNullOrWhiteSpace(workOrder))
        {
            query = query.Where(r => r.JobNo.Contains(workOrder));
        }
        if (!string.IsNullOrWhiteSpace(dateFrom))
        {
            query = query.Where(r => string.Compare(r.CreatedAt, dateFrom) >= 0);
        }
        if (!string.IsNullOrWhiteSpace(dateTo))
        {
            query = query.Where(r => string.Compare(r.CreatedAt, dateTo) <= 0);
        }

        query = query.OrderByDescending(r => r.CreatedAt);

        var totalCount = await query.CountAsync(ct);
        var items = await query
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(ct);

        return (items, totalCount);
    }
}
