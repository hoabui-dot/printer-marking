using ND.MqttAdapter.Domain.Entities;
using ND.SharedKernel.Abstractions;

namespace ND.MqttAdapter.Application.Interfaces;

public interface IMqttOutboxRepository : IRepository<MqttOutboxEvent>
{
    Task<IReadOnlyList<MqttOutboxEvent>> GetPendingAsync(int batchSize, CancellationToken cancellationToken = default);
}
