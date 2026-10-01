import { describe, expect, it } from 'vitest'
import type { CandidateRoleMatch } from '@rqi/types'
import { filterRankable, sortQualityReviewQueue } from './queue'

function entry(
  overrides: Partial<CandidateRoleMatch> = {},
): Pick<CandidateRoleMatch, 'eligibility' | 'overallScore' | 'createdAt'> & { id: string } {
  return {
    id: 'match-1',
    eligibility: 'eligible',
    overallScore: 80,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('sortQualityReviewQueue', () => {
  it('groups eligible candidates before pending_verification before ineligible', () => {
    const entries = [
      entry({ id: 'ineligible', eligibility: 'ineligible', overallScore: null }),
      entry({ id: 'eligible', eligibility: 'eligible', overallScore: 50 }),
      entry({ id: 'pending', eligibility: 'pending_verification', overallScore: null }),
    ]
    const sorted = sortQualityReviewQueue(entries)
    expect(sorted.map((e) => e.id)).toEqual(['eligible', 'pending', 'ineligible'])
  })

  it('ranks eligible candidates by score descending within the eligible group', () => {
    const entries = [
      entry({ id: 'low', overallScore: 40 }),
      entry({ id: 'high', overallScore: 95 }),
      entry({ id: 'mid', overallScore: 70 }),
    ]
    const sorted = sortQualityReviewQueue(entries)
    expect(sorted.map((e) => e.id)).toEqual(['high', 'mid', 'low'])
  })

  it('never interleaves an ineligible candidate into the ranked eligible group, even with a higher nominal score', () => {
    // An ineligible row should always have a null overallScore per the DB
    // CHECK, but this guards the sort itself against ever letting a
    // non-eligible row outrank an eligible one on score alone.
    const entries = [
      entry({ id: 'ineligible-but-scored', eligibility: 'ineligible', overallScore: null }),
      entry({ id: 'eligible-lower', eligibility: 'eligible', overallScore: 10 }),
    ]
    const sorted = sortQualityReviewQueue(entries)
    expect(sorted.map((e) => e.id)).toEqual(['eligible-lower', 'ineligible-but-scored'])
  })

  it('breaks ties within a group by oldest first', () => {
    const entries = [
      entry({ id: 'newer', overallScore: 60, createdAt: '2026-02-01T00:00:00Z' }),
      entry({ id: 'older', overallScore: 60, createdAt: '2026-01-01T00:00:00Z' }),
    ]
    const sorted = sortQualityReviewQueue(entries)
    expect(sorted.map((e) => e.id)).toEqual(['older', 'newer'])
  })
})

describe('filterRankable', () => {
  it('excludes every non-eligible candidate from a ranked view', () => {
    const entries = [
      entry({ id: 'a', eligibility: 'eligible' }),
      entry({ id: 'b', eligibility: 'ineligible' }),
      entry({ id: 'c', eligibility: 'pending_verification' }),
    ]
    expect(filterRankable(entries).map((e) => e.id)).toEqual(['a'])
  })
})
