import { cn } from '@/lib/utils'
import { translateJobStatus, getStatusColor } from '@/lib/utils'

export interface StatusBadgeProps {
  status: string
  className?: string
}

/**
 * Renders a coloured pill badge for job statuses.
 * Colour classes come from JOB_STATUS_COLORS in constants/jobs.ts.
 */
export function StatusBadge({ status, className }: StatusBadgeProps) {
  const bgClass = getStatusColor(status)
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold text-white',
        bgClass,
        className
      )}
    >
      {translateJobStatus(status)}
    </span>
  )
}
