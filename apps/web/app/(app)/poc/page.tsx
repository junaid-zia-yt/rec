import Link from 'next/link'
import { BarChart3 } from 'lucide-react'
import { Card, CardBody, EmptyState, PageHeader, SectionHeader, StatusBadge } from '@rqi/ui'
import { hasPermission } from '@rqi/types'
import { supabaseConfigured } from '@/lib/env'
import { requireAuth, resolveActiveOrg } from '@/lib/auth/session'
import { loadPocBenchmarks, loadPocClientOptions } from '@/lib/poc/load'
import { CreateBenchmarkForm } from '@/components/domain/poc/create-benchmark-form'

export const metadata = { title: 'POC Benchmarks' }

const STATUS_BADGE = {
  setup: 'neutral',
  in_progress: 'pending',
  completed: 'passed',
  decided: 'passed',
} as const

/**
 * POC workspace — Build Phase 10 Wave 3, Task C screen "POC setup". New
 * top-level route (apps/web/app/(app)/poc/) per the wave brief; the
 * existing "POC Comparison" nav entry (apps/web/lib/nav.ts) previously
 * pointed at /poc-comparison, a Build Phase 1 demo page backed by static
 * mock data (DEMO_POC_METRICS) — it now points here instead, since this is
 * the real, DB-backed feature the nav slot was always meant to reach. The
 * legacy /poc-comparison route is left in place, unlinked, rather than
 * deleted (no redesign of a screen without explaining why, and no data
 * loss for anyone with the old URL bookmarked).
 */
export default async function PocWorkspacePage() {
  if (!supabaseConfigured) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="POC Benchmarks"
          description="Compare your current recruitment process against this platform's, under agreed, shared conditions. Requires a live database connection — see docs/19-mvp-scope.md."
        />
        <EmptyState
          icon={BarChart3}
          title="No POC benchmarks yet"
          description="A proof-of-concept benchmark will appear here once your organization starts one against a live database."
        />
      </div>
    )
  }

  const user = await requireAuth('/poc')
  const membership = await resolveActiveOrg(user.id)
  const canCreate = hasPermission(membership.role, 'poc_reports', 'create')

  const [benchmarks, clients] = await Promise.all([
    loadPocBenchmarks(membership.organizationId),
    canCreate ? loadPocClientOptions(membership.organizationId) : Promise.resolve([]),
  ])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="POC Benchmarks"
        description="Compare your current recruitment process against this platform's, under agreed, shared conditions — then decide whether to proceed."
      />

      {canCreate && (
        <Card>
          <CardBody className="flex flex-col gap-4">
            <SectionHeader title="Start a new POC benchmark" />
            <CreateBenchmarkForm organizationId={membership.organizationId} clients={clients} />
          </CardBody>
        </Card>
      )}

      <section aria-labelledby="poc-list-heading" className="flex flex-col gap-3">
        <SectionHeader title="All benchmarks" />
        {benchmarks.length === 0 ? (
          <EmptyState
            icon={BarChart3}
            title="No POC benchmarks yet"
            description={
              canCreate ? 'Create one above to get started.' : 'Ask an agency admin to start one.'
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {benchmarks.map((b) => (
              <Link key={b.id} href={`/poc/${b.id}`} className="block">
                <Card className="hover:shadow-level-2 transition-shadow">
                  <CardBody className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-tertiary text-sm font-semibold">{b.name}</p>
                      <StatusBadge status={STATUS_BADGE[b.status]}>
                        {b.status.replace(/_/g, ' ')}
                      </StatusBadge>
                    </div>
                    <p className="text-muted text-xs">{b.clientName}</p>
                    <p className="text-muted text-xs">
                      {b.roleCount}/2 roles configured
                      {b.standardRoleLabel ? ` · Standard: ${b.standardRoleLabel}` : ''}
                      {b.seniorRoleLabel ? ` · Senior/difficult: ${b.seniorRoleLabel}` : ''}
                    </p>
                    {b.hasCurrentDecision && (
                      <StatusBadge status="passed">Decision recorded</StatusBadge>
                    )}
                  </CardBody>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
