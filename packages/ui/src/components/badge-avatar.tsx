import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Check, AlertTriangle, X } from 'lucide-react'
import { cn } from '../lib/cn'

/**
 * StatusBadge — the passed/pending/failed verification chip
 * (docs/04-design-system.md §4.14). Never color-only: always paired with an
 * icon + text label (accessibility requirement carried from the Stitch design
 * itself, see docs/04-design-system.md §4.18).
 */
const statusBadgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
  {
    variants: {
      status: {
        passed: 'border-primary/30 bg-primary-container text-primary',
        pending: 'border-warning-border bg-warning-bg text-warning',
        failed: 'border-danger-border bg-danger-bg text-danger',
        neutral: 'border-outline-perimeter bg-white text-muted',
      },
    },
    defaultVariants: { status: 'neutral' },
  },
)

export interface StatusBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof statusBadgeVariants> {
  children: React.ReactNode
}

export function StatusBadge({ className, status, children, ...props }: StatusBadgeProps) {
  const Icon =
    status === 'passed'
      ? Check
      : status === 'failed'
        ? X
        : status === 'pending'
          ? AlertTriangle
          : null
  return (
    <span className={cn(statusBadgeVariants({ status }), className)} {...props}>
      {Icon && <Icon className="h-3 w-3" aria-hidden="true" />}
      {children}
    </span>
  )
}

/**
 * AvatarInitials — rounded-square (never circular) monogram tile
 * (docs/04-design-system.md §4.11). No candidate photographs, ever, per the
 * Build Phase 1 brief §5 and the "no invented candidate data" principle —
 * a name-derived monogram is the only representation of a person.
 */
export function AvatarInitials({
  initials,
  size = 'md',
  tone = 'navy',
  className,
}: {
  initials: string
  size?: 'sm' | 'md' | 'lg'
  tone?: 'navy' | 'secondary'
  className?: string
}) {
  const sizeClass =
    size === 'sm' ? 'h-8 w-8 text-xs' : size === 'lg' ? 'h-12 w-12 text-base' : 'h-9 w-9 text-sm'
  const toneClass = tone === 'secondary' ? 'bg-secondary' : 'bg-tertiary'
  return (
    <span
      className={cn(
        'rounded-avatar font-display inline-flex shrink-0 items-center justify-center font-semibold uppercase text-white',
        sizeClass,
        toneClass,
        className,
      )}
      aria-hidden="true"
    >
      {initials.slice(0, 2)}
    </span>
  )
}
