using ND.ProjectionService.Domain.Entities;
using ND.SharedKernel.Abstractions;

namespace ND.ProjectionService.Application.Interfaces;

public interface IProductionViewRepository : IRepository<ProductionView>
{
    Task<ProductionView?> GetByStationIdAsync(string stationId, CancellationToken cancellationToken = default);
}

public interface IActivityLogRepository : IRepository<ActivityLog>
{
    Task<IReadOnlyList<ActivityLog>> GetLatestAsync(int limit, CancellationToken cancellationToken = default);
    Task TrimExcessAsync(int keepCount, CancellationToken cancellationToken = default);
}

public interface IDeviceStatusRepository : IRepository<DeviceStatus>
{
    Task<DeviceStatus?> GetByDeviceIdAsync(string deviceId, CancellationToken cancellationToken = default);
}

public interface IProductionRecordRepository : IRepository<ProductionRecord>
{
    Task<ProductionRecord?> GetByJobIdAsync(string jobId, CancellationToken cancellationToken = default);

    /// <summary>Returns records created today (UTC), newest first, paginated.</summary>
    Task<(IReadOnlyList<ProductionRecord> Items, int TotalCount)> GetTodayAsync(
        int page, int pageSize, CancellationToken cancellationToken = default);

    /// <summary>Returns historical records (all time) with optional filters, newest first, paginated.</summary>
    Task<(IReadOnlyList<ProductionRecord> Items, int TotalCount)> GetHistoryAsync(
        int page,
        int pageSize,
        string? status = null,
        string? productCode = null,
        string? workOrder = null,
        string? dateFrom = null,
        string? dateTo = null,
        CancellationToken cancellationToken = default);
}

