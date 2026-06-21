import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors',
  {
    variants: {
      variant: {
        default:     'bg-primary text-primary-foreground',
        secondary:   'bg-surface-2 text-muted-fg',
        destructive: 'bg-destructive text-destructive-foreground',
        success:     'bg-emerald-600 text-white',
        warning:     'bg-amber-600 text-white',
        outline:     'border border-border-strong text-muted-fg',
        admin:       'bg-brand-dark text-white',
        member:      'bg-surface-3 text-brand-light border border-brand/40',
        connected:   'bg-emerald-950/60 text-emerald-400 border border-emerald-500/40',
        disconnected:'bg-red-950/60 text-red-400 border border-red-500/40',
      },
    },
    defaultVariants: { variant: 'default' },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
