import * as React from 'react'
import { AlertCircle, Inbox, TriangleAlert, Info, CheckCircle2 } from 'lucide-react'
import { cn } from '../lib/cn'

export function Alert({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'success' | 'warning' | 'danger'
  title: string
  children?: React.ReactNode
}) {
  const config = {
    info: { icon: Info, cls: 'border-outline-perimeter bg-canvas text-tertiary' },
    success: { icon: CheckCircle2, cls: 'border-primary/30 bg-primary-container text-primary' },
    warning: { icon: TriangleAlert, cls: 'border-warning-border bg-warning-bg text-warning' },
    danger: { icon: AlertCircle, cls: 'border-danger-border bg-danger-bg text-danger' },
  }[tone]
  const Icon = config.icon
  return (
    <div role="alert" className={cn('rounded-card flex gap-3 border p-4', config.cls)}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <div>
        <p className="text-sm font-semibold">{title}</p>
        {children && <div className="mt-1 text-sm opacity-90">{children}</div>}
      </div>
    </div>
  )
}

/** EmptyState — required on every list/collection screen per the Build Phase 1 brief. */
export function EmptyState({
  title,
  description,
  action,
  icon: Icon = Inbox,
}: {
  title: string
  description?: string
  action?: React.ReactNode
  icon?: React.ComponentType<{ className?: string }>
}) {
  return (
    <div className="rounded-card border-outline-perimeter flex flex-col items-center justify-center gap-2 border border-dashed bg-white px-6 py-12 text-center">
      <Icon className="text-muted h-8 w-8" aria-hidden="true" />
      <p className="text-tertiary text-sm font-semibold">{title}</p>
      {description && <p className="text-muted max-w-sm text-sm">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

/** ErrorState — required on every data-fetching screen per the Build Phase 1 brief. */
export function ErrorState({
  title = 'Something went wrong',
  description,
  onRetry,
}: {
  title?: string
  description?: string
  onRetry?: () => void
}) {
  return (
    <div
      role="alert"
      className="rounded-card border-danger-border bg-danger-bg flex flex-col items-center justify-center gap-2 border px-6 py-12 text-center"
    >
      <AlertCircle className="text-danger h-8 w-8" aria-hidden="true" />
      <p className="text-danger text-sm font-semibold">{title}</p>
      {description && <p className="text-danger/80 max-w-sm text-sm">{description}</p>}
      {onRetry && (
        <button
          onClick={onRetry}
          className="rounded-control border-danger text-danger mt-2 border px-3 py-1.5 text-xs font-medium hover:bg-white"
        >
          Try again
        </button>
      )}
    </div>
  )
}

/** LoadingSkeleton — generic shimmering block; compose for card/row/text shapes. */
export function LoadingSkeleton({ className }: { className?: string }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn('rounded-badge bg-outline-cell animate-pulse', className)}
    />
  )
}

export function ProgressIndicator({ value, label }: { value: number; label: string }) {
  const clamped = Math.min(100, Math.max(0, value))
  return (
    <div>
      <div className="text-muted mb-1 flex items-center justify-between text-xs font-medium">
        <span>{label}</span>
        <span>{clamped}%</span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className="bg-outline-cell h-2 w-full overflow-hidden rounded-full"
      >
        <div
          className="bg-secondary h-full rounded-full transition-all"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  )
}
