using System.Threading.Tasks;

namespace ND.PrinterAdapter.Application.Interfaces;

public record PrintJob(
    string PrinterCode,
    string IpAddress,
    int Port,
    string Content,
    string JobId,
    string AttemptId,
    string LabelTemplate,
    int Copies,
    string TraceId,
    string CorrelationId,
    TaskCompletionSource<bool> CompletionSource);

public interface IPrintQueue
{
    ValueTask<bool> QueuePrintJobAsync(PrintJob job);
}
