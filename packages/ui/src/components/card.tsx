import * as React from 'react'
import { cn } from '../lib/cn'

/** Card — the Level 1 surface everything else sits on (docs/04-design-system.md §4.7/§4.11). */
export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('rounded-card border-outline-cell shadow-level-1 border bg-white', className)}
      {...props}
    />
  ),
)
Card.displayName = 'Card'

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('border-outline-cell border-b p-4', className)} {...props} />
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4', className)} {...props} />
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('border-outline-cell text-muted border-t p-4 text-xs', className)}
      {...props}
    />
  )
}

export interface MetricCardProps {
  label: string
  value: string
  trend?: { direction: 'up' | 'down' | 'flat'; label: string }
  tone?: 'default' | 'primary' | 'warning' | 'danger'
}

/**
 * MetricCard — the Space Grotesk `metric-display` treatment for a single KPI
 * (dashboard "Active POC roles / Candidates discovered / ..." tiles).
 */
export function MetricCard({ label, value, trend, tone = 'default' }: MetricCardProps) {
  const toneClass =
    tone === 'primary'
      ? 'text-primary'
      : tone === 'warning'
        ? 'text-warning'
        : tone === 'danger'
          ? 'text-danger'
          : 'text-tertiary'

  return (
    <Card className="p-4">
      <p className="text-muted text-xs font-semibold uppercase tracking-wide">{label}</p>
      <p
        className={cn(
          'font-display mt-1 text-[28px] font-bold leading-8 tracking-tight',
          toneClass,
        )}
      >
        {value}
      </p>
      {trend && (
        <p
          className={cn(
            'mt-1 text-xs font-medium',
            trend.direction === 'up' && 'text-primary',
            trend.direction === 'down' && 'text-danger',
            trend.direction === 'flat' && 'text-muted',
          )}
        >
          {trend.label}
        </p>
      )}
    </Card>
  )
}
