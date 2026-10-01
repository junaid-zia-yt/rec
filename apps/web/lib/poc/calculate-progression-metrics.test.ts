import { describe, expect, it } from 'vitest'
import type { CandidateProjectEntry, CandidateRoleMatch, PocExclusion } from '@rqi/types'
import {
  calculateCandidatesDiscovered,
  calculateCandidatesReviewed,
  calculateInterviewProgression,
  calculateOfferProgression,
} from './calculate-progression-metrics'

function entry(overrides: Partial<CandidateProjectEntry> = {}): CandidateProjectEntry {
  return {
    id: `entry-${overrides.candidateId ?? '1'}`,
    candidateId: 'cand-1',
    recruitmentProjectId: 'proj-1',
    jobId: 'job-1',
    currentStage: 'discovered',
    clientVisible: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function match(overrides: Partial<CandidateRoleMatch> = {}): CandidateRoleMatch {
  return {
    id: `match-${overrides.candidateId ?? '1'}`,
    organizationId: 'org-1',
    candidateId: 'cand-1',
    jobId: 'job-1',
    recruitmentProjectId: 'proj-1',
    scorecardVersionId: 'sv-1',
    latestMatchingRunId: 'run-1',
    eligibility: 'eligible',
    overallScore: 92,
    evidenceCoveragePct: 100,
    dataCompletenessPct: 100,
    confidence: 0.9,
    reviewStatus: 'approved_for_outreach',
    reviewedBy: 'user-1',
    reviewedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function exclusion(overrides: Partial<PocExclusion> = {}): PocExclusion {
  return {
    id: 'excl-1',
    organizationId: 'org-1',
    pocBenchmarkId: 'bench-1',
    pocRoleId: 'role-1',
    candidateId: 'cand-1',
    candidateReferenceLabel: null,
    side: 'vendor',
    exclusionType: 'duplicate_across_sides',
    reason: 'Also found by the client.',
    stillCountsTowardSpeed: true,
    reversesExclusionId: null,
    excludedBy: 'user-1',
    excludedAt: '2026-01-02T00:00:00.000Z',
    createdAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  }
}

describe('calculateCandidatesDiscovered', () => {
  it('is pending when no vendor candidates have been discovered yet', () => {
    const result = calculateCandidatesDiscovered({
      side: 'vendor',
      baselines: [],
      candidateProjectEntries: [],
      exclusions: [],
    })
    expect(result.status).toBe('pending')
  })

  it('keeps a duplicate excluded candidate in the count when stillCountsTowardSpeed is true (§14.6)', () => {
    const result = calculateCandidatesDiscovered({
      side: 'vendor',
      baselines: [],
      candidateProjectEntries: [entry({ candidateId: 'cand-1' }), entry({ candidateId: 'cand-2' })],
      exclusions: [exclusion({ candidateId: 'cand-1', stillCountsTowardSpeed: true })],
    })
    expect(result).toMatchObject({ status: 'computed', value: 2, excludedCount: 0 })
  })

  it('drops a candidate excluded with stillCountsTowardSpeed false (out of search boundary)', () => {
    const result = calculateCandidatesDiscovered({
      side: 'vendor',
      baselines: [],
      candidateProjectEntries: [entry({ candidateId: 'cand-1' }), entry({ candidateId: 'cand-2' })],
      exclusions: [
        exclusion({
          candidateId: 'cand-1',
          stillCountsTowardSpeed: false,
          exclusionType: 'out_of_search_boundary',
        }),
      ],
    })
    expect(result).toMatchObject({ status: 'computed', value: 1, excludedCount: 1 })
  })

  it('reads the client baseline verbatim on the client side, ignoring exclusions', () => {
    const result = calculateCandidatesDiscovered({
      side: 'client',
      baselines: [
        {
          id: 'b-1',
          organizationId: 'org-1',
          pocBenchmarkId: 'bench-1',
          pocRoleId: 'role-1',
          pocParticipantId: 'p-1',
          candidatesSourcedCount: 40,
          candidatesReviewedCount: null,
          shortlistCandidateCount: null,
          timeToFirstQualifiedHours: null,
          timeToShortlistHours: null,
          recruiterHoursSpent: null,
          reportedByUserId: null,
          reportedByLabel: 'Dave',
          notes: null,
          correctionOfBaselineId: null,
          createdBy: null,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      candidateProjectEntries: [],
      exclusions: [exclusion({ side: 'client' })],
    })
    expect(result).toMatchObject({ status: 'computed', value: 40 })
  })
})

describe('calculateCandidatesReviewed', () => {
  it('counts only non-pending reviewStatus matches on the vendor side', () => {
    const result = calculateCandidatesReviewed({
      side: 'vendor',
      baselines: [],
      candidateRoleMatches: [
        match({ candidateId: 'cand-1', reviewStatus: 'approved_for_outreach' }),
        match({ candidateId: 'cand-2', reviewStatus: 'pending' }),
      ],
      exclusions: [],
    })
    expect(result).toMatchObject({ status: 'computed', value: 1 })
  })
})

describe('calculateInterviewProgression', () => {
  it('is pending when no manual follow-up has been logged (no interviews table exists)', () => {
    const result = calculateInterviewProgression({ side: 'vendor', dataPoints: [] })
    expect(result.status).toBe('pending')
  })
})

describe('calculateOfferProgression', () => {
  it('is ALWAYS not_available, regardless of side — no offer data source exists in the schema', () => {
    expect(calculateOfferProgression({ side: 'vendor' }).status).toBe('not_available')
    expect(calculateOfferProgression({ side: 'client' }).status).toBe('not_available')
  })

  it('never carries a numeric value', () => {
    const result = calculateOfferProgression({ side: 'vendor' })
    expect('value' in result).toBe(false)
  })
})
