using System.Text;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using ND.Infrastructure.Observability;
using ND.KioskUi.Api.Hubs;
using ND.KioskUi.Application.Commands;
using ND.KioskUi.Domain.Entities;
using ND.KioskUi.Infrastructure.DependencyInjection;
using ND.KioskUi.Application.Options;
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
        policy.WithOrigins("http://localhost:5222", "http://localhost:3000")
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials()));

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddOpenApi();

var app = builder.Build();

if (System.Linq.Enumerable.Contains(args, "--seed-only"))
{
    using (var scope = app.Services.CreateScope())
    {
        var db = scope.ServiceProvider.GetRequiredService<KioskDbContext>();
        var kioskDbPath = app.Configuration["SQLITE_KIOSK_PATH"] ?? "data/kiosk.db";
        var kioskDbDir = Path.GetDirectoryName(Path.GetFullPath(kioskDbPath));
        if (!string.IsNullOrEmpty(kioskDbDir)) Directory.CreateDirectory(kioskDbDir);
        await db.Database.EnsureCreatedAsync();
        await KioskDbSeeder.SeedAsync(db);
    }
    Console.WriteLine("Database initialized and seeded with admin123/admin123 successfully.");
    return;
}

// Ensure DB on startup with seed data
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<KioskDbContext>();
    var kioskDbPath = app.Configuration["SQLITE_KIOSK_PATH"] ?? "data/kiosk.db";
    var kioskDbDir = Path.GetDirectoryName(Path.GetFullPath(kioskDbPath));
    if (!string.IsNullOrEmpty(kioskDbDir)) Directory.CreateDirectory(kioskDbDir);
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

app.MapGet("/api/auth/me", async (
    HttpContext ctx,
    ND.KioskUi.Application.Interfaces.IKioskRbacRepository rbac,
    CancellationToken ct) =>
{
    var userId = ctx.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
    var username = ctx.User.FindFirst(System.Security.Claims.ClaimTypes.Name)?.Value;
    if (userId is null) return Results.Unauthorized();
    var permissions = await rbac.GetUserPermissionsAsync(userId, ct);
    var roles = await rbac.GetUserRolesAsync(userId, ct);
    return Results.Ok(new { userId, username, roles, permissions });
}).RequireAuthorization();

// ── RBAC Management Endpoints ──────────────────────────────────────────────
app.MapGet("/api/rbac/users", async (KioskDbContext db, HttpContext ctx, CancellationToken ct) =>
{
    var isSuper = ctx.User.HasClaim(c => c.Type == "permission" && c.Value == "SYSTEM_ADMIN");
    if (!isSuper) return Results.Forbid();

    var users = await db.Users.ToListAsync(ct);
    var result = new List<object>();
    foreach (var user in users)
    {
        var roleIds = await db.UserRoles.Where(ur => ur.UserId == user.Id).Select(ur => ur.RoleId).ToListAsync(ct);
        var roles = await db.Roles.Where(r => roleIds.Contains(r.Id)).Select(r => r.RoleCode).ToListAsync(ct);
        
        var directPermIds = await db.UserPermissions.Where(up => up.UserId == user.Id).Select(up => up.PermissionId).ToListAsync(ct);
        var directPermissions = await db.Permissions.Where(p => directPermIds.Contains(p.Id)).Select(p => p.PermissionCode).ToListAsync(ct);
        
        var rolePermIds = await db.RolePermissions.Where(rp => roleIds.Contains(rp.RoleId)).Select(rp => rp.PermissionId).ToListAsync(ct);
        var rolePermissions = await db.Permissions.Where(p => rolePermIds.Contains(p.Id)).Select(p => p.PermissionCode).ToListAsync(ct);
        
        var allPermissions = rolePermissions.Union(directPermissions).Distinct().ToList();

        result.Add(new
        {
            id = user.Id,
            username = user.Username,
            fullName = user.FullName,
            isActive = user.IsActive,
            roles,
            directPermissions,
            allPermissions
        });
    }
    return Results.Ok(result);
}).RequireAuthorization();

app.MapPost("/api/rbac/users", async (CreateUserRequest req, KioskDbContext db, HttpContext ctx, CancellationToken ct) =>
{
    var isSuper = ctx.User.HasClaim(c => c.Type == "permission" && c.Value == "SYSTEM_ADMIN");
    if (!isSuper) return Results.Forbid();

    if (string.IsNullOrWhiteSpace(req.Username) || string.IsNullOrWhiteSpace(req.Password) || string.IsNullOrWhiteSpace(req.RoleCode))
        return Results.BadRequest(new { error = "Username, password and role are required" });

    var existing = await db.Users.AnyAsync(u => u.Username == req.Username, ct);
    if (existing) return Results.BadRequest(new { error = "Username already exists" });

    var role = await db.Roles.FirstOrDefaultAsync(r => r.RoleCode == req.RoleCode, ct);
    if (role is null) return Results.BadRequest(new { error = $"Role {req.RoleCode} does not exist" });

    var user = KioskUser.Create(req.Username, req.FullName, BCrypt.Net.BCrypt.HashPassword(req.Password));
    await db.Users.AddAsync(user, ct);
    await db.SaveChangesAsync(ct);

    var userRole = KioskUserRole.Create(user.Id, role.Id, "admin");
    await db.UserRoles.AddAsync(userRole, ct);
    await db.SaveChangesAsync(ct);

    return Results.Ok(new { id = user.Id, username = user.Username, fullName = user.FullName });
}).RequireAuthorization();

