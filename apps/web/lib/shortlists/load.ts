import 'server-only'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { sortQualityReviewQueue } from './queue'
import type { ReviewQueueEntry } from '@/components/domain/shortlists/review-queue-panel'

/**
 * Live data loader for the quality-review queue (Build Phase 8 brief
 * §"Quality-review queue"). Mirrors the candidate detail page's
 * loadLiveDetail pattern (apps/web/app/(app)/candidates/[candidateId]/
 * page.tsx): plain Supabase reads, mapped into the shape the panel
 * component expects, with the actual ordering delegated to the pure
 * sortQualityReviewQueue function rather than a SQL ORDER BY — the "group
 * by eligibility, never interleave an ineligible candidate" rule is
 * easier to keep correct and unit-tested as TypeScript than as SQL.
 */
export async function loadReviewQueue(organizationId: string): Promise<ReviewQueueEntry[]> {
  const supabase = await createServerSupabaseClient()
  if (!supabase) return []

  const { data: matches } = await supabase
    .from('candidate_role_matches')
    .select(
      'id, candidate_id, job_id, eligibility, overall_score, evidence_coverage_pct, data_completeness_pct, review_status, created_at',
    )
    .eq('organization_id', organizationId)
    .in('review_status', ['pending', 'requires_verification', 'escalated'])

  if (!matches || matches.length === 0) return []

  const candidateIds = [...new Set(matches.map((m) => m.candidate_id))]
  const jobIds = [...new Set(matches.map((m) => m.job_id))]
  const matchIds = matches.map((m) => m.id)

  const [{ data: candidates }, { data: jobs }, { data: gateResults }, { data: extractedFields }] =
    await Promise.all([
      supabase.from('candidates').select('id, full_name').in('id', candidateIds),
      supabase.from('jobs').select('id, title').in('id', jobIds),
      supabase
        .from('mandatory_gate_results')
        .select('candidate_role_match_id, state')
        .in('candidate_role_match_id', matchIds),
      supabase
        .from('candidate_extracted_fields')
        .select('candidate_id, verification_status')
        .in('candidate_id', candidateIds),
    ])

  const candidateNameById = new Map(
    (candidates ?? []).map((c) => [c.id as string, c.full_name as string]),
  )
  const jobTitleById = new Map((jobs ?? []).map((j) => [j.id as string, j.title as string]))

  const missingEvidenceByMatch = new Map<string, number>()
  for (const gate of gateResults ?? []) {
    if (gate.state === 'unknown') {
      missingEvidenceByMatch.set(
        gate.candidate_role_match_id,
        (missingEvidenceByMatch.get(gate.candidate_role_match_id) ?? 0) + 1,
      )
    }
  }

  const unverifiedByCandidate = new Map<string, number>()
  for (const field of extractedFields ?? []) {
    if (field.verification_status !== 'verified' && field.verification_status !== 'edited') {
      unverifiedByCandidate.set(
        field.candidate_id,
        (unverifiedByCandidate.get(field.candidate_id) ?? 0) + 1,
      )
    }
  }

  const entries: ReviewQueueEntry[] = matches.map((match) => ({
    candidateRoleMatchId: match.id,
    candidateId: match.candidate_id,
    candidateName: candidateNameById.get(match.candidate_id) ?? 'Unknown candidate',
    jobId: match.job_id,
    jobTitle: jobTitleById.get(match.job_id) ?? 'Unknown role',
    eligibility: match.eligibility,
    overallScore: match.overall_score,
    evidenceCoveragePct: match.evidence_coverage_pct,
    dataCompletenessPct: match.data_completeness_pct,
    reviewStatus: match.review_status,
    missingEvidenceCount: missingEvidenceByMatch.get(match.id) ?? 0,
    unverifiedFieldCount: unverifiedByCandidate.get(match.candidate_id) ?? 0,
    createdAt: match.created_at,
  }))

  return sortQualityReviewQueue(entries)
}

export interface ShortlistableJob {
  jobId: string
  jobTitle: string
  recruitmentProjectId: string
  clientId: string
  clientName: string
  eligibleCount: number
}

/** Jobs with at least one eligible candidate and no shortlist yet — the "start a shortlist" prompt on the Shortlists tab. */
export async function loadShortlistableJobs(organizationId: string): Promise<ShortlistableJob[]> {
  const supabase = await createServerSupabaseClient()
  if (!supabase) return []

  const [{ data: eligibleMatches }, { data: existingShortlists }] = await Promise.all([
    supabase
      .from('candidate_role_matches')
      .select('job_id')
      .eq('organization_id', organizationId)
      .eq('eligibility', 'eligible'),
    supabase.from('shortlists').select('job_id').eq('organization_id', organizationId),
  ])

  const shortlistedJobIds = new Set((existingShortlists ?? []).map((s) => s.job_id))
  const eligibleCountByJob = new Map<string, number>()
  for (const match of eligibleMatches ?? []) {
    if (shortlistedJobIds.has(match.job_id)) continue
    eligibleCountByJob.set(match.job_id, (eligibleCountByJob.get(match.job_id) ?? 0) + 1)
  }

  const jobIds = [...eligibleCountByJob.keys()]
  if (jobIds.length === 0) return []

  const { data: jobs } = await supabase
    .from('jobs')
    .select('id, title, recruitment_project_id')
    .in('id', jobIds)
  if (!jobs || jobs.length === 0) return []

  const projectIds = [...new Set(jobs.map((j) => j.recruitment_project_id))]
  const { data: projects } = await supabase
    .from('recruitment_projects')
    .select('id, client_id')
    .in('id', projectIds)
  const clientIdByProject = new Map(
    (projects ?? []).map((p) => [p.id as string, p.client_id as string]),
  )

  const clientIds = [...new Set([...clientIdByProject.values()])]
  const { data: clients } = await supabase.from('clients').select('id, name').in('id', clientIds)
  const clientNameById = new Map((clients ?? []).map((c) => [c.id as string, c.name as string]))

  return jobs.map((job) => {
    const clientId = clientIdByProject.get(job.recruitment_project_id) ?? ''
    return {
      jobId: job.id,
      jobTitle: job.title,
      recruitmentProjectId: job.recruitment_project_id,
      clientId,
      clientName: clientNameById.get(clientId) ?? 'Unknown client',
      eligibleCount: eligibleCountByJob.get(job.id) ?? 0,
    }
  })
}
