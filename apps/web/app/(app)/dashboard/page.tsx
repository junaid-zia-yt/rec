import Link from 'next/link'
import { Card, CardBody, MetricCard, PageHeader, StatusBadge, WorkflowStepper } from '@rqi/ui'
import { DEMO_DASHBOARD_SUMMARY, DEMO_AUDIT_EVENTS, DEMO_CANDIDATE_MATCHES } from '@/lib/mock-data'
import { listDemoProjects } from '@/lib/demo/engine'

export const metadata = { title: 'Dashboard' }
// Build Phase 18 repair: force dynamic rendering — reads the private
// demo's mutable in-memory engine. See docs/demo-limitations.md §8.
export const dynamic = 'force-dynamic'

/**
 * Dashboard — Build Phase 1 brief §8. Reproduces the approved Stitch
 * dashboard content set using typed mock data only: active POC roles,
 * candidates discovered, candidates in quality review, shortlisted
 * candidates, active role cards, workflow progress, quality alerts, recent
 * activity. The two sample roles are the approved POC roles from
 * docs/14-poc-specification.md.
 */
export default function DashboardPage() {
  const summary = DEMO_DASHBOARD_SUMMARY
  const allGatesPassing = DEMO_CANDIDATE_MATCHES.every((m) => m.gatesPassed === m.gatesTotal)
  // Build Phase 18: "View project details" now links to the demo engine's
  // real project ids, so it never 404s — this dashboard's summary numbers
  // above remain the Build Phase 1 static content set
  // (docs/demo-limitations.md documents this as a known, honest gap: the
  // dashboard's headline metrics are not yet wired to the engine, unlike
  // every other demo-mode screen this build phase touched).
  const activeRoles = listDemoProjects()

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dashboard"
        description="Active proof-of-concept roles, pipeline health, and recent activity across your organization."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard
          label="Active POC roles"
          value={String(summary.activePocRoles)}
          tone="primary"
        />
        <MetricCard label="Candidates discovered" value={String(summary.candidatesDiscovered)} />
        <MetricCard
          label="In quality review"
          value={String(summary.candidatesInQualityReview)}
          tone="warning"
        />
        <MetricCard
          label="Shortlisted"
          value={String(summary.shortlistedCandidates)}
          tone="primary"
        />
      </div>

      {allGatesPassing && (
        <Card className="border-warning-border bg-warning-bg">
          <CardBody className="flex items-center justify-between gap-4">
            <div>
              <p className="text-warning text-sm font-semibold">Quality alert</p>
              <p className="text-warning/90 text-sm">
                No mandatory-gate failures in the current pipeline — all active matches are
                evidence-complete.
              </p>
            </div>
          </CardBody>
        </Card>
      )}

      <section aria-labelledby="active-roles-heading" className="flex flex-col gap-3">
        <h2
          id="active-roles-heading"
          className="font-display text-tertiary text-[15px] font-semibold"
        >
          Active roles
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          {activeRoles.map((project) => (
            <Card key={project.id}>
              <CardBody className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-display text-tertiary text-base font-semibold">
                      {project.roleTitle}
                    </p>
                    <p className="text-muted text-sm">
                      {project.clientName} · {project.clientVertical}
                    </p>
                  </div>
                  <StatusBadge status="pending">POC</StatusBadge>
                </div>
                <WorkflowStepper
                  steps={[
                    { label: 'Intake', status: 'complete' },
                    {
                      label: 'Sourcing',
                      status: project.status === 'sourcing' ? 'current' : 'complete',
                    },
                    {
                      label: 'Shortlisting',
                      status:
                        project.status === 'shortlisting'
                          ? 'current'
                          : project.status === 'sourcing'
                            ? 'upcoming'
                            : 'complete',
                    },
                    { label: 'Client review', status: 'upcoming' },
                  ]}
                />
                <Link
                  href={`/projects/${project.id}`}
                  className="text-secondary text-sm font-medium hover:underline"
                >
                  View project details
                </Link>
              </CardBody>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="recent-activity-heading" className="flex flex-col gap-3">
        <h2
          id="recent-activity-heading"
          className="font-display text-tertiary text-[15px] font-semibold"
        >
          Recent activity
        </h2>
        <Card>
          <ul className="divide-outline-cell divide-y">
            {DEMO_AUDIT_EVENTS.map((event) => (
              <li
                key={event.id}
                className="flex items-center justify-between gap-4 px-4 py-3 text-sm"
              >
                <span className="text-tertiary">
                  <span className="font-medium">{event.actorName}</span> —{' '}
                  {event.action.replace('.', ' ')}
                </span>
                <span className="text-muted shrink-0 text-xs">
                  {new Date(event.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </section>
    </div>
  )
}
