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
