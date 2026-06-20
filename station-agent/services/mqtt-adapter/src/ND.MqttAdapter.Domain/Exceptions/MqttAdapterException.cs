using ND.SharedKernel.Exceptions;

namespace ND.MqttAdapter.Domain.Exceptions;

public sealed class DuplicateMessageException : DomainException
{
    public DuplicateMessageException(string messageId)
        : base("DUPLICATE_MESSAGE", $"Message '{messageId}' was already processed.")
    {
    }
}

public sealed class InvalidPayloadException : DomainException
{
    public InvalidPayloadException(string topic, string reason)
        : base("INVALID_PAYLOAD", $"Payload on topic '{topic}' is invalid: {reason}")
    {
    }
}
