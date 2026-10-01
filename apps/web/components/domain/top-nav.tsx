'use client'

import { Bell, HelpCircle, Search } from 'lucide-react'
import { AvatarInitials, IconButton } from '@rqi/ui'
import type { User } from '@rqi/types'

/**
 * TopNav — desktop application header: product identity, global search
 * placeholder, notifications, help, user menu, org/project context
 * (Build Phase 1 brief §6). Sits above the content area at every route.
 */
export function TopNav({ user, unreadCount }: { user: User; unreadCount: number }) {
  return (
    <header className="border-outline-cell sticky top-0 z-30 flex h-16 shrink-0 items-center gap-4 border-b bg-white px-4 lg:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <span className="font-display text-tertiary text-base font-bold tracking-tight">
          Recruitment Quality Intelligence
        </span>
        <span className="rounded-badge border-outline-perimeter text-muted hidden border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide sm:inline-block">
          Demo workspace
        </span>
      </div>

      <div className="ml-4 hidden max-w-md flex-1 md:block">
        <label htmlFor="global-search" className="sr-only">
          Search projects and candidates
        </label>
        <div className="relative">
          <Search
            className="text-muted pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
            aria-hidden="true"
          />
          <input
            id="global-search"
            type="search"
            placeholder="Search projects, candidates…"
            disabled
            aria-describedby="global-search-hint"
            className="rounded-control border-outline-perimeter bg-canvas text-muted placeholder:text-placeholder h-10 w-full border pl-9 pr-3 text-sm disabled:cursor-not-allowed"
          />
          <span id="global-search-hint" className="sr-only">
            Global search is not yet implemented in this phase.
          </span>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <IconButton label="Help">
          <HelpCircle className="h-5 w-5" aria-hidden="true" />
        </IconButton>
        <div className="relative">
          <IconButton label={`Notifications, ${unreadCount} unread`}>
            <Bell className="h-5 w-5" aria-hidden="true" />
          </IconButton>
          {unreadCount > 0 && (
            <span
              className="bg-warning absolute right-1.5 top-1.5 h-2 w-2 rounded-full"
              aria-hidden="true"
            />
          )}
        </div>
        <button
          className="rounded-control hover:bg-canvas focus-visible:ring-secondary ml-1 flex items-center gap-2 p-1 focus-visible:outline-none focus-visible:ring-2"
          aria-label={`Account menu for ${user.fullName}`}
        >
          <AvatarInitials initials={user.avatarInitials} />
        </button>
      </div>
    </header>
  )
}
