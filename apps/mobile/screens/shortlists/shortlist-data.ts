import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Shared RLS-scoped loader for the Final shortlist / Candidate comparison /
 * Client decision screens — all three render the same underlying shortlist
 * + current-version + candidate set (docs/03-screen-inventory.md §3.3's
 * Verification Matrix fields: score, gates passed/total, evidence %,
 * completeness %, recruiter note — no siteCount/headcount/plVolume/etc.,
 * since those have no backing columns anywhere in the schema, same known
 * gap the web app's live view documents), so the query lives once here
 * instead of three times.
 */
export interface ShortlistCandidateRow {
  shortlistCandidateId: string
  candidateId: string
  candidateName: string
  candidateRoleMatchId: string
  rank: number
  overallScore: number | null
  evidenceCoveragePct: number
  dataCompletenessPct: number
  gatesPassed: number
  gatesTotal: number
  gatesFailed: number
  recruiterNote: string | null
}

export interface ShortlistDetail {
  shortlistId: string
  shortlistVersionId: string
  recruitmentProjectId: string
  jobId: string
  jobTitle: string
  clientId: string
  clientName: string
  status: string
  maxCandidates: number
  candidates: ShortlistCandidateRow[]
}

export async function loadShortlistDetail(
  supabase: SupabaseClient,
  organizationId: string,
  params: { shortlistId?: string; projectId?: string },
  // docs/privacy-review.md §5 — recruiter_note is internal-only, never
  // client-visible (mirrors apps/web/lib/shortlists/visibility.ts's
  // serializeShortlistCandidateForClient, which strips this same field for
  // a client_decision_maker on the web side). RLS on shortlist_candidates
  // cannot redact this column by itself, so it must be stripped here,
  // before it ever reaches a caller's JS memory on-device — not just
  // before it's rendered. Defaults to false (safe-by-default): a caller
  // must explicitly opt in as an internal, non-client screen.
  options: { includeInternalNotes?: boolean } = {},
): Promise<ShortlistDetail | null> {
  const includeInternalNotes = options.includeInternalNotes ?? false
  let shortlistQuery = supabase
    .from('shortlists')
    .select(
      'id, recruitment_project_id, job_id, client_id, status, max_candidates, jobs(title), clients(name)',
    )
    .eq('organization_id', organizationId)

  if (params.shortlistId) shortlistQuery = shortlistQuery.eq('id', params.shortlistId)
  else if (params.projectId)
    shortlistQuery = shortlistQuery.eq('recruitment_project_id', params.projectId)

  const { data: shortlistRows, error: shortlistError } = await shortlistQuery
    .order('updated_at', { ascending: false })
    .limit(1)
  if (shortlistError) throw new Error(shortlistError.message)
  const shortlist = shortlistRows?.[0] as Record<string, unknown> | undefined
  if (!shortlist) return null

  const { data: versionRows, error: versionError } = await supabase
    .from('shortlist_versions')
    .select('id, status')
    .eq('shortlist_id', shortlist.id as string)
    .order('version_number', { ascending: false })
    .limit(1)
  if (versionError) throw new Error(versionError.message)
  const version = versionRows?.[0] as { id: string; status: string } | undefined
  if (!version) return null

  const { data: candRows, error: candError } = await supabase
    .from('shortlist_candidates')
    .select(
      'id, candidate_id, candidate_role_match_id, rank, recruiter_note, candidates(full_name), candidate_role_matches(overall_score, evidence_coverage_pct, data_completeness_pct)',
    )
    .eq('shortlist_version_id', version.id)
    .order('rank', { ascending: true })
  if (candError) throw new Error(candError.message)

  const rows = candRows ?? []
  const matchIds = rows.map((r: Record<string, unknown>) => r.candidate_role_match_id as string)

  let gateCounts = new Map<string, { passed: number; total: number; failed: number }>()
  if (matchIds.length > 0) {
    const { data: gateRows, error: gateError } = await supabase
      .from('mandatory_gate_results')
      .select('candidate_role_match_id, state')
      .in('candidate_role_match_id', matchIds)
    if (gateError) throw new Error(gateError.message)
    gateCounts = new Map()
    for (const g of gateRows ?? []) {
      const key = g.candidate_role_match_id as string
      const entry = gateCounts.get(key) ?? { passed: 0, total: 0, failed: 0 }
      entry.total += 1
      if (
        g.state === 'passed' ||
        (g.state === 'human_override' && (g as { state: string }).state)
      ) {
        // human_override counted below via a second pass since its pass/fail depends on override_result
      }
      gateCounts.set(key, entry)
    }
    // Second, precise pass: re-derive effective pass/fail (handles human_override).
    const { data: preciseGates } = await supabase
      .from('mandatory_gate_results')
      .select('candidate_role_match_id, state, override_result')
      .in('candidate_role_match_id', matchIds)
    gateCounts = new Map()
    for (const g of preciseGates ?? []) {
      const key = g.candidate_role_match_id as string
      const entry = gateCounts.get(key) ?? { passed: 0, total: 0, failed: 0 }
      entry.total += 1
      const effective =
        g.state === 'human_override'
          ? g.override_result
          : g.state === 'passed'
            ? 'pass'
            : g.state === 'failed'
              ? 'fail'
              : 'unknown'
      if (effective === 'pass') entry.passed += 1
      else if (effective === 'fail') entry.failed += 1
      gateCounts.set(key, entry)
    }
  }

  const candidates: ShortlistCandidateRow[] = rows.map((r: Record<string, unknown>) => {
    const match = r.candidate_role_matches as {
      overall_score: number | null
      evidence_coverage_pct: number
      data_completeness_pct: number
    } | null
    const counts = gateCounts.get(r.candidate_role_match_id as string) ?? {
      passed: 0,
      total: 0,
      failed: 0,
    }
    return {
      shortlistCandidateId: r.id as string,
      candidateId: r.candidate_id as string,
      candidateName: (r.candidates as { full_name?: string } | null)?.full_name ?? 'Candidate',
      candidateRoleMatchId: r.candidate_role_match_id as string,
      rank: r.rank as number,
      overallScore: match?.overall_score ?? null,
      evidenceCoveragePct: match?.evidence_coverage_pct ?? 0,
      dataCompletenessPct: match?.data_completeness_pct ?? 0,
      gatesPassed: counts.passed,
      gatesTotal: counts.total,
      gatesFailed: counts.failed,
      recruiterNote: includeInternalNotes ? (r.recruiter_note as string | null) : null,
    }
  })

  return {
    shortlistId: shortlist.id as string,
    shortlistVersionId: version.id,
    recruitmentProjectId: shortlist.recruitment_project_id as string,
    jobId: shortlist.job_id as string,
    jobTitle: (shortlist.jobs as { title?: string } | null)?.title ?? 'Role',
    clientId: shortlist.client_id as string,
    clientName: (shortlist.clients as { name?: string } | null)?.name ?? 'Client',
    status: shortlist.status as string,
    maxCandidates: shortlist.max_candidates as number,
    candidates,
  }
}
