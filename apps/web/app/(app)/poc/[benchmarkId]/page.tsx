import { notFound } from 'next/navigation'
import { supabaseConfigured } from '@/lib/env'
import { requireAuth, resolveActiveOrg } from '@/lib/auth/session'
import { loadPocBenchmarkDetail } from '@/lib/poc/load-detail'
import { loadMetricDefinitions, loadPocJobOptions, loadShortlistsForJob } from '@/lib/poc/load'
import { PocDetailWorkspace } from '@/components/domain/poc/poc-detail-workspace'

export const metadata = { title: 'POC Benchmark' }

/** One POC benchmark's detail workspace (Build Phase 10 Wave 3). */
export default async function PocBenchmarkDetailPage({
  params,
}: {
  params: Promise<{ benchmarkId: string }>
}) {
  if (!supabaseConfigured) notFound()

  const { benchmarkId } = await params
  const user = await requireAuth(`/poc/${benchmarkId}`)
  const membership = await resolveActiveOrg(user.id)

  const detail = await loadPocBenchmarkDetail(membership.organizationId, benchmarkId)
  if (!detail) notFound()

  const [jobOptions, metricDefinitions] = await Promise.all([
    loadPocJobOptions(membership.organizationId),
    loadMetricDefinitions(),
  ])

  const shortlistsByJob: Record<string, Awaited<ReturnType<typeof loadShortlistsForJob>>> = {}
  await Promise.all(
    detail.roles.map(async (r) => {
      shortlistsByJob[r.role.jobId] = await loadShortlistsForJob(
        membership.organizationId,
        r.role.jobId,
      )
    }),
  )

  return (
    <PocDetailWorkspace
      organizationId={membership.organizationId}
      role={membership.role}
      detail={detail}
      jobOptions={jobOptions}
      shortlistsByJob={shortlistsByJob}
      metricDefinitions={metricDefinitions}
    />
  )
}
