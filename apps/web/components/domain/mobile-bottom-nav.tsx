'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@rqi/ui'
import { mobileNav } from '@/lib/nav'

/**
 * MobileBottomNav — 56px + safe-area, 5 fixed destinations, matching the one
 * confirmed Stitch screenshot exactly (reference/stitch/screens/confirmed-01-...png):
 * Home / Projects / Candidates / Shortlists / More, active item in cobalt
 * with a 2px top indicator (docs/04-design-system.md §4.15).
 */
export function MobileBottomNav() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Primary"
      className="border-outline-cell fixed inset-x-0 bottom-0 z-30 flex h-14 border-t bg-white pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      {mobileNav.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
        const Icon = item.icon
        return (
          <Link
            key={item.label}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium uppercase tracking-wide',
              'focus-visible:ring-secondary min-h-12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset',
              isActive ? 'text-secondary' : 'text-muted',
            )}
          >
            {isActive && (
              <span
                className="bg-secondary absolute inset-x-4 top-0 h-0.5 rounded-full"
                aria-hidden="true"
              />
            )}
            <Icon className="h-5 w-5" aria-hidden="true" />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
