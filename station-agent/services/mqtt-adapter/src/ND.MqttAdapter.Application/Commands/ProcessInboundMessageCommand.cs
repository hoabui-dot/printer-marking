using Microsoft.Extensions.Logging;
using ND.MqttAdapter.Application.Interfaces;
using ND.MqttAdapter.Domain.Entities;
using ND.SharedKernel.Abstractions;

namespace ND.MqttAdapter.Application.Commands;

public record ProcessInboundMessageCommand(
    string MessageId,
    string Topic,
    string PayloadJson);

/// <summary>
/// Handles an inbound MQTT message by atomically persisting:
///   1. MqttMessage       — the raw received message
///   2. MqttOutboxEvent   — the event queued for downstream publishing via RabbitMQ
///
/// Both writes are wrapped in a single database transaction.
/// If either insert fails, both are rolled back — no partial state is committed.
///
/// The outbox poller (OutboxProcessorWorker) is responsible for picking up
/// PENDING events and publishing them to RabbitMQ.
/// </summary>
public sealed class ProcessInboundMessageHandler
{
    private readonly IMqttMessageRepository _messageRepository;
    private readonly IMqttOutboxRepository _outboxRepository;
    private readonly IIdempotencyService _idempotency;
    private readonly ITransactionalUnitOfWork _unitOfWork;
    private readonly ILogger<ProcessInboundMessageHandler> _logger;

    public ProcessInboundMessageHandler(
        IMqttMessageRepository messageRepository,
        IMqttOutboxRepository outboxRepository,
        IIdempotencyService idempotency,
        ITransactionalUnitOfWork unitOfWork,
        ILogger<ProcessInboundMessageHandler> logger)
    {
        _messageRepository = messageRepository;
        _outboxRepository = outboxRepository;
        _idempotency = idempotency;
        _unitOfWork = unitOfWork;
        _logger = logger;
    }

    public async Task HandleAsync(
        ProcessInboundMessageCommand command,
        CancellationToken cancellationToken = default)
    {
        // ── Idempotency guard ────────────────────────────────────────────────
        var idempotencyKey = $"idempotency:msg:{command.MessageId}";
        var isNew = await _idempotency.TryRegisterAsync(
            idempotencyKey, TimeSpan.FromHours(24), cancellationToken);

        if (!isNew)
        {
            _logger.LogInformation(
                "Duplicate MQTT message {MessageId} skipped", command.MessageId);
            return;
        }

        // ── Build domain objects ─────────────────────────────────────────────
        var message = MqttMessage.CreateInbound(
            command.MessageId, command.Topic, command.PayloadJson);

        var outboxEvent = MqttOutboxEvent.Create(
            aggregateType: "MqttMessage",
            aggregateId: command.MessageId,
            eventType: "MqttMessageReceived",
            payloadJson: command.PayloadJson,
            topic: command.Topic);

        // ── Atomic dual-write ────────────────────────────────────────────────
        // Both rows are inserted inside a single DB transaction.
        // If either insert or the commit fails, the transaction is rolled back
        // so no partial state is persisted.
        await using var tx = await _unitOfWork.BeginTransactionAsync(cancellationToken);
        try
        {
            await _messageRepository.AddAsync(message, cancellationToken);
            await _outboxRepository.AddAsync(outboxEvent, cancellationToken);
            await _unitOfWork.SaveChangesAsync(cancellationToken);
            await tx.CommitAsync(cancellationToken);

            _logger.LogInformation(
                "MQTT message {MessageId} on {Topic} persisted — outbox event queued for RabbitMQ",
                command.MessageId, command.Topic);
        }
        catch (Exception ex)
        {
            await tx.RollbackAsync(cancellationToken);

            _logger.LogError(ex,
                "Failed to persist MQTT message {MessageId} on {Topic} — transaction rolled back",
                command.MessageId, command.Topic);

            throw;
        }
    }
}
