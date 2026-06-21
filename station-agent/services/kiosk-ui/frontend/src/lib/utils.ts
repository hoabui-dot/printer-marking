import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { ROLE_LABELS } from '@/constants/roles'
import { PERMISSION_LABELS } from '@/constants/permissions'
import { JOB_STATUS_LABELS, JOB_TYPE_LABELS, JOB_STATUS_COLORS } from '@/constants/jobs'

/** Merge Tailwind classes safely */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Translate role code to Vietnamese label */
export function translateRole(role: string): string {
  return ROLE_LABELS[role] ?? role
}

/** Translate permission code to Vietnamese label */
export function translatePermission(perm: string): string {
  return PERMISSION_LABELS[perm] ?? perm
}

/** Translate job status code to Vietnamese label */
export function translateJobStatus(status: string): string {
  return JOB_STATUS_LABELS[status] ?? status
}

/** Translate job type code to Vietnamese label */
export function translateJobType(type: string): string {
  return JOB_TYPE_LABELS[type] ?? type
}

/** Get Tailwind color class for job status */
export function getStatusColor(status: string): string {
  return JOB_STATUS_COLORS[status] ?? 'bg-slate-500'
}
