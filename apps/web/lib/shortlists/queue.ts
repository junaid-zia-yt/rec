import 'server-only'
import type { CandidateRoleMatch } from '@rqi/types'

/**
 * Deterministic quality-review queue ordering (Build Phase 8 brief
 * §"Quality-review queue": "sort by eligibility and match; never rank
 * failed mandatory-gate candidates"). Pure function — no AI call, no
 * database.
 *
 * "Never rank failed mandatory-gate candidates" does not mean hiding them —
 * a reviewer must still see them to act on missing evidence or a failed
 * gate (brief §"show missing evidence") — it means an ineligible candidate
 * is never interleaved into the ranked-by-score portion of the list. This
 * function therefore groups by eligibility first (eligible, then
 * pending_verification, then ineligible), and only ranks by score WITHIN
 * the eligible group. Ties within a group fall back to oldest-first, so a
 * candidate that has been waiting longest surfaces first among equals.
 */
const ELIGIBILITY_ORDER: Record<CandidateRoleMatch['eligibility'], number> = {
  eligible: 0,
  pending_verification: 1,
  ineligible: 2,
}

export function sortQualityReviewQueue<
  T extends Pick<CandidateRoleMatch, 'eligibility' | 'overallScore' | 'createdAt'>,
>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    const eligibilityDiff = ELIGIBILITY_ORDER[a.eligibility] - ELIGIBILITY_ORDER[b.eligibility]
    if (eligibilityDiff !== 0) return eligibilityDiff

    // Within the eligible group, higher score first; nulls (should not
    // occur for eligible rows per the DB CHECK, but guarded anyway) sort
    // last rather than throwing off the ordering.
    const scoreA = a.overallScore ?? -Infinity
    const scoreB = b.overallScore ?? -Infinity
    if (scoreA !== scoreB) return scoreB - scoreA

    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  })
}

/**
 * Brief: "never rank failed mandatory-gate candidates" — the hard
 * structural filter behind any TOP-N / ranked-shortlist-candidates view, as
 * distinct from the full review queue above which still shows everyone.
 */
export function filterRankable<T extends Pick<CandidateRoleMatch, 'eligibility'>>(
  entries: T[],
): T[] {
  return entries.filter((entry) => entry.eligibility === 'eligible')
}
