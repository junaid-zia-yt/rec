import 'server-only'
import { z } from 'zod'
import { assertResourceOwnership } from '../resource-ownership'
import {
  markUntrustedNullable,
  type CopilotToolContext,
  type CopilotToolHandlerResult,
  CopilotToolInputError,
} from './shared'

/**
 * Build Phase 11, Wave 2 — tools/project.ts.
 *
 * Three capabilities backed by `recruitment_projects` / `jobs` /
 * `scorecard_versions` / `job_requirements`. No shared loader module exists
 * for these tables (they are read inline in server components — see
 * apps/web/app/(app)/projects/[projectId]/page.tsx and .../scorecard/
 * page.tsx) so these handlers query the same tables those pages already
 * read, in the same shape, rather than re-deriving a different projection —
 * they are new READ paths over already-established tables, not a
 * reimplementation of any existing business logic (there is none to reuse
 * here beyond "select these columns").
 */

// ---------------------------------------------------------------------------
// summarize_recruitment_project
// ---------------------------------------------------------------------------

export const SummarizeRecruitmentProjectInputSchema = z.object({
  recruitmentProjectId: z.string().uuid(),
})
export type SummarizeRecruitmentProjectInput = z.infer<
  typeof SummarizeRecruitmentProjectInputSchema
>

export const SummarizeRecruitmentProjectOutputSchema = z.object({
  recruitmentProjectId: z.string(),
  roleTitle: z.string(),
  clientId: z.string(),
  clientName: z.string(),
  status: z.string(),
  isPoc: z.boolean(),
  targetShortlistSize: z.number().int(),
  matchThreshold: z.number(),
  jobs: z.array(z.object({ jobId: z.string(), title: z.string(), status: z.string() })),
  candidateCounts: z.object({
    total: z.number().int(),
    eligible: z.number().int(),
    ineligible: z.number().int(),
    pendingVerification: z.number().int(),
    shortlisted: z.number().int(),
  }),
})
export type SummarizeRecruitmentProjectOutput = z.infer<
  typeof SummarizeRecruitmentProjectOutputSchema
>

export async function summarizeRecruitmentProject(
  ctx: CopilotToolContext,
  input: SummarizeRecruitmentProjectInput,
): Promise<CopilotToolHandlerResult<SummarizeRecruitmentProjectOutput>> {
  const { supabase, organizationId, userId, role } = ctx

  const ownership = await assertResourceOwnership(supabase, {
    organizationId,
    userId,
    role,
    resourceType: 'recruitment_project',
    resourceId: input.recruitmentProjectId,
  })

  const { data: project } = await supabase
    .from('recruitment_projects')
    .select('id, role_title, client_id, status, is_poc, target_shortlist_size, match_threshold')
    .eq('id', input.recruitmentProjectId)
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (!project)
    throw new CopilotToolInputError(`recruitment project ${input.recruitmentProjectId} not found`)

  const { data: client } = await supabase
    .from('clients')
    .select('name')
    .eq('id', project.client_id)
    .maybeSingle()

  const { data: jobs } = await supabase
    .from('jobs')
    .select('id, title, status')
    .eq('recruitment_project_id', input.recruitmentProjectId)
    .eq('organization_id', organizationId)

  const jobIds = (jobs ?? []).map((j) => j.id as string)

  let candidateCounts = {
    total: 0,
    eligible: 0,
    ineligible: 0,
    pendingVerification: 0,
    shortlisted: 0,
  }
  if (jobIds.length > 0) {
    const [{ data: matches }, { data: shortlistCandidates }] = await Promise.all([
      supabase
        .from('candidate_role_matches')
        .select('eligibility')
        .in('job_id', jobIds)
        .eq('organization_id', organizationId),
      supabase
        .from('shortlists')
        .select('id, current_version_id')
        .eq('recruitment_project_id', input.recruitmentProjectId)
        .eq('organization_id', organizationId),
    ])

    candidateCounts.total = matches?.length ?? 0
    for (const m of matches ?? []) {
      if (m.eligibility === 'eligible') candidateCounts.eligible += 1
      else if (m.eligibility === 'ineligible') candidateCounts.ineligible += 1
      else if (m.eligibility === 'pending_verification') candidateCounts.pendingVerification += 1
    }

    const versionIds = (shortlistCandidates ?? [])
      .map((s) => s.current_version_id)
      .filter((v): v is string => v !== null)
    if (versionIds.length > 0) {
      const { data: scRows } = await supabase
        .from('shortlist_candidates')
        .select('id')
        .in('shortlist_version_id', versionIds)
      candidateCounts.shortlisted = scRows?.length ?? 0
    }
  }

  const output: SummarizeRecruitmentProjectOutput = {
    recruitmentProjectId: project.id,
    roleTitle: project.role_title,
    clientId: project.client_id,
    clientName: client?.name ?? 'Unknown client',
    status: project.status,
    isPoc: project.is_poc,
    targetShortlistSize: project.target_shortlist_size,
    matchThreshold: Number(project.match_threshold),
    jobs: (jobs ?? []).map((j) => ({
      jobId: j.id as string,
      title: j.title as string,
      status: j.status as string,
    })),
    candidateCounts,
  }

  return { output, citations: [], ownership: [ownership] }
}

