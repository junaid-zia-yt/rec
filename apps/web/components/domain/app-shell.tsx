import { DEMO_USER, DEMO_NOTIFICATIONS } from '@/lib/mock-data'
import { TopNav } from './top-nav'
import { DesktopNavRail } from './desktop-nav-rail'
import { MobileBottomNav } from './mobile-bottom-nav'

/**
 * AppShell — the Stitch-matching application shell wrapping every
 * authenticated route (docs/22-build-phase-1-plan.md BP1-08). Composes the
 * top header, desktop nav rail, mobile bottom nav, and the main content
 * region. Bottom padding on <main> keeps content clear of the fixed mobile
 * nav (the 80px "ergonomic safe zone" from docs/04-design-system.md §4.7).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const unreadCount = DEMO_NOTIFICATIONS.filter((n) => !n.readAt).length

  return (
    <div className="flex min-h-dvh flex-col">
      {/*
       * [A11Y FIX — Build Phase 14 accessibility audit] Skip link (WCAG 2.4.1
       * Bypass Blocks): without this, a keyboard user must tab through the
       * header (search, help, notifications, account menu) and the full
       * desktop nav rail on every single route change before reaching page
       * content. Visually hidden until focused, per the standard pattern.
       */}
      <a
        href="#main-content"
        className="bg-secondary rounded-control sr-only px-4 py-2 text-sm font-medium text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2"
      >
        Skip to main content
      </a>
      <TopNav user={DEMO_USER} unreadCount={unreadCount} />
      <div className="flex flex-1">
        <DesktopNavRail />
        <main
          id="main-content"
          tabIndex={-1}
          className="min-w-0 flex-1 px-4 pb-24 pt-6 lg:px-8 lg:pb-8"
        >
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
      <MobileBottomNav />
    </div>
  )
}
