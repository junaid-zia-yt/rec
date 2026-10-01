import { describe, expect, it } from 'vitest'
import type {
  CandidateRoleMatch,
  PocExclusion,
  PocMetricDataPoint,
  ShortlistCandidate,
} from '@rqi/types'
import {
  calculateCandidatesScoring90OrHigher,
  calculateCriticalErrors,
  calculateEvidenceCoverage,
  calculateMandatoryGatePassRate,
  calculateUnsupportedClaims,
} from './calculate-quality-metrics'

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
    // Deliberately true here — this file's tests assert that quality
    // metrics drop the candidate anyway, unlike the progression metrics.
    stillCountsTowardSpeed: true,
    reversesExclusionId: null,
    excludedBy: 'user-1',
    excludedAt: '2026-01-02T00:00:00.000Z',
    createdAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  }
}

function dataPoint(overrides: Partial<PocMetricDataPoint> = {}): PocMetricDataPoint {
  return {
    id: 'metric-1',
    organizationId: 'org-1',
    pocBenchmarkId: 'bench-1',
    pocRoleId: 'role-1',
    pocParticipantId: 'participant-1',
    metricDefinitionId: 'def-1',
    metricDefinitionVersion: 1,
    dataPointKey: 'critical_errors_count',
    valueNumeric: 1,
    valueText: null,
    valueJsonb: null,
    unit: 'count',
    source: 'manual_recruiter_entry',
    supersedesMetricId: null,
    notes: null,
    recordedBy: null,
    recordedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('calculateMandatoryGatePassRate', () => {
  it('computes passed/reviewed on the vendor side', () => {
    const result = calculateMandatoryGatePassRate({
      side: 'vendor',
      candidateRoleMatches: [
        match({
          candidateId: 'cand-1',
          eligibility: 'eligible',
          reviewStatus: 'approved_for_outreach',
        }),
        match({ candidateId: 'cand-2', eligibility: 'ineligible', reviewStatus: 'rejected' }),
        match({ candidateId: 'cand-3', eligibility: 'eligible', reviewStatus: 'pending' }), // not reviewed yet
      ],
      exclusions: [],
      clientReportedDataPoints: [],
    })
    expect(result).toMatchObject({ status: 'computed', value: 50 })
  })

  it('drops an excluded candidate from BOTH numerator and denominator, even when stillCountsTowardSpeed is true (quality-differentiation comparison)', () => {
    const result = calculateMandatoryGatePassRate({
      side: 'vendor',
      candidateRoleMatches: [
        match({ candidateId: 'cand-1', eligibility: 'eligible' }),
        match({ candidateId: 'cand-2', eligibility: 'eligible' }),
      ],
      exclusions: [exclusion({ candidateId: 'cand-1', stillCountsTowardSpeed: true })],
      clientReportedDataPoints: [],
    })
    expect(result).toMatchObject({ status: 'computed', value: 100, excludedCount: 1 })
  })

  it('is not_available on the client side with no manual data point', () => {
    const result = calculateMandatoryGatePassRate({
      side: 'client',
      candidateRoleMatches: [],
      exclusions: [],
      clientReportedDataPoints: [],
    })
    expect(result.status).toBe('not_available')
  })
})

describe('calculateCandidatesScoring90OrHigher', () => {
  it('counts only eligible candidates scoring >= 90 on the vendor side', () => {
    const result = calculateCandidatesScoring90OrHigher({
      side: 'vendor',
      candidateRoleMatches: [
        match({ candidateId: 'cand-1', eligibility: 'eligible', overallScore: 95 }),
        match({ candidateId: 'cand-2', eligibility: 'eligible', overallScore: 80 }),
        match({ candidateId: 'cand-3', eligibility: 'ineligible', overallScore: null }),
      ],
      exclusions: [],
      clientReportedDataPoints: [],
    })
    expect(result).toMatchObject({ status: 'computed', value: 1 })
  })

  it('is not_available on the client side absent Dave-reported data', () => {
    const result = calculateCandidatesScoring90OrHigher({
      side: 'client',
      candidateRoleMatches: [],
      exclusions: [],
      clientReportedDataPoints: [],
    })
    expect(result.status).toBe('not_available')
  })
})

describe('calculateEvidenceCoverage', () => {
  const shortlistCandidate = (candidateRoleMatchId: string): ShortlistCandidate => ({
    id: `sc-${candidateRoleMatchId}`,
    organizationId: 'org-1',
    shortlistVersionId: 'sv-1',
    candidateRoleMatchId,
    candidateId: 'cand-1',
    matchingRunId: 'run-1',
    scorecardVersionId: 'scv-1',
    rank: 1,
    recruiterNote: null,
    addedBy: null,
    addedAt: '2026-01-01T00:00:00.000Z',
  })

  it('averages evidenceCoveragePct across shortlisted candidates on the vendor side', () => {
    const m1 = match({ candidateId: 'cand-1', evidenceCoveragePct: 100 })
    const m2 = match({ candidateId: 'cand-2', evidenceCoveragePct: 80 })
    const result = calculateEvidenceCoverage({
      side: 'vendor',
      candidateRoleMatches: [m1, m2],
      shortlistCandidates: [shortlistCandidate(m1.id), shortlistCandidate(m2.id)],
      exclusions: [],
    })
    expect(result).toMatchObject({ status: 'computed', value: 90 })
  })

  it('is ALWAYS not_available on the client side, with no manual-entry escape hatch', () => {
    const result = calculateEvidenceCoverage({
      side: 'client',
      candidateRoleMatches: [],
      shortlistCandidates: [],
      exclusions: [],
    })
    expect(result.status).toBe('not_available')
  })
})

describe('calculateCriticalErrors / calculateUnsupportedClaims', () => {
  it('sums live (non-superseded) logged entries', () => {
    const result = calculateCriticalErrors({
      side: 'vendor',
      dataPoints: [
        dataPoint({ id: 'm-1', valueNumeric: 1 }),
        dataPoint({ id: 'm-2', valueNumeric: 2 }),
      ],
    })
    expect(result).toMatchObject({ status: 'computed', value: 3 })
  })

  it('is pending (not a fabricated zero) when nothing has been logged', () => {
    expect(calculateCriticalErrors({ side: 'vendor', dataPoints: [] }).status).toBe('pending')
    expect(calculateUnsupportedClaims({ side: 'vendor', dataPoints: [] }).status).toBe('pending')
  })
})
