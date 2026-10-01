import type { LucideIcon } from 'lucide-react'
import {
  LayoutDashboard,
  Briefcase,
  ClipboardList,
  Users,
  ListChecks,
  Send,
  BarChart3,
  Plug,
  Settings,
  MoreHorizontal,
  Home,
  Bell,
  Building2,
  Sparkles,
} from 'lucide-react'

export interface NavItem {
  label: string
  href: string
  icon: LucideIcon
}

/**
 * Desktop primary navigation — Build Phase 1 brief §6, in the specified order.
 * "Job Scorecards" links into /projects (scorecards are a tab of a project,
 * per docs/03-screen-inventory.md's navigation map) until a dedicated
 * cross-project scorecard index is scoped.
 */
export const desktopNav: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Recruitment Projects', href: '/projects', icon: Briefcase },
  { label: 'Job Scorecards', href: '/projects', icon: ClipboardList },
  { label: 'Candidate Pipeline', href: '/candidates', icon: Users },
  { label: 'Shortlists', href: '/shortlists', icon: ListChecks },
  { label: 'Outreach', href: '/outreach', icon: Send },
  // Build Phase 10 Wave 3: this slot now points at the real, DB-backed POC
  // workspace (apps/web/app/(app)/poc/) instead of the Build Phase 1 demo
  // page at /poc-comparison (which is left in place, unlinked, rather than
  // deleted — see that route's own page.tsx comment).
  { label: 'POC Comparison', href: '/poc', icon: BarChart3 },
  // Build Phase 11 Wave 4: no "Copilot"/"AI Assistant" slot was reserved in
  // docs/03-screen-inventory.md or any supplied Stitch screenshot (checked
  // before adding this — see apps/web/app/(app)/copilot/page.tsx's own
  // comment). This is a genuinely new nav destination, not a redesign of an
  // existing one, so it is added here rather than overloading an unrelated
  // slot.
  { label: 'Copilot', href: '/copilot', icon: Sparkles },
  { label: 'Integrations', href: '/integrations', icon: Plug },
  { label: 'Settings', href: '/settings', icon: Settings },
]

/** Mobile bottom nav — exactly the 5 destinations in the Build Phase 1 brief §6. */
export const mobileNav: NavItem[] = [
  { label: 'Home', href: '/dashboard', icon: Home },
  { label: 'Projects', href: '/projects', icon: Briefcase },
  { label: 'Candidates', href: '/candidates', icon: Users },
  { label: 'Shortlists', href: '/shortlists', icon: ListChecks },
  { label: 'More', href: '/more', icon: MoreHorizontal },
]

/**
 * Items surfaced on the mobile "More" screen per Build Phase 1 brief §6,
 * plus "Clients" (Build Phase 3). Clients isn't in the original Stitch
 * primary-nav set, so rather than redesigning that row, it's added here and
 * as a secondary link on the desktop Projects screen — the same "no
 * redesign without explaining why" approach the brief asks for.
 */
export const moreNav: NavItem[] = [
  { label: 'Clients', href: '/clients', icon: Building2 },
  { label: 'Outreach', href: '/outreach', icon: Send },
  { label: 'Copilot', href: '/copilot', icon: Sparkles },
  { label: 'POC Comparison', href: '/poc', icon: BarChart3 },
  { label: 'Integrations', href: '/integrations', icon: Plug },
  { label: 'Notifications', href: '/notifications', icon: Bell },
  { label: 'Settings', href: '/settings', icon: Settings },
]
