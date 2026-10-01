import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@rqi/testing'
import DashboardPage from './page'
import { DEMO_DASHBOARD_SUMMARY } from '@/lib/mock-data'

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
}))

/** Finds the MetricCard's rendered value by scoping to its label, since the
 * same numeric value (and the WorkflowStepper's numbered steps) can appear
 * more than once on the page. */
function metricValue(label: string) {
  const card = screen.getByText(label).closest('.rounded-card')
  if (!card) throw new Error(`Could not find MetricCard for "${label}"`)
  return within(card as HTMLElement)
}

describe('DashboardPage', () => {
  it('renders the required summary metrics with their mock values', () => {
    render(<DashboardPage />)

    expect(
      metricValue('Active POC roles').getByText(String(DEMO_DASHBOARD_SUMMARY.activePocRoles)),
    ).toBeInTheDocument()
    expect(
      metricValue('Candidates discovered').getByText(
        String(DEMO_DASHBOARD_SUMMARY.candidatesDiscovered),
      ),
    ).toBeInTheDocument()
    expect(
      metricValue('In quality review').getByText(
        String(DEMO_DASHBOARD_SUMMARY.candidatesInQualityReview),
      ),
    ).toBeInTheDocument()
    expect(
      metricValue('Shortlisted').getByText(String(DEMO_DASHBOARD_SUMMARY.shortlistedCandidates)),
    ).toBeInTheDocument()
  })

  it('renders a card for every active recruitment project', () => {
    // Build Phase 18: "View project details" now links to the demo
    // engine's real project ids (lib/demo/engine.ts's listDemoProjects),
    // so the role titles below match lib/demo/scenarios.ts's two seeded
    // roles, not the old static mock-data fixture's names.
    render(<DashboardPage />)
    expect(screen.getByText('Regional Store Leader')).toBeInTheDocument()
    expect(
      screen.getByText('Convenience & Food Service Shift Leader'),
    ).toBeInTheDocument()
  })
})
