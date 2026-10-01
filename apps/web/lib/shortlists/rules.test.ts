import { describe, expect, it } from 'vitest'
import {
  canAddCandidateToShortlist,
  nextShortlistRank,
  validateOverrideAuthorization,
} from './rules'

describe('canAddCandidateToShortlist', () => {
  const shortlist = { maxCandidates: 3, overrideMaxCandidates: false }

  it('rejects a candidate that is not eligible', () => {
    const violation = canAddCandidateToShortlist({
      shortlist,
      existingCandidates: [],
      candidate: { candidateId: 'cand-1', eligibility: 'ineligible' },
    })
    expect(violation?.code).toBe('not_eligible')
  })

  it('rejects a candidate that is pending_verification', () => {
    const violation = canAddCandidateToShortlist({
      shortlist,
      existingCandidates: [],
      candidate: { candidateId: 'cand-1', eligibility: 'pending_verification' },
    })
    expect(violation?.code).toBe('not_eligible')
  })

  it('rejects a duplicate candidate', () => {
    const violation = canAddCandidateToShortlist({
      shortlist,
      existingCandidates: [{ candidateId: 'cand-1' }],
      candidate: { candidateId: 'cand-1', eligibility: 'eligible' },
    })
    expect(violation?.code).toBe('duplicate_candidate')
  })

  it('rejects a fourth candidate without an override', () => {
    const violation = canAddCandidateToShortlist({
      shortlist,
      existingCandidates: [{ candidateId: 'a' }, { candidateId: 'b' }, { candidateId: 'c' }],
      candidate: { candidateId: 'd', eligibility: 'eligible' },
    })
    expect(violation?.code).toBe('max_candidates_exceeded')
  })

  it('allows a fourth candidate when overrideMaxCandidates is set', () => {
    const violation = canAddCandidateToShortlist({
      shortlist: { maxCandidates: 3, overrideMaxCandidates: true },
      existingCandidates: [{ candidateId: 'a' }, { candidateId: 'b' }, { candidateId: 'c' }],
      candidate: { candidateId: 'd', eligibility: 'eligible' },
    })
    expect(violation).toBeNull()
  })

  it('allows an eligible, non-duplicate candidate within the limit', () => {
    const violation = canAddCandidateToShortlist({
      shortlist,
      existingCandidates: [{ candidateId: 'a' }],
      candidate: { candidateId: 'b', eligibility: 'eligible' },
    })
    expect(violation).toBeNull()
  })
})

describe('nextShortlistRank', () => {
  it('returns 1 for an empty shortlist', () => {
    expect(nextShortlistRank([])).toBe(1)
  })

  it('returns one past the highest existing rank', () => {
    expect(nextShortlistRank([{ rank: 1 }, { rank: 3 }])).toBe(4)
  })
})

describe('validateOverrideAuthorization', () => {
  it('passes when no override is requested', () => {
    expect(
      validateOverrideAuthorization({
        overrideMaxCandidates: false,
        overrideBy: null,
        overrideReason: null,
      }),
    ).toBeNull()
  })

  it('requires an authorizer when overriding', () => {
    expect(
      validateOverrideAuthorization({
        overrideMaxCandidates: true,
        overrideBy: null,
        overrideReason: 'client asked for 5',
      }),
    ).toMatch(/who authorized/)
  })

  it('requires a non-empty reason when overriding', () => {
    expect(
      validateOverrideAuthorization({
        overrideMaxCandidates: true,
        overrideBy: 'user-1',
        overrideReason: '   ',
      }),
    ).toMatch(/reason/)
  })

  it('passes with both an authorizer and a reason', () => {
    expect(
      validateOverrideAuthorization({
        overrideMaxCandidates: true,
        overrideBy: 'user-1',
        overrideReason: 'client asked for 5',
      }),
    ).toBeNull()
  })
})
