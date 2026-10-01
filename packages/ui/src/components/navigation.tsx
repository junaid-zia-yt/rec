import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { ChevronRight, ChevronLeft } from 'lucide-react'
import { cn } from '../lib/cn'

export const Tabs = TabsPrimitive.Root

export function TabsList({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn('border-outline-cell flex gap-1 border-b', className)}
      {...props}
    />
  )
}

export function TabsTrigger({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'text-muted border-b-2 border-transparent px-3 py-2.5 text-sm font-medium',
        'hover:text-tertiary focus-visible:ring-secondary focus-visible:outline-none focus-visible:ring-2',
        'data-[state=active]:border-secondary data-[state=active]:text-secondary',
        className,
      )}
      {...props}
    />
  )
}

export const TabsContent = TabsPrimitive.Content

export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="text-muted flex items-center gap-1 text-sm">
        {items.map((item, i) => (
          <li key={item.label} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
            {item.href ? (
              <a href={item.href} className="hover:text-tertiary hover:underline">
                {item.label}
              </a>
            ) : (
              <span aria-current="page" className="text-tertiary font-medium">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}

export function Pagination({
  page,
  pageCount,
  onPageChange,
}: {
  page: number
  pageCount: number
  onPageChange: (page: number) => void
}) {
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-4">
      <button
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        className="rounded-control border-outline-perimeter inline-flex h-9 items-center gap-1 border px-3 text-sm disabled:opacity-40"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        Previous
      </button>
      <span className="text-muted text-sm" aria-live="polite">
        Page {page} of {pageCount}
      </span>
      <button
        onClick={() => onPageChange(page + 1)}
        disabled={page >= pageCount}
        className="rounded-control border-outline-perimeter inline-flex h-9 items-center gap-1 border px-3 text-sm disabled:opacity-40"
      >
        Next
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </nav>
  )
}

export interface StepperStep {
  label: string
  status: 'complete' | 'current' | 'upcoming'
}

/** WorkflowStepper — generic horizontal step indicator for any multi-stage flow. */
export function WorkflowStepper({ steps }: { steps: StepperStep[] }) {
  return (
    <ol className="flex items-center gap-2" aria-label="Progress">
      {steps.map((step, i) => (
        <li key={step.label} className="flex flex-1 items-center gap-2">
          <div className="flex flex-col items-center gap-1">
            <span
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold',
                step.status === 'complete' && 'bg-primary text-white',
                step.status === 'current' && 'bg-secondary text-white',
                step.status === 'upcoming' && 'bg-outline-cell text-muted',
              )}
              aria-current={step.status === 'current' ? 'step' : undefined}
            >
              {i + 1}
            </span>
            <span className="text-muted whitespace-nowrap text-[11px] font-medium">
              {step.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div
              className={cn(
                'h-0.5 flex-1',
                step.status === 'complete' ? 'bg-primary' : 'bg-outline-cell',
              )}
              aria-hidden="true"
            />
          )}
        </li>
      ))}
    </ol>
  )
}
