using ND.Infrastructure.Observability;
using ND.JobEngine.Infrastructure.DependencyInjection;
using ND.JobEngine.Infrastructure.Persistence;
using Serilog;

var builder = WebApplication.CreateBuilder(args);

// Serilog
Log.Logger = SerilogConfiguration.Configure(
    new LoggerConfiguration(),
    builder.Configuration,
    "job-engine").CreateLogger();

builder.Host.UseSerilog();

// Infrastructure
builder.Services.AddJobEngineInfrastructure(builder.Configuration);

// API
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddOpenApi();

var app = builder.Build();

// Ensure DB on startup
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<JobEngineDbContext>();
    await db.Database.EnsureCreatedAsync();
}

if (app.Environment.IsDevelopment())
    app.MapOpenApi();

// Register endpoint groups
app.MapJobEndpoints();
app.MapOverwriteEndpoints();

app.Run();