// ---------------------------------------------------------------------------
// explain_scorecard
// ---------------------------------------------------------------------------

export const ExplainScorecardInputSchema = z.object({
  jobId: z.string().uuid(),
})
export type ExplainScorecardInput = z.infer<typeof ExplainScorecardInputSchema>

const ScorecardRequirementSchema = z.object({
  requirementId: z.string(),
  name: z.string(),
  /** Untrusted only in the sense that it may originate from AI-extracted JD text a human has not yet reviewed — see verificationStatus. Never treated as instructions. */
  description: z.string().nullable(),
  type: z.string(),
  weight: z.number().nullable(),
  evidenceExpected: z.string().nullable(),
  verificationStatus: z.string(),
})

export const ExplainScorecardOutputSchema = z.object({
  jobId: z.string(),
  jobTitle: z.string(),
  scorecardId: z.string().nullable(),
  scorecardVersionId: z.string().nullable(),
  versionNo: z.number().int().nullable(),
  versionStatus: z.string().nullable(),
  requirements: z.array(ScorecardRequirementSchema),
})
export type ExplainScorecardOutput = z.infer<typeof ExplainScorecardOutputSchema>

export async function explainScorecard(
  ctx: CopilotToolContext,
  input: ExplainScorecardInput,
): Promise<CopilotToolHandlerResult<ExplainScorecardOutput>> {
  const { supabase, organizationId, userId, role } = ctx

  const ownership = await assertResourceOwnership(supabase, {
    organizationId,
    userId,
    role,
    resourceType: 'job',
    resourceId: input.jobId,
  })

  const { data: job } = await supabase
    .from('jobs')
    .select('id, title')
    .eq('id', input.jobId)
    .eq('organization_id', organizationId)
    .maybeSingle()
  if (!job) throw new CopilotToolInputError(`job ${input.jobId} not found`)

  const { data: scorecard } = await supabase
    .from('scorecards')
    .select('id')
    .eq('job_id', input.jobId)
    .eq('organization_id', organizationId)
    .maybeSingle()

  let scorecardVersion: { id: string; version_no: number; status: string } | null = null
  if (scorecard) {
    const { data } = await supabase
      .from('scorecard_versions')
      .select('id, version_no, status')
      .eq('scorecard_id', scorecard.id)
      .order('version_no', { ascending: false })
      .limit(1)
      .maybeSingle()
    scorecardVersion = data
  }

  const { data: requirements } = await supabase
    .from('job_requirements')
    .select('id, name, description, type, weight, evidence_expected, verification_status')
    .eq('job_id', input.jobId)
    .eq('organization_id', organizationId)

  const requirementRows = requirements ?? []

  const output: ExplainScorecardOutput = {
    jobId: job.id,
    jobTitle: job.title,
    scorecardId: scorecard?.id ?? null,
    scorecardVersionId: scorecardVersion?.id ?? null,
    versionNo: scorecardVersion?.version_no ?? null,
    versionStatus: scorecardVersion?.status ?? null,
    requirements: requirementRows.map((r) => ({
      requirementId: r.id as string,
      name: r.name as string,
      description: markUntrustedNullable(r.description as string | null) as string | null,
      type: r.type as string,
      weight: r.weight as number | null,
      evidenceExpected: markUntrustedNullable(r.evidence_expected as string | null) as
        string | null,
      verificationStatus: r.verification_status as string,
    })),
  }

  const citations: {
    kind: 'job_requirement' | 'scorecard_version'
    id: string
    excerpt: string | null
  }[] = requirementRows.map((r) => ({
    kind: 'job_requirement' as const,
    id: r.id as string,
    excerpt: (r.name as string) ?? null,
  }))
  if (scorecardVersion)
    citations.push({ kind: 'scorecard_version' as const, id: scorecardVersion.id, excerpt: null })

  return { output, citations, ownership: [ownership] }
}

