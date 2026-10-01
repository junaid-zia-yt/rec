import Link from 'next/link'
import {
  Card,
  CardBody,
  PageHeader,
  SectionHeader,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@rqi/ui'
import { hasPermission } from '@rqi/types'
import { supabaseConfigured } from '@/lib/env'
import { requireAuth, resolveActiveOrg } from '@/lib/auth/session'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { loadReviewQueue, loadShortlistableJobs } from '@/lib/shortlists/load'
import { ReviewQueuePanel } from '@/components/domain/shortlists/review-queue-panel'
import { StartShortlistButton } from '@/components/domain/shortlists/start-shortlist-button'
import { listDemoProjects } from '@/lib/demo/engine'
import { ResetDemoDataButton } from '@/components/domain/demo/reset-demo-data-button'

export const metadata = { title: 'Shortlists' }
// Build Phase 18 repair: force dynamic rendering — reads the private
// demo's mutable in-memory engine. See docs/demo-limitations.md §8.
export const dynamic = 'force-dynamic'

interface ShortlistListRow {
  id: string
  jobTitle: string
  clientName: string
  status: string
}

async function loadShortlists(organizationId: string): Promise<ShortlistListRow[]> {
  const supabase = await createServerSupabaseClient()
  if (!supabase) return []

  const { data: shortlists } = await supabase
    .from('shortlists')
    .select('id, job_id, client_id, status')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })

  if (!shortlists || shortlists.length === 0) return []

  const jobIds = [...new Set(shortlists.map((s) => s.job_id))]
  const clientIds = [...new Set(shortlists.map((s) => s.client_id))]
  const [{ data: jobs }, { data: clients }] = await Promise.all([
    supabase.from('jobs').select('id, title').in('id', jobIds),
    supabase.from('clients').select('id, name').in('id', clientIds),
  ])
  const jobTitleById = new Map((jobs ?? []).map((j) => [j.id as string, j.title as string]))
  const clientNameById = new Map((clients ?? []).map((c) => [c.id as string, c.name as string]))

  return shortlists.map((row) => ({
    id: row.id,
    jobTitle: jobTitleById.get(row.job_id) ?? 'Unknown role',
    clientName: clientNameById.get(row.client_id) ?? 'Unknown client',
    status: row.status,
  }))
}

/**
 * Shortlists hub — Build Phase 8 brief. Two tabs under the existing
 * "Shortlists" nav entry (mobile-bottom-nav.tsx's fixed 5-item nav) rather
 * than a new top-level nav item, so the quality-review queue is reachable
 * without redesigning navigation (project instructions: "Do not redesign
 * the interface without explaining why" — this is the explanation).
 */
export default async function ShortlistsPage() {
  if (!supabaseConfigured) {
    // Build Phase 18: every project's shortlist status, candidate count and
    // eligible count below is the demo engine's real, live-computed state —
    // this used to be a single static row pointing at one hardcoded fixture
    // regardless of what had actually happened in the demo session (see
    // docs/client-feedback-reproduction-report.md §3).
    const projects = listDemoProjects()
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <PageHeader
            title="Shortlists"
            description="Finalized candidate shortlists awaiting or completed client review."
          />
          <ResetDemoDataButton />
        </div>
        <div className="flex flex-col gap-3">
          {projects.map((project) => (
            <Card key={project.id}>
              <Link href={`/shortlists/${project.id}`}>
                <CardBody className="hover:bg-canvas flex items-center justify-between gap-4">
                  <div>
                    <p className="text-tertiary text-sm font-semibold">{project.roleTitle}</p>
                    <p className="text-muted text-xs">
                      {project.clientName} · {project.eligibleCount} eligible ·{' '}
                      {project.shortlistCount}/3 shortlisted
                    </p>
                  </div>
                  <StatusBadge
                    status={
                      project.shortlistStatus === 'submitted' ||
                      project.shortlistStatus === 'client_review'
                        ? 'passed'
                        : project.shortlistStatus === 'not_started'
                          ? 'neutral'
                          : 'pending'
                    }
                  >
                    {project.shortlistStatus.replace(/_/g, ' ')}
                  </StatusBadge>
                </CardBody>
              </Link>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  const user = await requireAuth('/shortlists')
  const membership = await resolveActiveOrg(user.id)
  const canReview = hasPermission(membership.role, 'human_reviews', 'update')

  const canBuildShortlists = hasPermission(membership.role, 'shortlists', 'create')

  const [queueEntries, shortlists, shortlistableJobs] = await Promise.all([
    canReview ? loadReviewQueue(membership.organizationId) : Promise.resolve([]),
    loadShortlists(membership.organizationId),
    canBuildShortlists ? loadShortlistableJobs(membership.organizationId) : Promise.resolve([]),
  ])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Shortlists"
        description="Quality review, shortlist building, and client decisions."
      />

      <Tabs defaultValue={canReview ? 'review' : 'shortlists'}>
        <TabsList>
          {canReview && (
            <TabsTrigger value="review">Quality review ({queueEntries.length})</TabsTrigger>
          )}
          <TabsTrigger value="shortlists">Shortlists</TabsTrigger>
        </TabsList>

        {canReview && (
          <TabsContent value="review" className="pt-4">
            <ReviewQueuePanel organizationId={membership.organizationId} entries={queueEntries} />
          </TabsContent>
        )}

        <TabsContent value="shortlists" className="pt-4">
          {shortlistableJobs.length > 0 && (
            <div className="mb-4 flex flex-col gap-2">
              <SectionHeader title="Ready to shortlist" />
              {shortlistableJobs.map((job) => (
                <Card key={job.jobId}>
                  <CardBody className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-tertiary text-sm font-semibold">{job.jobTitle}</p>
                      <p className="text-muted text-xs">
                        {job.clientName} · {job.eligibleCount} eligible candidate(s)
                      </p>
                    </div>
                    <StartShortlistButton
                      organizationId={membership.organizationId}
                      recruitmentProjectId={job.recruitmentProjectId}
                      jobId={job.jobId}
                      clientId={job.clientId}
                    />
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
          {shortlists.length === 0 ? (
            <Card>
              <CardBody>
                <p className="text-muted text-sm">
                  No shortlists yet. Build one from an eligible candidate&rsquo;s evaluation.
                </p>
              </CardBody>
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              {shortlists.map((shortlist) => (
                <Card key={shortlist.id}>
                  <Link href={`/shortlists/${shortlist.id}`}>
                    <CardBody className="hover:bg-canvas flex items-center justify-between gap-4">
                      <div>
                        <p className="text-tertiary text-sm font-semibold">{shortlist.jobTitle}</p>
                        <p className="text-muted text-xs">{shortlist.clientName}</p>
                      </div>
                      <StatusBadge
                        status={
                          shortlist.status === 'accepted'
                            ? 'passed'
                            : shortlist.status === 'rejected'
                              ? 'failed'
                              : 'pending'
                        }
                      >
                        {shortlist.status.replace(/_/g, ' ')}
                      </StatusBadge>
                    </CardBody>
                  </Link>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
