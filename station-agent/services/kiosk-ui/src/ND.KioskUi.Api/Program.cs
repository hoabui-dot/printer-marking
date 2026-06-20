using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using ND.Infrastructure.Observability;
using ND.KioskUi.Api.Hubs;
using ND.KioskUi.Application.Commands;
using ND.KioskUi.Infrastructure.DependencyInjection;
using ND.KioskUi.Infrastructure.Options;
using ND.KioskUi.Infrastructure.Persistence;
using Serilog;

var builder = WebApplication.CreateBuilder(args);

Log.Logger = SerilogConfiguration.Configure(
    new LoggerConfiguration(), builder.Configuration, "kiosk-ui").CreateLogger();
builder.Host.UseSerilog();

// Infrastructure
builder.Services.AddKioskInfrastructure(builder.Configuration);

// JWT Auth
var jwtSection = builder.Configuration.GetSection(JwtOptions.SectionName);
var jwtSecret = jwtSection["Secret"] ?? "change_me_to_a_long_random_secret_at_least_32_chars";
var jwtIssuer = jwtSection["Issuer"] ?? "nd-station-agent";
var jwtAudience = jwtSection["Audience"] ?? "nd-kiosk";

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(opts =>
    {
        opts.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = jwtIssuer,
            ValidAudience = jwtAudience,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret))
        };
        // Allow JWT from query string for SignalR connections
        opts.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                var accessToken = context.Request.Query["access_token"];
                var path = context.HttpContext.Request.Path;
                if (!string.IsNullOrEmpty(accessToken) && path.StartsWithSegments("/hubs"))
                    context.Token = accessToken;
                return Task.CompletedTask;
            }
        };
    });

builder.Services.AddAuthorization();

// SignalR
builder.Services.AddSignalR();

// CORS for React frontend
builder.Services.AddCors(opts =>
    opts.AddDefaultPolicy(policy =>
        policy.WithOrigins("http://localhost:5173", "http://localhost:3000")
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials()));

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddOpenApi();

var app = builder.Build();

// Ensure DB on startup with seed data
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<KioskDbContext>();
    await db.Database.EnsureCreatedAsync();
    await KioskDbSeeder.SeedAsync(db);
}

if (app.Environment.IsDevelopment())
    app.MapOpenApi();

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

// Endpoints
app.MapPost("/api/auth/login", async (
    LoginCommand command,
    LoginHandler handler,
    HttpContext httpContext,
    CancellationToken ct) =>
{
    var ip = httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
    var ua = httpContext.Request.Headers.UserAgent.ToString();
    var result = await handler.HandleAsync(command with { IpAddress = ip, UserAgent = ua }, ct);
    return result is null
        ? Results.Unauthorized()
        : Results.Ok(result);
});

app.MapGet("/api/auth/me", (HttpContext ctx) =>
{
    var userId = ctx.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
    var username = ctx.User.FindFirst(System.Security.Claims.ClaimTypes.Name)?.Value;
    return userId is null ? Results.Unauthorized() : Results.Ok(new { userId, username });
}).RequireAuthorization();

app.MapGet("/api/access-logs", async (
    ND.KioskUi.Application.Interfaces.IKioskAccessLogRepository repo,
    CancellationToken ct) =>
{
    var logs = await repo.GetAllAsync(ct);
    return Results.Ok(logs);
}).RequireAuthorization();

app.MapGet("/health", () => Results.Ok(new { status = "healthy", service = "kiosk-ui" }));

// SignalR hub
app.MapHub<DashboardHub>("/hubs/dashboard");

// Serve React static files
app.UseStaticFiles();
app.MapFallbackToFile("index.html");

app.Run();
