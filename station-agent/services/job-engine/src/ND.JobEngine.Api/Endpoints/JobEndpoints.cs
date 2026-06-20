using ND.JobEngine.Application.Commands;
using ND.JobEngine.Application.Queries;

namespace ND.JobEngine.Api.Endpoints;

public static class JobEndpointExtensions
{
    public static IEndpointRouteBuilder MapJobEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/jobs").WithTags("Jobs");

        group.MapGet("/", async (
            int page,
            int pageSize,
            string? status,
            GetJobQueryHandler handler,
            CancellationToken ct) =>
        {
            var result = await handler.HandleGetPagedAsync(
                new GetJobsQuery(page, pageSize, status), ct);
            return Results.Ok(result);
        });

        group.MapGet("/{id}", async (string id, GetJobQueryHandler handler, CancellationToken ct) =>
        {
            var result = await handler.HandleGetByIdAsync(new GetJobByIdQuery(id), ct);
            return Results.Ok(result);
        });

        group.MapGet("/by-job-no/{jobNo}", async (string jobNo, GetJobQueryHandler handler, CancellationToken ct) =>
        {
            var result = await handler.HandleGetByJobNoAsync(new GetJobByJobNoQuery(jobNo), ct);
            return Results.Ok(result);
        });

        group.MapGet("/{id}/history", async (string id, GetJobQueryHandler handler, CancellationToken ct) =>
        {
            var result = await handler.HandleGetHistoryAsync(new GetJobHistoryQuery(id), ct);
            return Results.Ok(result);
        });

        group.MapGet("/{id}/attempts", async (string id, GetJobQueryHandler handler, CancellationToken ct) =>
        {
            var result = await handler.HandleGetAttemptsAsync(new GetJobAttemptsQuery(id), ct);
            return Results.Ok(result);
        });

        group.MapPost("/", async (CreateJobCommand command, CreateJobHandler handler, CancellationToken ct) =>
        {
            var result = await handler.HandleAsync(command, ct);
            return Results.Created($"/api/jobs/{result.Id}", result);
        });

        group.MapPost("/{id}/process", async (string id, ProcessJobHandler handler, CancellationToken ct) =>
        {
            await handler.HandleAsync(new ProcessJobCommand(id), ct);
            return Results.Accepted();
        });

        return app;
    }
}
