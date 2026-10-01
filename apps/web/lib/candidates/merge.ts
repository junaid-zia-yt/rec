import type { CandidateRecord } from '@rqi/types'

/**
 * Pure pre-merge validation — Build Phase 5 brief §"Deduplication":
 * "Human decision before merging", "No destructive automatic merge". This
 * is the deterministic gate the merge server action (lib/candidates/actions.ts)
 * must pass before it writes anything; the actual merge (reassigning every
 * child row's candidate_id from loser to winner, marking the loser
 * status='merged', writing the audit_events row) is necessarily I/O and
 * lives in the server action — but which merges are even legal is decided
 * here, and unit-tested without a database.
 */

export interface MergeValidationResult {
  valid: boolean
  reason?: string
}

/**
 * A merge is legal only when: the two candidates are different rows, both
 * belong to the same organization (tenant isolation — a merge can never
 * cross organizations even if both ids happen to exist), and neither is
 * already the losing side of an earlier merge (merging into an already-
 * merged record would silently orphan the chain — the recruiter must merge
 * into the *current* surviving record instead).
 */
export function validateCandidateMerge(
  winner: Pick<CandidateRecord, 'id' | 'organizationId' | 'status'>,
  loser: Pick<CandidateRecord, 'id' | 'organizationId' | 'status'>,
): MergeValidationResult {
  if (winner.id === loser.id) {
    return { valid: false, reason: 'A candidate cannot be merged into itself.' }
  }

  if (winner.organizationId !== loser.organizationId) {
    return { valid: false, reason: 'Candidates from different organizations cannot be merged.' }
  }

  if (winner.status === 'merged') {
    return {
      valid: false,
      reason:
        'The record you chose to keep has itself already been merged into another candidate — merge into the current surviving record instead.',
    }
  }

  if (loser.status === 'merged') {
    return { valid: false, reason: 'This candidate has already been merged.' }
  }

  return { valid: true }
}
