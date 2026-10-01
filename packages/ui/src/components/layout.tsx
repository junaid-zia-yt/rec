import * as React from 'react'
import { cn } from '../lib/cn'

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="font-display text-tertiary text-[22px] font-bold leading-7 tracking-tight lg:text-[26px] lg:leading-[34px]">
          {title}
        </h1>
        {description && <p className="text-muted mt-1 max-w-2xl text-sm">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}

export function SectionHeader({
  title,
  badge,
  className,
}: {
  title: string
  badge?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-center justify-between', className)}>
      <h2 className="font-display text-tertiary text-[15px] font-semibold leading-5">{title}</h2>
      {badge}
    </div>
  )
}

/** DataTableShell — accessible table scaffold; screens supply columns/rows. */
export function DataTableShell({
  headers,
  children,
  caption,
}: {
  headers: string[]
  children: React.ReactNode
  caption: string
}) {
  return (
    <div className="rounded-card border-outline-cell overflow-x-auto border">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-cardNested">
          <tr>
            {headers.map((h) => (
              <th
                key={h}
                scope="col"
                className="border-outline-cell text-muted border-b px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-outline-cell divide-y">{children}</tbody>
      </table>
    </div>
  )
}
