using ND.MqttAdapter.Domain.Entities;
using ND.SharedKernel.Abstractions;

namespace ND.MqttAdapter.Application.Interfaces;

public interface IMqttMessageRepository : IRepository<MqttMessage>
{
    Task<MqttMessage?> GetByMessageIdAsync(string messageId, CancellationToken cancellationToken = default);
}
