using ND.MqttAdapter.Application.Interfaces;
using ND.SharedKernel.Abstractions;
using Microsoft.Extensions.Logging;

namespace ND.MqttAdapter.Application.Commands;

public record ProcessInboundMessageCommand(
    string MessageId,
    string Topic,
    string PayloadJson);

public sealed class ProcessInboundMessageHandler
{
    private readonly IMqttMessageRepository _messageRepository;
    private readonly IInboundMessageDispatcher _dispatcher;
    private readonly IIdempotencyService _idempotency;
    private readonly IUnitOfWork _unitOfWork;
    private readonly ILogger<ProcessInboundMessageHandler> _logger;

    public ProcessInboundMessageHandler(
        IMqttMessageRepository messageRepository,
        IInboundMessageDispatcher dispatcher,
        IIdempotencyService idempotency,
        IUnitOfWork unitOfWork,
        ILogger<ProcessInboundMessageHandler> logger)
    {
        _messageRepository = messageRepository;
        _dispatcher = dispatcher;
        _idempotency = idempotency;
        _unitOfWork = unitOfWork;
        _logger = logger;
    }

    public async Task HandleAsync(ProcessInboundMessageCommand command, CancellationToken cancellationToken = default)
    {
        var idempotencyKey = $"idempotency:msg:{command.MessageId}";

        // Check idempotency — skip if already processed
        var isNew = await _idempotency.TryRegisterAsync(idempotencyKey, TimeSpan.FromHours(24), cancellationToken);
        if (!isNew)
        {
            _logger.LogInformation("Duplicate MQTT message {MessageId} skipped", command.MessageId);
            return;
        }

        var message = Domain.Entities.MqttMessage.CreateInbound(command.MessageId, command.Topic, command.PayloadJson);

        try
        {
            await _messageRepository.AddAsync(message, cancellationToken);

            await _dispatcher.DispatchAsync(command.Topic, command.PayloadJson, cancellationToken);

            message.MarkProcessed();
            await _messageRepository.UpdateAsync(message, cancellationToken);
            await _unitOfWork.SaveChangesAsync(cancellationToken);

            _logger.LogInformation(
                "MQTT message {MessageId} on {Topic} processed successfully",
                command.MessageId, command.Topic);
        }
        catch (Exception ex)
        {
            message.MarkFailed(ex.Message);
            await _messageRepository.UpdateAsync(message, cancellationToken);
            await _unitOfWork.SaveChangesAsync(cancellationToken);

            _logger.LogError(ex,
                "Failed to process MQTT message {MessageId} on {Topic}",
                command.MessageId, command.Topic);

            throw;
        }
    }
}
