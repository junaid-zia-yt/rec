import { describe, expect, it } from 'vitest'
import type { PocBaseline, PocExclusion, PocMetricDataPoint } from '@rqi/types'
import {
  exclusionCandidateKey,
  partitionExclusionsBySpeedCounting,
  resolveActiveExclusions,
  resolveLatestBaseline,
  resolveLatestDataPoint,
} from './resolve-inputs'

function baseline(overrides: Partial<PocBaseline> = {}): PocBaseline {
  return {
    id: 'baseline-1',
    organizationId: 'org-1',
    pocBenchmarkId: 'bench-1',
    pocRoleId: 'role-1',
    pocParticipantId: 'participant-1',
    candidatesSourcedCount: null,
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
    dataPointKey: 'recruiter_hours',
    valueNumeric: 3,
    valueText: null,
    valueJsonb: null,
    unit: 'hours',
    source: 'manual_recruiter_entry',
    supersedesMetricId: null,
    notes: null,
    recordedBy: null,
    recordedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
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
    side: 'both',
    exclusionType: 'duplicate_across_sides',
    reason: 'Found by both sides independently.',
    stillCountsTowardSpeed: true,
    reversesExclusionId: null,
    excludedBy: 'user-1',
    excludedAt: '2026-01-02T00:00:00.000Z',
    createdAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  }
}

describe('resolveLatestBaseline', () => {
  it('returns null when no baselines exist', () => {
    expect(resolveLatestBaseline([])).toBeNull()
  })

  it('returns the only baseline when there is exactly one', () => {
    const b = baseline()
    expect(resolveLatestBaseline([b])).toEqual(b)
  })

  it('excludes a row superseded by a correction and returns the correction', () => {
    const original = baseline({
      id: 'b-1',
      candidatesSourcedCount: 10,
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    const correction = baseline({
      id: 'b-2',
      candidatesSourcedCount: 12,
      correctionOfBaselineId: 'b-1',
      createdAt: '2026-01-02T00:00:00.000Z',
    })
    expect(resolveLatestBaseline([original, correction])).toEqual(correction)
  })

  it('falls back to most-recent-by-createdAt among multiple independent (non-chained) rows', () => {
    const first = baseline({ id: 'b-1', createdAt: '2026-01-01T00:00:00.000Z' })
    const second = baseline({ id: 'b-2', createdAt: '2026-01-03T00:00:00.000Z' })
    expect(resolveLatestBaseline([first, second])).toEqual(second)
  })
})

describe('resolveLatestDataPoint', () => {
  it('returns null when no row matches the key', () => {
    expect(
      resolveLatestDataPoint([dataPoint({ dataPointKey: 'other_key' })], 'recruiter_hours'),
    ).toBeNull()
  })

  it('excludes a row superseded by another row that points back at it', () => {
    const original = dataPoint({
      id: 'm-1',
      valueNumeric: 3,
      recordedAt: '2026-01-01T00:00:00.000Z',
    })
    const correction = dataPoint({
      id: 'm-2',
      valueNumeric: 5,
      supersedesMetricId: 'm-1',
      recordedAt: '2026-01-02T00:00:00.000Z',
    })
    expect(resolveLatestDataPoint([original, correction], 'recruiter_hours')).toEqual(correction)
  })

  it('ignores rows for a different dataPointKey entirely', () => {
    const wrongKey = dataPoint({
      id: 'm-1',
      dataPointKey: 'critical_errors_count',
      valueNumeric: 1,
    })
    const rightKey = dataPoint({ id: 'm-2', dataPointKey: 'recruiter_hours', valueNumeric: 4 })
    expect(resolveLatestDataPoint([wrongKey, rightKey], 'recruiter_hours')).toEqual(rightKey)
  })
})

describe('resolveActiveExclusions / partitionExclusionsBySpeedCounting', () => {
  it('drops an exclusion that has been reversed by another row', () => {
    const original = exclusion({ id: 'e-1', candidateId: 'cand-1' })
    const reversal = exclusion({ id: 'e-2', candidateId: 'cand-1', reversesExclusionId: 'e-1' })
    expect(resolveActiveExclusions([original, reversal])).toEqual([])
  })

  it('keeps an exclusion that has not been reversed', () => {
    const original = exclusion({ id: 'e-1' })
    expect(resolveActiveExclusions([original])).toEqual([original])
  })

  it('partitions active exclusions by stillCountsTowardSpeed', () => {
    const dup = exclusion({ id: 'e-1', candidateId: 'cand-1', stillCountsTowardSpeed: true })
    const outOfBounds = exclusion({
      id: 'e-2',
      candidateId: 'cand-2',
      stillCountsTowardSpeed: false,
    })
    const { excludedFromQualityOnly, excludedFromEverything } = partitionExclusionsBySpeedCounting([
      dup,
      outOfBounds,
    ])
    expect(excludedFromQualityOnly).toEqual([dup])
    expect(excludedFromEverything).toEqual([outOfBounds])
  })
})

describe('exclusionCandidateKey', () => {
  it('prefers candidateId when present', () => {
    expect(
      exclusionCandidateKey({ candidateId: 'cand-1', candidateReferenceLabel: 'Jane Doe' }),
    ).toBe('cand-1')
  })

  it('falls back to the reference label when candidateId is null', () => {
    expect(exclusionCandidateKey({ candidateId: null, candidateReferenceLabel: 'Jane Doe' })).toBe(
      'label:Jane Doe',
    )
  })
})
