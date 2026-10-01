import 'server-only'
import type { CandidateRoleMatch, ShortlistCandidate, ShortlistRecord } from '@rqi/types'

/**
 * Deterministic shortlist-composition rules (Build Phase 8 brief
 * §"Shortlist": "default maximum of three candidates; require an
 * authorized override to exceed the limit... prevent duplicate candidate
 * inclusion"). Pure functions — no database. These mirror, and exist to
 * give a friendly pre-flight error ahead of, the authoritative enforcement
 * in supabase/migrations/0028's `enforce_shortlist_candidate_rules()`
 * trigger and UNIQUE(shortlist_version_id, candidate_id) constraint — the
 * database is the final authority; this module exists so a server action
 * can reject a bad request with a clear message instead of surfacing a raw
 * Postgres error to the UI.
 */

export type ShortlistRuleViolation =
  | { code: 'not_eligible'; message: string }
  | { code: 'duplicate_candidate'; message: string }
  | { code: 'max_candidates_exceeded'; message: string }

/** Brief: "never rank failed mandatory-gate candidates" — applied again here at the shortlist-build boundary, not just the queue view. */
export function canAddCandidateToShortlist(params: {
  shortlist: Pick<ShortlistRecord, 'maxCandidates' | 'overrideMaxCandidates'>
  existingCandidates: Pick<ShortlistCandidate, 'candidateId'>[]
  candidate: Pick<CandidateRoleMatch, 'candidateId' | 'eligibility'>
}): ShortlistRuleViolation | null {
  const { shortlist, existingCandidates, candidate } = params

  if (candidate.eligibility !== 'eligible') {
    return {
      code: 'not_eligible',
      message:
        'This candidate has not passed every mandatory requirement and cannot be added to a shortlist.',
    }
  }

  if (existingCandidates.some((existing) => existing.candidateId === candidate.candidateId)) {
    return {
      code: 'duplicate_candidate',
      message: 'This candidate is already on this shortlist.',
    }
  }

  if (!shortlist.overrideMaxCandidates && existingCandidates.length + 1 > shortlist.maxCandidates) {
    return {
      code: 'max_candidates_exceeded',
      message: `This shortlist already has the maximum of ${shortlist.maxCandidates} candidates. An authorized override is required to add more.`,
    }
  }

  return null
}

/** The rank to assign a newly-added candidate: one past the highest existing rank (never reused, even after a removal — ranks are a display order, not a dense sequence). */
export function nextShortlistRank(existingCandidates: Pick<ShortlistCandidate, 'rank'>[]): number {
  return existingCandidates.reduce((max, candidate) => Math.max(max, candidate.rank), 0) + 1
}

/** Brief: "require an authorized override to exceed the limit" — the override itself must carry who and why, mirroring the DB CHECK constraint (shortlists_override_requires_reason). */
export function validateOverrideAuthorization(params: {
  overrideMaxCandidates: boolean
  overrideBy: string | null
  overrideReason: string | null
}): string | null {
  if (!params.overrideMaxCandidates) return null
  if (!params.overrideBy) return 'An override must record who authorized it.'
  if (!params.overrideReason || params.overrideReason.trim().length === 0) {
    return 'An override must include a reason.'
  }
  return null
}