// ---------------------------------------------------------------------------
// find_missing_job_requirements
// ---------------------------------------------------------------------------

export const FindMissingJobRequirementsInputSchema = z.object({
  jobId: z.string().uuid(),
})
export type FindMissingJobRequirementsInput = z.infer<typeof FindMissingJobRequirementsInputSchema>

export const FindMissingJobRequirementsOutputSchema = z.object({
  jobId: z.string(),
  hasNoRequirements: z.boolean(),
  hasNoMandatoryRequirements: z.boolean(),
  hasNoScorecard: z.boolean(),
  requirementsMissingEvidenceExpected: z.array(
    z.object({ requirementId: z.string(), name: z.string() }),
  ),
  requirementsUnverified: z.array(z.object({ requirementId: z.string(), name: z.string() })),
  requirementsNeedingClarification: z.array(
    z.object({ requirementId: z.string(), name: z.string() }),
  ),
})
export type FindMissingJobRequirementsOutput = z.infer<
  typeof FindMissingJobRequirementsOutputSchema
>

export async function findMissingJobRequirements(
  ctx: CopilotToolContext,
  input: FindMissingJobRequirementsInput,
): Promise<CopilotToolHandlerResult<FindMissingJobRequirementsOutput>> {
  const { supabase, organizationId, userId, role } = ctx

  const ownership = await assertResourceOwnership(supabase, {
    organizationId,
    userId,
    role,
    resourceType: 'job',
    resourceId: input.jobId,
  })

  const [{ data: scorecard }, { data: requirements }] = await Promise.all([
    supabase
      .from('scorecards')
      .select('id')
      .eq('job_id', input.jobId)
      .eq('organization_id', organizationId)
      .maybeSingle(),
    supabase
      .from('job_requirements')
      .select('id, name, type, evidence_expected, verification_status')
      .eq('job_id', input.jobId)
      .eq('organization_id', organizationId),
  ])

  const requirementRows = requirements ?? []

  const missingEvidence = requirementRows.filter(
    (r) => !r.evidence_expected || String(r.evidence_expected).trim().length === 0,
  )
  const unverified = requirementRows.filter((r) => r.verification_status === 'unverified')
  const needsClarification = requirementRows.filter((r) => r.type === 'requires_clarification')

  const output: FindMissingJobRequirementsOutput = {
    jobId: input.jobId,
    hasNoRequirements: requirementRows.length === 0,
    hasNoMandatoryRequirements: !requirementRows.some((r) => r.type === 'mandatory'),
    hasNoScorecard: !scorecard,
    requirementsMissingEvidenceExpected: missingEvidence.map((r) => ({
      requirementId: r.id as string,
      name: r.name as string,
    })),
    requirementsUnverified: unverified.map((r) => ({
      requirementId: r.id as string,
      name: r.name as string,
    })),
    requirementsNeedingClarification: needsClarification.map((r) => ({
      requirementId: r.id as string,
      name: r.name as string,
    })),
  }

  const citations = [...missingEvidence, ...unverified, ...needsClarification].map((r) => ({
    kind: 'job_requirement' as const,
    id: r.id as string,
    excerpt: r.name as string,
  }))

  return { output, citations, ownership: [ownership] }
}