app.MapDelete("/api/rbac/users/{id}", async (string id, KioskDbContext db, HttpContext ctx, CancellationToken ct) =>
{
    var isSuper = ctx.User.HasClaim(c => c.Type == "permission" && c.Value == "SYSTEM_ADMIN");
    if (!isSuper) return Results.Forbid();

    var user = await db.Users.FindAsync([id], ct);
    if (user is null) return Results.NotFound();

    if (user.Username == "admin123")
        return Results.BadRequest(new { error = "Cannot delete the default super admin user" });

    db.Users.Remove(user);
    var uroles = await db.UserRoles.Where(ur => ur.UserId == id).ToListAsync(ct);
    db.UserRoles.RemoveRange(uroles);
    var uperms = await db.UserPermissions.Where(up => up.UserId == id).ToListAsync(ct);
    db.UserPermissions.RemoveRange(uperms);

    await db.SaveChangesAsync(ct);
    return Results.Ok();
}).RequireAuthorization();

app.MapGet("/api/rbac/permissions", async (KioskDbContext db, HttpContext ctx, CancellationToken ct) =>
{
    var isSuper = ctx.User.HasClaim(c => c.Type == "permission" && c.Value == "SYSTEM_ADMIN");
    if (!isSuper) return Results.Forbid();

    var perms = await db.Permissions.OrderBy(p => p.PermissionCode).ToListAsync(ct);
    return Results.Ok(perms.Select(p => new { code = p.PermissionCode, description = p.Description }));
}).RequireAuthorization();

app.MapPost("/api/rbac/users/{userId}/permissions", async (string userId, UpdateUserPermissionsRequest req, KioskDbContext db, HttpContext ctx, CancellationToken ct) =>
{
    var isSuper = ctx.User.HasClaim(c => c.Type == "permission" && c.Value == "SYSTEM_ADMIN");
    if (!isSuper) return Results.Forbid();

    var user = await db.Users.FindAsync([userId], ct);
    if (user is null) return Results.NotFound();

    var existing = await db.UserPermissions.Where(up => up.UserId == userId).ToListAsync(ct);
    db.UserPermissions.RemoveRange(existing);
    await db.SaveChangesAsync(ct);

    if (req.PermissionCodes != null)
    {
        foreach (var code in req.PermissionCodes)
        {
            var perm = await db.Permissions.FirstOrDefaultAsync(p => p.PermissionCode == code, ct);
            if (perm != null)
            {
                var up = KioskUserPermission.Create(userId, perm.Id);
                await db.UserPermissions.AddAsync(up, ct);
            }
        }
        await db.SaveChangesAsync(ct);
    }

    return Results.Ok();
}).RequireAuthorization();

app.MapGet("/api/access-logs", async (
    ND.KioskUi.Application.Interfaces.IKioskAccessLogRepository repo,
    CancellationToken ct) =>
{
    var logs = await repo.GetAllAsync(ct);
    return Results.Ok(logs);
}).RequireAuthorization();

// ── Job Engine proxy endpoints ──────────────────────────────────────────────
async Task<IResult> ProxyGetAsync(string relativePath, HttpContext ctx, CancellationToken ct)
{
    var userId = ctx.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
    if (userId is null) return Results.Unauthorized();
    
    var hasView = ctx.User.HasClaim(c => c.Type == "permission" && (c.Value == "JOB_VIEW" || c.Value == "SYSTEM_ADMIN"));
    if (!hasView) return Results.Forbid();

    var queryString = ctx.Request.QueryString.Value;
    var targetUrl = $"http://localhost:5002/{relativePath}{queryString}";

    try
    {
        using var httpClient = new HttpClient();
        var request = new HttpRequestMessage(HttpMethod.Get, targetUrl);
        var response = await httpClient.SendAsync(request, ct);
        var content = await response.Content.ReadAsStringAsync(ct);
        return Results.Content(content, response.Content.Headers.ContentType?.ToString() ?? "application/json", statusCode: (int)response.StatusCode);
    }
    catch (Exception ex)
    {
        return Results.Problem(ex.Message, statusCode: 502);
    }
}

app.MapGet("/api/jobs", async (HttpContext ctx, CancellationToken ct) => 
    await ProxyGetAsync("api/jobs", ctx, ct)).RequireAuthorization();

app.MapGet("/api/jobs/{*path}", async (string path, HttpContext ctx, CancellationToken ct) => 
    await ProxyGetAsync($"api/jobs/{path}", ctx, ct)).RequireAuthorization();

app.MapGet("/api/overwrite-requests", async (HttpContext ctx, CancellationToken ct) => 
    await ProxyGetAsync("api/overwrite-requests", ctx, ct)).RequireAuthorization();

