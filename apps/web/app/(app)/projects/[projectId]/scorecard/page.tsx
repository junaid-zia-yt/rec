import { notFound } from 'next/navigation'
import { Breadcrumbs, Card, CardBody, EmptyState, PageHeader } from '@rqi/ui'
import type { Job, JobRequirement } from '@rqi/types'
import { anthropicConfigured, supabaseConfigured } from '@/lib/env'
import { getDemoProject, getDemoJob } from '@/lib/demo/engine'
import { requireAuth, resolveActiveOrg } from '@/lib/auth/session'
import { requireProjectAccess } from '@/lib/auth/project-access'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { validateRequirementWeights } from '@/lib/scoring/validate-weights'
import { RequirementExtractionPanel } from '@/components/domain/scorecard/requirement-extraction-panel'
import { RequirementListEditor } from '@/components/domain/scorecard/requirement-list-editor'
import {
  ScorecardApprovalPanel,
  type ScorecardVersionSummary,
} from '@/components/domain/scorecard/scorecard-approval-panel'

/**
 * Build Phase 18 repair: force dynamic rendering for the same reason as
 * candidates/[candidateId]/page.tsx and projects/[projectId]/page.tsx —
 * this page reads the private demo's mutable in-memory engine and must
 * never be frozen at build time. See docs/demo-limitations.md §8.
 */
export const dynamic = 'force-dynamic'

interface ScorecardPageData {
  project: {
    id: string
    roleTitle: string
    clientId: string
    clientCanApproveScorecards: boolean
  } | null
  organizationId: string | null
  job: Job | null
  hasJobDescription: boolean
  jobDescriptionId: string | null
  requirements: JobRequirement[]
  versions: ScorecardVersionSummary[]
  pendingVersionId: string | null
  role:
    | 'platform_admin'
    | 'agency_admin'
    | 'recruiter'
    | 'client_decision_maker'
    | 'read_only_reviewer'
    | null
}

/**
 * Loads everything the Job Scorecard screen needs (Build Phase 4 brief
 * §UI: "Job scorecard editor"). Row-level access is enforced the same way
 * every other project-scoped page enforces it — requireProjectAccess throws
 * (rendering the shared not-found boundary) rather than this page doing its
 * own ad hoc role check.
 */
