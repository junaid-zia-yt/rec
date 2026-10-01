import { EmptyState, PageHeader } from '@rqi/ui'
import { ListChecks } from 'lucide-react'
import { supabaseConfigured } from '@/lib/env'
import { requireAuth, resolveActiveOrg } from '@/lib/auth/session'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { loadJobs, loadJobStatusCounts } from '@/lib/jobs/load'
import { JobStatusPanel } from '@/components/domain/jobs/job-status-panel'

export const metadata = { title: 'Job status' }

/**
 * Build Phase 12, Wave 5 (Task D) — admin-only "Job status" view of
 * `background_jobs`. No slot for this exists in `lib/nav.ts` or any
 * supplied Stitch screenshot (checked before adding this — mirrors
 * `apps/web/app/(app)/copilot/page.tsx`'s own precedent for a genuinely
 * new destination). Placed as a nested `/settings/jobs` route, following
 * `/settings/team`'s exact pattern, rather than a new top-level nav entry:
 * this is an oversight/ops surface for admins, the same category as
 * team management, not a primary workflow destination the brief's Stitch
 * designs would have reserved a nav slot for. Linked from the Settings
 * page's Workspace section, visible only to platform_admin/agency_admin.
 */
export default async function JobStatusPage() {
  if (!supabaseConfigured) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Job status"
          description="Background job history for this organization."
        />
        <EmptyState
          icon={ListChecks}
          title="Not connected to a live database"
          description="Job history will appear here once this environment has a configured Supabase project."
        />
      </div>
    )
  }

  const user = await requireAuth('/settings/jobs')
  const membership = await resolveActiveOrg(user.id)
  if (membership.role !== 'platform_admin' && membership.role !== 'agency_admin') {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Job status"
          description="Background job history for this organization."
        />
        <EmptyState
          icon={ListChecks}
          title="Not available"
          description="Job status is visible to agency and platform admins only."
        />
      </div>
    )
  }

  const supabase = await createServerSupabaseClient()
  const [jobs, counts] = await Promise.all([
    loadJobs(membership.organizationId, supabase!),
    loadJobStatusCounts(membership.organizationId, supabase!),
  ])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Job status"
        description="Background job history — document processing, AI extraction, notifications, integration syncs, and more."
      />
      <JobStatusPanel jobs={jobs} counts={counts} />
    </div>
  )
}
