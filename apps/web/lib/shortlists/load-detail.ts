import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export interface ShortlistCandidateRow {
  shortlistCandidateId: string
  candidateId: string
  candidateName: string
  candidateRoleMatchId: string
  matchingRunId: string
  scorecardVersionId: string
  rank: number
  overallScore: number | null
  evidenceCoveragePct: number
  dataCompletenessPct: number
  gatesPassed: number
  gatesTotal: number
  recruiterNote: string | null
}

export interface ShortlistDetail {
  id: string
  organizationId: string
  recruitmentProjectId: string
  jobId: string
  jobTitle: string
  clientId: string
  clientName: string
  status: string
  maxCandidates: number
  currentVersionId: string | null
  currentVersionStatus: string | null
  candidates: ShortlistCandidateRow[]
}

export interface EligibleCandidateForShortlist {
  candidateRoleMatchId: string
  candidateId: string
  candidateName: string
  matchingRunId: string
  scorecardVersionId: string
  overallScore: number | null
}

/**
 * Live loader for one shortlist and its current version's candidates (Build
 * Phase 8 brief §"Shortlist"/§"Candidate comparison"). Mirrors the candidate
 * detail page's live-loading pattern.
 *
 * `existingClient` (Build Phase 11 Wave 5 fix): optional pre-authenticated
 * Supabase client to reuse instead of constructing a fresh one from the
 * current request's cookies. Every ordinary page caller omits this and gets
 * the original behavior unchanged. This parameter exists because
 * `apps/web/lib/copilot/tools/shortlist.ts`'s `compareApprovedCandidates`
 * was calling this function with NO client at all, silently discarding the
 * already-authorized `CopilotToolContext.supabase` client the rest of that
 * turn's orchestration uses — the one genuine bug this wave's adversarial
 * testing found (see docs/build-phase-11-report.md): it made the tool
 * unable to participate in `runCopilotTurn`'s single-client-per-turn
 * invariant, and, more concretely, unable to be exercised at all against the
 * deterministic fake-Supabase test harness every other copilot tool test
 * uses (in an environment with no live Supabase configured, the client this
 * function constructed for itself was always `null`, so the tool could never
 * be driven through a real call in a test — only ever reachable indirectly
 * through mocking). Passing `ctx.supabase` through fixes both.
 */