app.MapGet("/api/overwrite-requests/{*path}", async (string path, HttpContext ctx, CancellationToken ct) => 
    await ProxyGetAsync($"api/overwrite-requests/{path}", ctx, ct)).RequireAuthorization();

app.MapPost("/api/overwrite-requests", async (
    HttpContext ctx,
    KioskDbContext db,
    CancellationToken ct) =>
{
    var userId = ctx.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
    if (userId is null) return Results.Unauthorized();

    // Resolve sessionId from active session of current user
    var authHeader = ctx.Request.Headers.Authorization.ToString();
    var token = authHeader.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) 
        ? authHeader.Substring(7).Trim() 
        : "";
    var session = await db.Sessions.FirstOrDefaultAsync(s => s.Token == token && s.IsActive, ct);
    var sessionId = session?.Id ?? "none";

    // Read and parse JSON request body
    using var reader = new StreamReader(ctx.Request.Body);
    var body = await reader.ReadToEndAsync(ct);
    System.Text.Json.Nodes.JsonObject? reqData = null;
    try
    {
        reqData = System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.Nodes.JsonObject>(body);
    }
    catch { }
    
    if (reqData is null) 
    {
        return Results.BadRequest(new { error = "Yêu cầu không hợp lệ" });
    }

    var jobId = reqData["jobId"]?.ToString() ?? reqData["JobId"]?.ToString();
    var overwriteType = reqData["overwriteType"]?.ToString() ?? reqData["OverwriteType"]?.ToString();
    var reason = reqData["reason"]?.ToString() ?? reqData["Reason"]?.ToString() ?? "";

    if (string.IsNullOrEmpty(jobId) || string.IsNullOrEmpty(overwriteType))
    {
        return Results.BadRequest(new { error = "Mã công việc và loại ghi đè là bắt buộc" });
    }

    // Map overwriteType to the required permission code
    string requiredPerm = overwriteType.ToUpperInvariant() switch
    {
        "REPRINT" => "JOB_REPRINT",
        "RELASER" => "JOB_RELASER",
        "FORCE_PASS" => "JOB_FORCE_PASS",
        "FORCE_COMPLETE" => "JOB_FORCE_COMPLETE",
        _ => "JOB_RETRY"
    };

    var hasPermission = ctx.User.HasClaim(c => c.Type == "permission" && (c.Value == requiredPerm || c.Value == "SYSTEM_ADMIN"));
    if (!hasPermission)
    {
        // Audit denied request
        var accessLogDenied = KioskAccessLog.Create(
            userId, sessionId, $"OVERWRITE_{overwriteType}", "JOB", jobId, "DENIED", 
            detailJson: "Từ chối: Không đủ quyền hạn");
        await db.AccessLogs.AddAsync(accessLogDenied, ct);
        await db.SaveChangesAsync(ct);
        return Results.Forbid();
    }

    // Construct forward payload
    var commandPayload = new
    {
        jobId,
        overwriteType,
        reason,
        requestedBy = userId
    };

    var targetUrl = "http://localhost:5002/api/overwrite-requests";
    try
    {
        using var httpClient = new HttpClient();
        var response = await httpClient.PostAsJsonAsync(targetUrl, commandPayload, ct);
        var content = await response.Content.ReadAsStringAsync(ct);
        
        var isSuccess = response.IsSuccessStatusCode;
        var auditResult = isSuccess ? "SUCCESS" : "FAILED";
        
        // Audit forward result
        var accessLog = KioskAccessLog.Create(
            userId, sessionId, $"OVERWRITE_{overwriteType}", "JOB", jobId, auditResult, 
            detailJson: isSuccess ? $"Lý do: {reason}" : $"Lỗi từ Job Engine: HTTP {response.StatusCode} - {content}");
        await db.AccessLogs.AddAsync(accessLog, ct);
        await db.SaveChangesAsync(ct);

        return Results.Content(content, response.Content.Headers.ContentType?.ToString() ?? "application/json", statusCode: (int)response.StatusCode);
    }
    catch (Exception ex)
    {
        // Audit exception
        var accessLogEx = KioskAccessLog.Create(
            userId, sessionId, $"OVERWRITE_{overwriteType}", "JOB", jobId, "FAILED", 
            detailJson: $"Lỗi kết nối Job Engine: {ex.Message}");
        await db.AccessLogs.AddAsync(accessLogEx, ct);
        await db.SaveChangesAsync(ct);
        
        return Results.Problem(ex.Message, statusCode: 502);
    }
}).RequireAuthorization();

app.MapGet("/health", () => Results.Ok(new { status = "healthy", service = "kiosk-ui" }));

// SignalR hub
app.MapHub<DashboardHub>("/hubs/dashboard");

// Serve React static files
app.UseStaticFiles();
app.MapFallbackToFile("index.html");

app.Run();

// Request records for RBAC endpoints
public record CreateUserRequest(string Username, string Password, string FullName, string RoleCode);
public record UpdateUserPermissionsRequest(List<string> PermissionCodes);
