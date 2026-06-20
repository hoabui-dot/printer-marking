using Microsoft.EntityFrameworkCore;
using ND.JobEngine.Application.Dtos;
using ND.JobEngine.Application.Interfaces;
using ND.JobEngine.Domain.Entities;
using ND.JobEngine.Infrastructure.Persistence;

namespace ND.JobEngine.Infrastructure.Repositories;

public sealed class JobRepository : IJobRepository
{
    private readonly JobEngineDbContext _context;

    public JobRepository(JobEngineDbContext context) => _context = context;

    public async Task<Job?> GetByIdAsync(string id, CancellationToken ct = default)
        => await _context.Jobs.FindAsync([id], ct);

    public async Task<Job?> GetByJobNoAsync(string jobNo, CancellationToken ct = default)
        => await _context.Jobs.FirstOrDefaultAsync(j => j.JobNo == jobNo, ct);

    public async Task<Job?> GetByIdempotencyKeyAsync(string key, CancellationToken ct = default)
        => await _context.Jobs.FirstOrDefaultAsync(j => j.IdempotencyKey == key, ct);

    public async Task<IReadOnlyList<Job>> GetAllAsync(CancellationToken ct = default)
        => await _context.Jobs.ToListAsync(ct);

    public async Task<IReadOnlyList<Job>> GetByStatusAsync(string status, CancellationToken ct = default)
        => await _context.Jobs.Where(j => j.CurrentStatus == status).ToListAsync(ct);

    public async Task<PagedResult<Job>> GetPagedAsync(
        int page, int pageSize, string? statusFilter, CancellationToken ct = default)
    {
        var query = _context.Jobs.AsQueryable();
        if (!string.IsNullOrWhiteSpace(statusFilter))
            query = query.Where(j => j.CurrentStatus == statusFilter);

        var total = await query.CountAsync(ct);
        var items = await query
            .OrderByDescending(j => j.CreatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(ct);

        return new PagedResult<Job>(items, total, page, pageSize);
    }

    public async Task AddAsync(Job entity, CancellationToken ct = default)
        => await _context.Jobs.AddAsync(entity, ct);

    public Task UpdateAsync(Job entity, CancellationToken ct = default)
    {
        _context.Jobs.Update(entity);
        return Task.CompletedTask;
    }

    public async Task DeleteAsync(string id, CancellationToken ct = default)
    {
        var entity = await GetByIdAsync(id, ct);
        if (entity is not null) _context.Jobs.Remove(entity);
    }
}

public sealed class JobAttemptRepository : IJobAttemptRepository
{
    private readonly JobEngineDbContext _context;

    public JobAttemptRepository(JobEngineDbContext context) => _context = context;

    public async Task<JobAttempt?> GetByIdAsync(string id, CancellationToken ct = default)
        => await _context.JobAttempts.FindAsync([id], ct);

    public async Task<IReadOnlyList<JobAttempt>> GetAllAsync(CancellationToken ct = default)
        => await _context.JobAttempts.ToListAsync(ct);

    public async Task<IReadOnlyList<JobAttempt>> GetByJobIdAsync(string jobId, CancellationToken ct = default)
        => await _context.JobAttempts.Where(a => a.JobId == jobId).OrderBy(a => a.AttemptNo).ToListAsync(ct);

    public async Task<int> GetAttemptCountAsync(string jobId, CancellationToken ct = default)
        => await _context.JobAttempts.CountAsync(a => a.JobId == jobId, ct);

    public async Task AddAsync(JobAttempt entity, CancellationToken ct = default)
        => await _context.JobAttempts.AddAsync(entity, ct);

    public Task UpdateAsync(JobAttempt entity, CancellationToken ct = default)
    {
        _context.JobAttempts.Update(entity);
        return Task.CompletedTask;
    }

    public async Task DeleteAsync(string id, CancellationToken ct = default)
    {
        var entity = await GetByIdAsync(id, ct);
        if (entity is not null) _context.JobAttempts.Remove(entity);
    }
}

public sealed class JobHistoryRepository : IJobHistoryRepository
{
    private readonly JobEngineDbContext _context;

    public JobHistoryRepository(JobEngineDbContext context) => _context = context;

    public async Task<JobHistory?> GetByIdAsync(string id, CancellationToken ct = default)
        => await _context.JobHistories.FindAsync([id], ct);

    public async Task<IReadOnlyList<JobHistory>> GetAllAsync(CancellationToken ct = default)
        => await _context.JobHistories.ToListAsync(ct);

    public async Task<IReadOnlyList<JobHistory>> GetByJobIdAsync(string jobId, CancellationToken ct = default)
        => await _context.JobHistories.Where(h => h.JobId == jobId).OrderBy(h => h.CreatedAt).ToListAsync(ct);

    public async Task AddAsync(JobHistory entity, CancellationToken ct = default)
        => await _context.JobHistories.AddAsync(entity, ct);

    public Task UpdateAsync(JobHistory entity, CancellationToken ct = default)
    {
        _context.JobHistories.Update(entity);
        return Task.CompletedTask;
    }

    public async Task DeleteAsync(string id, CancellationToken ct = default)
    {
        var entity = await GetByIdAsync(id, ct);
        if (entity is not null) _context.JobHistories.Remove(entity);
    }
}

public sealed class OverwriteRequestRepository : IOverwriteRequestRepository
{
    private readonly JobEngineDbContext _context;

    public OverwriteRequestRepository(JobEngineDbContext context) => _context = context;

    public async Task<OverwriteRequest?> GetByIdAsync(string id, CancellationToken ct = default)
        => await _context.OverwriteRequests.FindAsync([id], ct);

    public async Task<IReadOnlyList<OverwriteRequest>> GetAllAsync(CancellationToken ct = default)
        => await _context.OverwriteRequests.ToListAsync(ct);

    public async Task<IReadOnlyList<OverwriteRequest>> GetByJobIdAsync(string jobId, CancellationToken ct = default)
        => await _context.OverwriteRequests.Where(r => r.JobId == jobId).ToListAsync(ct);

    public async Task<IReadOnlyList<OverwriteRequest>> GetPendingAsync(CancellationToken ct = default)
        => await _context.OverwriteRequests.Where(r => r.Status == "PENDING").ToListAsync(ct);

    public async Task AddAsync(OverwriteRequest entity, CancellationToken ct = default)
        => await _context.OverwriteRequests.AddAsync(entity, ct);

    public Task UpdateAsync(OverwriteRequest entity, CancellationToken ct = default)
    {
        _context.OverwriteRequests.Update(entity);
        return Task.CompletedTask;
    }

    public async Task DeleteAsync(string id, CancellationToken ct = default)
    {
        var entity = await GetByIdAsync(id, ct);
        if (entity is not null) _context.OverwriteRequests.Remove(entity);
    }
}
