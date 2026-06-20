using ND.KioskUi.Domain.Entities;

namespace ND.KioskUi.Infrastructure.Persistence;

/// <summary>
/// Seeds default roles, permissions, and an admin user on first startup.
/// </summary>
public static class KioskDbSeeder
{
    public static async Task SeedAsync(KioskDbContext context)
    {
        if (context.Roles.Any()) return;  // Already seeded

        // Roles
        var adminRole = KioskRole.Create("ADMIN", "Administrator");
        var supervisorRole = KioskRole.Create("SUPERVISOR", "Supervisor");
        var operatorRole = KioskRole.Create("OPERATOR", "Operator");
        var qaRole = KioskRole.Create("QA", "Quality Assurance");

        await context.Roles.AddRangeAsync(adminRole, supervisorRole, operatorRole, qaRole);

        // Permissions
        var permissions = new Dictionary<string, string>
        {
            { PermissionCodes.JobView, "View jobs" },
            { PermissionCodes.JobRetry, "Retry failed jobs" },
            { PermissionCodes.JobForcePass, "Force pass vision check" },
            { PermissionCodes.JobForceComplete, "Force complete a job" },
            { PermissionCodes.JobReprint, "Reprint a label" },
            { PermissionCodes.JobRelaser, "Redo laser marking" },
            { PermissionCodes.UserManage, "Manage users" },
            { PermissionCodes.SystemAdmin, "Full system access" }
        };

        var permissionEntities = permissions.Select(p => KioskPermission.Create(p.Key, p.Value)).ToList();
        await context.Permissions.AddRangeAsync(permissionEntities);

        await context.SaveChangesAsync();

        // Role-Permission mappings
        var permMap = permissionEntities.ToDictionary(p => p.PermissionCode, p => p.Id);

        // ADMIN gets all permissions
        foreach (var perm in permissionEntities)
            await context.RolePermissions.AddAsync(KioskRolePermission.Create(adminRole.Id, perm.Id));

        // SUPERVISOR gets operational permissions
        foreach (var code in new[] { PermissionCodes.JobView, PermissionCodes.JobRetry, PermissionCodes.JobForcePass, PermissionCodes.JobForceComplete, PermissionCodes.JobReprint, PermissionCodes.JobRelaser })
            if (permMap.TryGetValue(code, out var pid))
                await context.RolePermissions.AddAsync(KioskRolePermission.Create(supervisorRole.Id, pid));

        // OPERATOR gets basic permissions
        foreach (var code in new[] { PermissionCodes.JobView, PermissionCodes.JobRetry })
            if (permMap.TryGetValue(code, out var pid))
                await context.RolePermissions.AddAsync(KioskRolePermission.Create(operatorRole.Id, pid));

        // QA gets view + force pass
        foreach (var code in new[] { PermissionCodes.JobView, PermissionCodes.JobForcePass })
            if (permMap.TryGetValue(code, out var pid))
                await context.RolePermissions.AddAsync(KioskRolePermission.Create(qaRole.Id, pid));

        // Default admin user
        var adminUser = KioskUser.Create("admin", "System Administrator", BCrypt.Net.BCrypt.HashPassword("Admin@123"));
        await context.Users.AddAsync(adminUser);
        await context.SaveChangesAsync();

        // Assign ADMIN role to admin user
        await context.UserRoles.AddAsync(KioskUserRole.Create(adminUser.Id, adminRole.Id, "system"));
        await context.SaveChangesAsync();
    }
}
