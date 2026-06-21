using ND.KioskUi.Domain.Entities;
using Microsoft.EntityFrameworkCore;

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
        var adminRole = KioskRole.Create("SUPER_ADMIN", "Quản trị hệ thống");
        var memberRole = KioskRole.Create("MEMBER", "Nhân viên vận hành");

        await context.Roles.AddRangeAsync(adminRole, memberRole);

        // Permissions
        var permissions = new Dictionary<string, string>
        {
            { PermissionCodes.JobView, "Xem danh sách công việc" },
            { PermissionCodes.JobRetry, "Thử lại công việc lỗi" },
            { PermissionCodes.JobForcePass, "Bỏ qua lỗi kiểm tra camera" },
            { PermissionCodes.JobForceComplete, "Bắt buộc hoàn thành công việc" },
            { PermissionCodes.JobReprint, "In lại nhãn" },
            { PermissionCodes.JobRelaser, "Khắc lại Laser" },
            { PermissionCodes.UserManage, "Quản lý người dùng" },
            { PermissionCodes.SystemAdmin, "Toàn quyền hệ thống" }
        };

        var permissionEntities = permissions.Select(p => KioskPermission.Create(p.Key, p.Value)).ToList();
        await context.Permissions.AddRangeAsync(permissionEntities);

        await context.SaveChangesAsync();

        // Role-Permission mappings
        var permMap = permissionEntities.ToDictionary(p => p.PermissionCode, p => p.Id);

        // SUPER_ADMIN gets all permissions
        foreach (var perm in permissionEntities)
            await context.RolePermissions.AddAsync(KioskRolePermission.Create(adminRole.Id, perm.Id));

        // MEMBER gets JOB_VIEW by default
        if (permMap.TryGetValue(PermissionCodes.JobView, out var pidJobView))
            await context.RolePermissions.AddAsync(KioskRolePermission.Create(memberRole.Id, pidJobView));

        await context.SaveChangesAsync();

        // Default admin123 user
        var adminUser = KioskUser.Create("admin123", "Quản trị hệ thống", BCrypt.Net.BCrypt.HashPassword("admin123"));
        await context.Users.AddAsync(adminUser);
        await context.SaveChangesAsync();

        // Assign SUPER_ADMIN role to admin123
        await context.UserRoles.AddAsync(KioskUserRole.Create(adminUser.Id, adminRole.Id, "system"));
        await context.SaveChangesAsync();
    }
}