export async function loadShortlistDetail(
  organizationId: string,
  shortlistId: string,
  existingClient?: SupabaseClient,
): Promise<ShortlistDetail | null> {
  const supabase = existingClient ?? (await createServerSupabaseClient())
  if (!supabase) return null

  const { data: shortlist } = await supabase
    .from('shortlists')
    .select(
      'id, organization_id, recruitment_project_id, job_id, client_id, status, max_candidates, current_version_id',
    )
    .eq('id', shortlistId)
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (!shortlist) return null

  const [{ data: job }, { data: client }, { data: version }] = await Promise.all([
    supabase.from('jobs').select('title').eq('id', shortlist.job_id).maybeSingle(),
    supabase.from('clients').select('name').eq('id', shortlist.client_id).maybeSingle(),
    shortlist.current_version_id
      ? supabase
          .from('shortlist_versions')
          .select('id, status')
          .eq('id', shortlist.current_version_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  let candidates: ShortlistCandidateRow[] = []
  if (shortlist.current_version_id) {
    const { data: scRows } = await supabase
      .from('shortlist_candidates')
      .select(
        'id, candidate_id, candidate_role_match_id, matching_run_id, scorecard_version_id, rank, recruiter_note',
      )
      .eq('shortlist_version_id', shortlist.current_version_id)
      .order('rank', { ascending: true })

    if (scRows && scRows.length > 0) {
      const candidateIds = scRows.map((r) => r.candidate_id)
      const matchIds = scRows.map((r) => r.candidate_role_match_id)

      const [{ data: candidateRows }, { data: matchRows }, { data: gateRows }] = await Promise.all([
        supabase.from('candidates').select('id, full_name').in('id', candidateIds),
        supabase
          .from('candidate_role_matches')
          .select('id, overall_score, evidence_coverage_pct, data_completeness_pct')
          .in('id', matchIds),
        supabase
          .from('mandatory_gate_results')
          .select('candidate_role_match_id, state')
          .in('candidate_role_match_id', matchIds),
      ])

      const nameById = new Map(
        (candidateRows ?? []).map((c) => [c.id as string, c.full_name as string]),
      )
      const matchById = new Map((matchRows ?? []).map((m) => [m.id as string, m]))
      const gatesByMatch = new Map<string, { passed: number; total: number }>()
      for (const gate of gateRows ?? []) {
        const bucket = gatesByMatch.get(gate.candidate_role_match_id) ?? { passed: 0, total: 0 }
        bucket.total += 1
        if (gate.state === 'passed' || gate.state === 'human_override') bucket.passed += 1
        gatesByMatch.set(gate.candidate_role_match_id, bucket)
      }

      candidates = scRows.map((row) => {
        const match = matchById.get(row.candidate_role_match_id)
        const gates = gatesByMatch.get(row.candidate_role_match_id) ?? { passed: 0, total: 0 }
        return {
          shortlistCandidateId: row.id,
          candidateId: row.candidate_id,
          candidateName: nameById.get(row.candidate_id) ?? 'Unknown candidate',
          candidateRoleMatchId: row.candidate_role_match_id,
          matchingRunId: row.matching_run_id,
          scorecardVersionId: row.scorecard_version_id,
          rank: row.rank,
          overallScore: match?.overall_score ?? null,
          evidenceCoveragePct: match?.evidence_coverage_pct ?? 0,
          dataCompletenessPct: match?.data_completeness_pct ?? 0,
          gatesPassed: gates.passed,
          gatesTotal: gates.total,
          recruiterNote: row.recruiter_note,
        }
      })
    }
  }

  return {
    id: shortlist.id,
    organizationId: shortlist.organization_id,
    recruitmentProjectId: shortlist.recruitment_project_id,
    jobId: shortlist.job_id,
    jobTitle: job?.title ?? 'Unknown role',
    clientId: shortlist.client_id,
    clientName: client?.name ?? 'Unknown client',
    status: shortlist.status,
    maxCandidates: shortlist.max_candidates,
    currentVersionId: shortlist.current_version_id,
    currentVersionStatus: version?.status ?? null,
    candidates,
  }
}

/** Eligible candidates for this job not already on the shortlist's current version — the builder's "add" list (brief: "never rank failed mandatory-gate candidates" applies here too, via the eligibility filter). */
export async function loadEligibleCandidatesForShortlist(
  organizationId: string,
  jobId: string,
  excludeCandidateIds: string[],
): Promise<EligibleCandidateForShortlist[]> {
  const supabase = await createServerSupabaseClient()
  if (!supabase) return []

  const { data: matches } = await supabase
    .from('candidate_role_matches')
    .select('id, candidate_id, latest_matching_run_id, scorecard_version_id, overall_score')
    .eq('organization_id', organizationId)
    .eq('job_id', jobId)
    .eq('eligibility', 'eligible')

  if (!matches || matches.length === 0) return []

  const filtered = matches.filter((m) => !excludeCandidateIds.includes(m.candidate_id))
  if (filtered.length === 0) return []

  const { data: candidateRows } = await supabase
    .from('candidates')
    .select('id, full_name')
    .in(
      'id',
      filtered.map((m) => m.candidate_id),
    )
  const nameById = new Map(
    (candidateRows ?? []).map((c) => [c.id as string, c.full_name as string]),
  )

  return filtered
    .map((m) => ({
      candidateRoleMatchId: m.id,
      candidateId: m.candidate_id,
      candidateName: nameById.get(m.candidate_id) ?? 'Unknown candidate',
      matchingRunId: m.latest_matching_run_id,
      scorecardVersionId: m.scorecard_version_id,
      overallScore: m.overall_score,
    }))
    .sort((a, b) => (b.overallScore ?? 0) - (a.overallScore ?? 0))
}