async function loadScorecardData(projectId: string): Promise<ScorecardPageData> {
  if (!supabaseConfigured) {
    // Build Phase 18: sourced from the same demo engine every other screen
    // uses, so a project's scorecard link never 404s regardless of which
    // demo project id is in the URL (see
    // docs/client-feedback-reproduction-report.md — the old static
    // DEMO_PROJECTS/DEMO_JOBS fixtures used different ids than the demo
    // engine's UUID-based ids once the engine shipped). Requirement
    // creation/edit/approval actions already have their own
    // `!supabaseConfigured` guard (lib/requirements/actions.ts,
    // lib/scorecards/actions.ts) and return an honest "not available in
    // this demo" message rather than crashing — the scorecard for both
    // demo projects is seeded as already approved
    // (lib/demo/engine.ts buildInitialState), consistent with this demo
    // being about matching/shortlisting/outreach, not scorecard editing.
    const summary = getDemoProject(projectId)
    const job = getDemoJob(projectId)
    const requirements: JobRequirement[] = (job?.requirements ?? []).map((r) => ({
      id: r.requirementId,
      jobId: job!.id,
      jobDescriptionId: null,
      organizationId: 'demo',
      name: r.name,
      description: r.description,
      category: r.category,
      type: r.type,
      weight: r.weight,
      evidenceExpected: r.description,
      sourceText: null,
      sourceLocation: null,
      confidence: null,
      verificationStatus: 'verified',
      reviewerNotes: null,
      status: 'reviewed',
      aiGenerated: false,
      createdAt: new Date().toISOString(),
    }))
    return {
      project: summary
        ? {
            id: summary.id,
            roleTitle: summary.roleTitle,
            clientId: summary.id,
            clientCanApproveScorecards: false,
          }
        : null,
      organizationId: null,
      job: job
        ? ({
            id: job.id,
            recruitmentProjectId: projectId,
            organizationId: 'demo',
            title: job.title,
          } as Job)
        : null,
      hasJobDescription: Boolean(job),
      jobDescriptionId: null,
      requirements,
      versions: [
        {
          id: `${projectId}:v1`,
          versionNo: 1,
          status: 'active',
          approvedBy: 'Dana Reyes (demo)',
          approvedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        },
      ],
      pendingVersionId: null,
      role: 'agency_admin',
    }
  }

  const user = await requireAuth(`/projects/${projectId}/scorecard`)
  const membership = await resolveActiveOrg(user.id)
  const supabase = await createServerSupabaseClient()

  const { data: projectRow } = await supabase!
    .from('recruitment_projects')
    .select('id, role_title, client_id, client_can_approve_scorecards')
    .eq('id', projectId)
    .eq('organization_id', membership.organizationId)
    .maybeSingle()

  if (!projectRow) {
    return {
      project: null,
      organizationId: membership.organizationId,
      job: null,
      hasJobDescription: false,
      jobDescriptionId: null,
      requirements: [],
      versions: [],
      pendingVersionId: null,
      role: membership.role,
    }
  }

  await requireProjectAccess(user.id, membership, {
    id: projectRow.id,
    clientId: projectRow.client_id,
  })

  const { data: jobRow } = await supabase!
    .from('jobs')
    .select(
      'id, recruitment_project_id, organization_id, title, department, industry, employment_type, workplace_arrangement, location, commuting_radius_miles, salary_min, salary_max, currency, work_authorization_required, sponsorship_available, target_start_date, hiring_manager_notes, max_shortlist_size, min_match_threshold, status, created_at',
    )
    .eq('recruitment_project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const job: Job | null = jobRow
    ? {
        id: jobRow.id,
        recruitmentProjectId: jobRow.recruitment_project_id,
        organizationId: jobRow.organization_id,
        title: jobRow.title,
        department: jobRow.department,
        industry: jobRow.industry,
        employmentType: jobRow.employment_type,
        workplaceArrangement: jobRow.workplace_arrangement,
        location: jobRow.location ?? '',
        commutingRadiusMiles: jobRow.commuting_radius_miles,
        salaryMin: jobRow.salary_min,
        salaryMax: jobRow.salary_max,
        currency: jobRow.currency,
        workAuthorizationRequired: jobRow.work_authorization_required,
        sponsorshipAvailable: jobRow.sponsorship_available,
        targetStartDate: jobRow.target_start_date,
        hiringManagerNotes: jobRow.hiring_manager_notes,
        maxShortlistSize: jobRow.max_shortlist_size,
        minMatchThreshold: Number(jobRow.min_match_threshold),
        status: jobRow.status,
        createdAt: jobRow.created_at,
      }
    : null

  if (!job) {
    return {
      project: {
        id: projectRow.id,
        roleTitle: projectRow.role_title,
        clientId: projectRow.client_id,
        clientCanApproveScorecards: projectRow.client_can_approve_scorecards,
      },
      organizationId: membership.organizationId,
      job: null,
      hasJobDescription: false,
      jobDescriptionId: null,
      requirements: [],
      versions: [],
      pendingVersionId: null,
      role: membership.role,
    }
  }

  const [{ data: jdRow }, { data: requirementRows }, { data: scorecardRow }] = await Promise.all([
    supabase!
      .from('job_descriptions')
      .select('id')
      .eq('job_id', job.id)
      .is('superseded_at', null)
      .maybeSingle(),
    supabase!
      .from('job_requirements')
      .select(
        'id, job_id, job_description_id, organization_id, name, description, category, type, weight, evidence_expected, source_text, source_location, confidence, verification_status, reviewer_notes, status, ai_generated, created_at',
      )
      .eq('job_id', job.id)
      .order('created_at', { ascending: true }),
    supabase!.from('scorecards').select('id').eq('job_id', job.id).maybeSingle(),
  ])

  const requirements: JobRequirement[] = (requirementRows ?? []).map((r) => ({
    id: r.id,
    jobId: r.job_id,
    jobDescriptionId: r.job_description_id,
    organizationId: r.organization_id,
    name: r.name,
    description: r.description,
    category: r.category,
    type: r.type,
    weight: r.weight === null ? null : Number(r.weight),
    evidenceExpected: r.evidence_expected,
    sourceText: r.source_text,
    sourceLocation: r.source_location,
    confidence: r.confidence === null ? null : Number(r.confidence),
    verificationStatus: r.verification_status,
    reviewerNotes: r.reviewer_notes,
    status: r.status,
    aiGenerated: r.ai_generated,
    createdAt: r.created_at,
  }))

  let versions: ScorecardVersionSummary[] = []
  let pendingVersionId: string | null = null
  if (scorecardRow) {
    const { data: versionRows } = await supabase!
      .from('scorecard_versions')
      .select('id, version_no, status, approved_by, approved_at, created_at')
      .eq('scorecard_id', scorecardRow.id)
      .order('version_no', { ascending: false })

    versions = (versionRows ?? []).map((v) => ({
      id: v.id,
      versionNo: v.version_no,
      status: v.status,
      approvedBy: v.approved_by,
      approvedAt: v.approved_at,
      createdAt: v.created_at,
    }))
    pendingVersionId = versions.find((v) => v.status === 'pending_approval')?.id ?? null
  }

  return {
    project: {
      id: projectRow.id,
      roleTitle: projectRow.role_title,
      clientId: projectRow.client_id,
      clientCanApproveScorecards: projectRow.client_can_approve_scorecards,
    },
    organizationId: membership.organizationId,
    job,
    hasJobDescription: Boolean(jdRow),
    jobDescriptionId: jdRow?.id ?? null,
    requirements,
    versions,
    pendingVersionId,
    role: membership.role,
  }
}

export default async function ScorecardPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  const data = await loadScorecardData(projectId)
  if (!data.project) notFound()

  const { project, job, organizationId, role } = data
  const canEdit = role === 'recruiter' || role === 'agency_admin' || role === 'platform_admin'
  const canApprove =
    role === 'agency_admin' ||
    role === 'platform_admin' ||
    (role === 'client_decision_maker' && project.clientCanApproveScorecards)
  const canManageClientPermission = role === 'agency_admin' || role === 'platform_admin'

  const weightCheck = validateRequirementWeights(
    data.requirements.map((r) => ({ id: r.id, type: r.type, weight: r.weight })),
  )

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: 'Projects', href: '/projects' },
          { label: project.roleTitle, href: `/projects/${project.id}` },
          { label: 'Scorecard' },
        ]}
      />
      <PageHeader
        title="Job scorecard"
        description="AI-proposed and human-authored requirements, weighted and gated, with human approval required before sourcing begins."
      />

      {!job ? (
        <Card>
          <CardBody>
            <EmptyState
              title="No job on this project yet"
              description="Add a job before building its scorecard."
            />
          </CardBody>
        </Card>
      ) : (
        <>
          <Card>
            <CardBody>
              <RequirementExtractionPanel
                organizationId={organizationId ?? ''}
                projectId={project.id}
                projectClientId={project.clientId}
                jobId={job.id}
                jobDescriptionId={data.jobDescriptionId}
                hasJobDescription={data.hasJobDescription}
                aiAvailable={anthropicConfigured}
              />
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <RequirementListEditor
                organizationId={organizationId ?? ''}
                projectId={project.id}
                projectClientId={project.clientId}
                jobId={job.id}
                requirements={data.requirements}
                canEdit={canEdit}
              />
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <ScorecardApprovalPanel
                organizationId={organizationId ?? ''}
                projectId={project.id}
                projectClientId={project.clientId}
                projectClientCanApproveScorecards={project.clientCanApproveScorecards}
                jobId={job.id}
                versions={data.versions}
                pendingVersionId={data.pendingVersionId}
                canSubmit={canEdit}
                canApprove={canApprove}
                canManageClientPermission={canManageClientPermission}
                weightsValid={weightCheck.valid && data.requirements.length > 0}
              />
            </CardBody>
          </Card>
        </>
      )}
    </div>
  )
}
