/** Permission codes used in RBAC */
export const PERMISSIONS = {
  JOB_VIEW: 'JOB_VIEW',
  JOB_RETRY: 'JOB_RETRY',
  JOB_FORCE_PASS: 'JOB_FORCE_PASS',
  JOB_FORCE_COMPLETE: 'JOB_FORCE_COMPLETE',
  JOB_REPRINT: 'JOB_REPRINT',
  JOB_RELASER: 'JOB_RELASER',
  USER_MANAGE: 'USER_MANAGE',
  SYSTEM_ADMIN: 'SYSTEM_ADMIN',
} as const

export type PermissionCode = typeof PERMISSIONS[keyof typeof PERMISSIONS]

/** Vietnamese labels for permission codes */
export const PERMISSION_LABELS: Record<string, string> = {
  [PERMISSIONS.JOB_VIEW]: 'Xem công việc',
  [PERMISSIONS.JOB_RETRY]: 'Thử lại công việc lỗi',
  [PERMISSIONS.JOB_FORCE_PASS]: 'Bỏ qua lỗi kiểm tra camera',
  [PERMISSIONS.JOB_FORCE_COMPLETE]: 'Bắt buộc hoàn thành',
  [PERMISSIONS.JOB_REPRINT]: 'In lại nhãn',
  [PERMISSIONS.JOB_RELASER]: 'Khắc lại laser',
  [PERMISSIONS.USER_MANAGE]: 'Quản lý người dùng',
  [PERMISSIONS.SYSTEM_ADMIN]: 'Toàn quyền hệ thống',
}
