import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Breadcrumbs, Button, Card, CardBody, StatusBadge, WorkflowStepper } from '@rqi/ui'
import { ArchiveProjectButton } from '@/components/domain/projects/archive-project-button'
import { ResetDemoDataButton } from '@/components/domain/demo/reset-demo-data-button'
import { supabaseConfigured } from '@/lib/env'
import { requireAuth, resolveActiveOrg } from '@/lib/auth/session'
import { requireProjectAccess } from '@/lib/auth/project-access'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import {
  getDemoProject,
  getDemoJob,
  getDemoProjectStageSignals,
  listDemoCandidatesForProject,
} from '@/lib/demo/engine'
import type { Job, RecruitmentProject } from '@rqi/types'

/**
 * Build Phase 18 repair: force dynamic rendering — this page reads the
 * private demo's mutable in-memory engine, and static prerendering would
 * freeze it at build time forever in production. See
 * docs/demo-limitations.md §8 and the matching note on
 * candidates/[candidateId]/page.tsx.
 */
export const dynamic = 'force-dynamic'

async function loadProject(
  projectId: string,
): Promise<{ project: RecruitmentProject | null; jobs: Job[]; organizationId: string | null }> {
  if (!supabaseConfigured) {
    // Build Phase 18: the project's actual status, stage signals, and
    // candidate pipeline now come from the demo engine's real state
    // instead of a hardcoded mock — see
    // docs/client-feedback-reproduction-report.md §4 (the stepper always
    // rendered "Intake/Requirements/Scorecard" as complete no matter what).
    const summary = getDemoProject(projectId)
    if (!summary) return { project: null, jobs: [], organizationId: null }
    const job = getDemoJob(projectId)
    const project: RecruitmentProject = {
      id: summary.id,
      organizationId: 'demo',
      clientId: summary.id,
      clientName: summary.clientName,
      roleTitle: summary.roleTitle,
      vertical: summary.clientVertical,
      status: summary.status,
      isPoc: true,
      targetShortlistSize: 3,
      matchThreshold: 70,
      archivedAt: null,
      clientCanApproveScorecards: false,
      createdAt: new Date().toISOString(),
    }
    const jobs: Job[] = job
      ? [
          {
            id: job.id,
            recruitmentProjectId: projectId,
            organizationId: 'demo',
            title: job.title,
            department: job.department,
            industry: summary.clientVertical,
            employmentType: job.employmentType as Job['employmentType'],
            workplaceArrangement: 'onsite' as Job['workplaceArrangement'],
            location: job.location,
            commutingRadiusMiles: null,
            salaryMin: job.salaryMin,
            salaryMax: job.salaryMax,
            currency: 'USD',
            workAuthorizationRequired: 'Required',
            sponsorshipAvailable: false,
            targetStartDate: null,
            hiringManagerNotes: null,
            maxShortlistSize: 3,
            minMatchThreshold: 70,
            status: 'open',
            createdAt: new Date().toISOString(),
          },
        ]
      : []
    return { project, jobs, organizationId: null }
  }

  const user = await requireAuth(`/projects/${projectId}`)
  const membership = await resolveActiveOrg(user.id)
  const supabase = await createServerSupabaseClient()

  const { data: row } = await supabase!
    .from('recruitment_projects')
    .select(
      'id, organization_id, client_id, role_title, vertical, status, is_poc, target_shortlist_size, match_threshold, archived_at, client_can_approve_scorecards, created_at, clients(name)',
    )
    .eq('id', projectId)
    .eq('organization_id', membership.organizationId)
    .maybeSingle()

  if (!row) return { project: null, jobs: [], organizationId: membership.organizationId }

  await requireProjectAccess(user.id, membership, { id: row.id, clientId: row.client_id })

  const project: RecruitmentProject = {
    id: row.id,
    organizationId: row.organization_id,
    clientId: row.client_id,
    clientName: (row.clients as unknown as { name: string } | null)?.name ?? 'Unknown client',
    roleTitle: row.role_title,
    vertical: row.vertical ?? '',
    status: row.status,
    isPoc: row.is_poc,
    targetShortlistSize: row.target_shortlist_size,
    matchThreshold: Number(row.match_threshold),
    archivedAt: row.archived_at,
    clientCanApproveScorecards: row.client_can_approve_scorecards,
    createdAt: row.created_at,
  }

  const { data: jobRows } = await supabase!
    .from('jobs')
    .select(
      'id, recruitment_project_id, organization_id, title, department, industry, employment_type, workplace_arrangement, location, commuting_radius_miles, salary_min, salary_max, currency, work_authorization_required, sponsorship_available, target_start_date, hiring_manager_notes, max_shortlist_size, min_match_threshold, status, created_at',
    )
    .eq('recruitment_project_id', projectId)
    .order('created_at', { ascending: false })

  const jobs: Job[] = (jobRows ?? []).map((j) => ({
    id: j.id,
    recruitmentProjectId: j.recruitment_project_id,
    organizationId: j.organization_id,
    title: j.title,
    department: j.department,
    industry: j.industry,
    employmentType: j.employment_type,
    workplaceArrangement: j.workplace_arrangement,
    location: j.location ?? '',
    commutingRadiusMiles: j.commuting_radius_miles,
    salaryMin: j.salary_min,
    salaryMax: j.salary_max,
    currency: j.currency,
    workAuthorizationRequired: j.work_authorization_required,
    sponsorshipAvailable: j.sponsorship_available,
    targetStartDate: j.target_start_date,
    hiringManagerNotes: j.hiring_manager_notes,
    maxShortlistSize: j.max_shortlist_size,
    minMatchThreshold: Number(j.min_match_threshold),
    status: j.status,
    createdAt: j.created_at,
  }))

  return { project, jobs, organizationId: membership.organizationId }
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  const { project, jobs, organizationId } = await loadProject(projectId)
  if (!project) notFound()

  const demoStageSteps = !supabaseConfigured ? getDemoProjectStageSignals(projectId) : null
  const demoCandidates = !supabaseConfigured ? listDemoCandidatesForProject(projectId) : []

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[{ label: 'Projects', href: '/projects' }, { label: project.roleTitle }]}
      />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-tertiary text-2xl font-bold">{project.roleTitle}</h1>
          <p className="text-muted mt-1 text-sm">
            {project.clientName} · {project.vertical}
            {project.isPoc ? ' · Proof of concept' : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={`/projects/${project.id}/activity`}
            className="text-secondary text-sm font-medium hover:underline"
          >
            View activity
          </Link>
          <Link
            href={`/projects/${project.id}/scorecard`}
            className="text-secondary text-sm font-medium hover:underline"
          >
            View scorecard
          </Link>
          {organizationId && !project.archivedAt && (
            <ArchiveProjectButton
              organizationId={organizationId}
              projectId={project.id}
              clientId={project.clientId}
            />
          )}
          {!supabaseConfigured && <ResetDemoDataButton />}
        </div>
      </div>

      <Card>
        <CardBody className="flex flex-col gap-3">
          {/*
            Build Phase 18: in demo mode, every step below is derived from
            the demo engine's real, live-computed state (candidates added,
            evaluations run, eligible candidates, shortlist built, outreach
            drafted) — not a hardcoded array. See
            lib/projects/workflow-state-machine.ts computeWorkflowStageStatuses()
            and docs/client-feedback-reproduction-report.md §4.
          */}
          <WorkflowStepper
            steps={
              demoStageSteps
                ? demoStageSteps.map((s) => ({
                    label: s.label,
                    status: s.status === 'blocked' ? 'upcoming' : s.status,
                  }))
                : [
                { label: 'Intake', status: 'complete' },
                { label: 'Requirements', status: 'complete' },
                { label: 'Scorecard', status: 'complete' },
                {
                  label: 'Sourcing',
                  status: project.status === 'sourcing' ? 'current' : 'complete',
                },
                {
                  label: 'Shortlisting',
                  status: project.status === 'shortlisting' ? 'current' : 'upcoming',
                },
                { label: 'Client review', status: 'upcoming' },
              ]
            }
          />
          <p className="text-muted text-xs">
            Current project status: <span className="text-tertiary font-medium">{project.status}</span>
          </p>
        </CardBody>
      </Card>

      <section aria-labelledby="jobs-heading" className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 id="jobs-heading" className="font-display text-tertiary text-[15px] font-semibold">
            Jobs
          </h2>
          <Button asChild size="sm" variant="secondary">
            <Link href={`/projects/${project.id}/jobs/new`}>Add job</Link>
          </Button>
        </div>
        {jobs.length === 0 ? (
          <Card>
            <CardBody className="text-muted text-sm">
              No jobs on this project yet. Add one to start job-description intake.
            </CardBody>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {jobs.map((job) => (
              <Card key={job.id}>
                <CardBody className="flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-tertiary text-sm font-semibold">{job.title}</p>
                    <StatusBadge status={job.status === 'open' ? 'passed' : 'neutral'}>
                      {job.status}
                    </StatusBadge>
                  </div>
                  <p className="text-muted text-xs">
                    {job.location || 'Location TBD'} · {job.workplaceArrangement.replace('_', ' ')}{' '}
                    · {job.employmentType.replace('_', ' ')}
                  </p>
                  <Link
                    href={`/projects/${project.id}/jobs/${job.id}/description`}
                    className="text-secondary text-xs font-medium hover:underline"
                  >
                    Job description
                  </Link>
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="pipeline-heading" className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 id="pipeline-heading" className="font-display text-tertiary text-[15px] font-semibold">
            Candidate pipeline
          </h2>
          {!supabaseConfigured && (
            <Link
              href="/shortlists"
              className="text-secondary text-xs font-medium hover:underline"
            >
              Go to shortlist workspace
            </Link>
          )}
        </div>
        {!supabaseConfigured ? (
          demoCandidates.length === 0 ? (
            <Card>
              <CardBody className="text-muted text-sm">No candidates on this project yet.</CardBody>
            </Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-3">
              {demoCandidates.map((candidate) => {
                const evaluation = candidate.evaluation
                const gatesPassed = evaluation?.gates.filter((g) => g.result === 'passed').length ?? 0
                const gatesTotal = evaluation?.gates.length ?? 0
                return (
                  <Link key={candidate.id} href={`/candidates/${candidate.id}`}>
                    <Card className="hover:border-secondary h-full transition-colors">
                      <CardBody className="flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <p className="text-tertiary text-sm font-semibold">{candidate.fullName}</p>
                          {evaluation?.status === 'completed' ? (
                            <StatusBadge status={gatesPassed === gatesTotal ? 'passed' : 'failed'}>
                              {gatesPassed}/{gatesTotal} gates
                            </StatusBadge>
                          ) : (
                            <StatusBadge status="pending">Not evaluated</StatusBadge>
                          )}
                        </div>
                        <p className="font-display text-tertiary text-2xl font-bold">
                          {evaluation?.overallScore ?? '—'}%
                        </p>
                        <p className="text-muted text-xs">
                          {evaluation?.evidenceCoveragePct ?? 0}% evidence
                          {candidate.isShortlisted ? ' · Shortlisted' : ''}
                        </p>
                      </CardBody>
                    </Card>
                  </Link>
                )
              })}
            </div>
          )
        ) : (
          <Card>
            <CardBody className="text-muted text-sm">
              <Link href="/candidates" className="text-secondary hover:underline">
                View candidates for this project
              </Link>
            </CardBody>
          </Card>
        )}
      </section>
    </div>
  )
}
