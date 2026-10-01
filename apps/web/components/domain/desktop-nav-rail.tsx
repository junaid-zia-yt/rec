'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@rqi/ui'
import { desktopNav } from '@/lib/nav'

/**
 * DesktopNavRail — persistent 240px left navigation
 * (docs/22-build-phase-1-plan.md BP1-09, docs/04-design-system.md §4.15,
 * Doc A's desktop grid). Hidden below the `lg` (1280px+... here `lg`=1280px
 * per tailwind preset) breakpoint in favor of MobileBottomNav.
 */
export function DesktopNavRail() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Primary"
      className="border-outline-cell bg-tertiary hidden w-[240px] shrink-0 flex-col gap-1 border-r p-3 lg:flex"
    >
      {desktopNav.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
        const Icon = item.icon
        return (
          <Link
            key={item.label}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'rounded-control flex items-center gap-3 px-3 py-2.5 text-sm font-medium transition-colors',
              'focus-visible:ring-secondary focus-visible:outline-none focus-visible:ring-2',
              isActive
                ? 'bg-navSurface text-white'
                : 'hover:bg-navSurface text-white/70 hover:text-white',
            )}
          >
            <Icon className="h-4.5 w-4.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
