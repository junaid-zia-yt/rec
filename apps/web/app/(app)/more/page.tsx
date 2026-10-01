import Link from 'next/link'
import { HelpCircle, ChevronRight } from 'lucide-react'
import { Card, PageHeader } from '@rqi/ui'
import { moreNav } from '@/lib/nav'

export const metadata = { title: 'More' }

/**
 * Mobile "More" hub — not one of the 9 desktop nav destinations, but
 * required by the Build Phase 1 brief §6: "The More screen should provide
 * access to: Outreach, POC Comparison, Integrations, Notifications,
 * Settings, Help." Desktop renders the same 9 items directly in the nav
 * rail, so this screen is reachable primarily via the mobile bottom nav.
 */
export default function MorePage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="More" description="Additional workspace sections." />

      <Card>
        <ul className="divide-outline-cell divide-y">
          {moreNav.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="hover:bg-canvas flex items-center gap-3 px-4 py-3.5"
              >
                <item.icon className="text-secondary h-4 w-4" aria-hidden="true" />
                <span className="text-tertiary flex-1 text-sm font-medium">{item.label}</span>
                <ChevronRight className="text-muted h-4 w-4" aria-hidden="true" />
              </Link>
            </li>
          ))}
          <li>
            <a
              href="mailto:support@example-agency.com"
              className="hover:bg-canvas flex items-center gap-3 px-4 py-3.5"
            >
              <HelpCircle className="text-secondary h-4 w-4" aria-hidden="true" />
              <span className="text-tertiary flex-1 text-sm font-medium">Help</span>
              <ChevronRight className="text-muted h-4 w-4" aria-hidden="true" />
            </a>
          </li>
        </ul>
      </Card>
    </div>
  )
}
