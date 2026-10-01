import { describe, expect, it } from 'vitest'
import type { PocBaseline, PocMetricDataPoint } from '@rqi/types'
import {
  calculateRecruiterHours,
  calculateTimeToCompletedShortlist,
  calculateTimeToFirstQualifiedCandidate,
} from './calculate-speed-metrics'

function baseline(overrides: Partial<PocBaseline> = {}): PocBaseline {
  return {
    id: 'b-1',
    organizationId: 'org-1',
    pocBenchmarkId: 'bench-1',
    pocRoleId: 'role-1',
    pocParticipantId: 'p-client',
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
    id: 'm-1',
    organizationId: 'org-1',
    pocBenchmarkId: 'bench-1',
    pocRoleId: 'role-1',
    pocParticipantId: 'p-vendor',
    metricDefinitionId: 'def-1',
    metricDefinitionVersion: 1,
    dataPointKey: 'time_to_first_qualified_hours',
    valueNumeric: 10,
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

describe('calculateTimeToFirstQualifiedCandidate', () => {
  it('reads the client baseline verbatim, never computing from benchmarkStartTime', () => {
    const result = calculateTimeToFirstQualifiedCandidate({
      side: 'client',
      benchmarkStartTime: null,
      baselines: [baseline({ timeToFirstQualifiedHours: 12.5 })],
      dataPoints: [],
    })
    expect(result).toMatchObject({ status: 'computed', value: 12.5, unit: 'hours' })
  })

  it('is pending on the client side when no baseline has reported the figure', () => {
    const result = calculateTimeToFirstQualifiedCandidate({
      side: 'client',
      benchmarkStartTime: null,
      baselines: [],
      dataPoints: [],
    })
    expect(result.status).toBe('pending')
  })

  it('is pending on the vendor side when the benchmark has no shared start_time yet, even with a data point present', () => {
    const result = calculateTimeToFirstQualifiedCandidate({
      side: 'vendor',
      benchmarkStartTime: null,
      baselines: [],
      dataPoints: [dataPoint()],
    })
    expect(result.status).toBe('pending')
  })

  it('prefers a directly-observed vendor timestamp over the manual data-point fallback', () => {
    const result = calculateTimeToFirstQualifiedCandidate({
      side: 'vendor',
      benchmarkStartTime: '2026-01-01T00:00:00.000Z',
      baselines: [],
      vendorObservedAt: { timestamp: '2026-01-01T05:00:00.000Z', sourceRowId: 'audit-1' },
      dataPoints: [dataPoint({ valueNumeric: 999 })],
    })
    expect(result).toMatchObject({
      status: 'computed',
      value: 5,
      unit: 'hours',
      inputsUsed: ['audit-1'],
    })
  })

  it('falls back to the manual data point when no observed timestamp is supplied', () => {
    const result = calculateTimeToFirstQualifiedCandidate({
      side: 'vendor',
      benchmarkStartTime: '2026-01-01T00:00:00.000Z',
      baselines: [],
      dataPoints: [dataPoint({ id: 'm-2', valueNumeric: 7.25 })],
    })
    expect(result).toMatchObject({ status: 'computed', value: 7.25, inputsUsed: ['m-2'] })
  })

  it('is pending on the vendor side when neither an observed timestamp nor a data point exists', () => {
    const result = calculateTimeToFirstQualifiedCandidate({
      side: 'vendor',
      benchmarkStartTime: '2026-01-01T00:00:00.000Z',
      baselines: [],
      dataPoints: [],
    })
    expect(result.status).toBe('pending')
  })

  it('never returns a negative hours value for an inconsistent (end before start) pair', () => {
    const result = calculateTimeToFirstQualifiedCandidate({
      side: 'vendor',
      benchmarkStartTime: '2026-01-02T00:00:00.000Z',
      baselines: [],
      vendorObservedAt: { timestamp: '2026-01-01T00:00:00.000Z', sourceRowId: 'audit-1' },
      dataPoints: [],
    })
    expect(result).toMatchObject({ status: 'computed', value: 0 })
  })
})

describe('calculateTimeToCompletedShortlist', () => {
  it('reads the client baseline verbatim', () => {
    const result = calculateTimeToCompletedShortlist({
      side: 'client',
      benchmarkStartTime: null,
      baselines: [baseline({ timeToShortlistHours: 40 })],
      dataPoints: [],
    })
    expect(result).toMatchObject({ status: 'computed', value: 40 })
  })

  it('is pending on the vendor side with no benchmark start time', () => {
    const result = calculateTimeToCompletedShortlist({
      side: 'vendor',
      benchmarkStartTime: null,
      baselines: [],
      dataPoints: [],
    })
    expect(result.status).toBe('pending')
  })

  it('prefers a directly-observed shortlist-ready timestamp over the manual fallback', () => {
    const result = calculateTimeToCompletedShortlist({
      side: 'vendor',
      benchmarkStartTime: '2026-01-01T00:00:00.000Z',
      baselines: [],
      vendorShortlistReadyAt: { timestamp: '2026-01-03T00:00:00.000Z', sourceRowId: 'sv-1' },
      dataPoints: [
        dataPoint({ dataPointKey: 'time_to_completed_shortlist_hours', valueNumeric: 999 }),
      ],
    })
    expect(result).toMatchObject({ status: 'computed', value: 48, inputsUsed: ['sv-1'] })
  })

  it('falls back to the manual data point when no observed timestamp is supplied', () => {
    const result = calculateTimeToCompletedShortlist({
      side: 'vendor',
      benchmarkStartTime: '2026-01-01T00:00:00.000Z',
      baselines: [],
      dataPoints: [
        dataPoint({
          id: 'm-3',
          dataPointKey: 'time_to_completed_shortlist_hours',
          valueNumeric: 30,
        }),
      ],
    })
    expect(result).toMatchObject({ status: 'computed', value: 30, inputsUsed: ['m-3'] })
  })
})

describe('calculateRecruiterHours', () => {
  it('reads the client baseline verbatim', () => {
    const result = calculateRecruiterHours({
      side: 'client',
      baselines: [baseline({ recruiterHoursSpent: 15 })],
      dataPoints: [],
    })
    expect(result).toMatchObject({ status: 'computed', value: 15 })
  })

  it('is pending on the client side with no baseline recorded', () => {
    const result = calculateRecruiterHours({ side: 'client', baselines: [], dataPoints: [] })
    expect(result.status).toBe('pending')
  })

  it('sums every LIVE manual-entry vendor row additively, unlike the single-latest-value baseline logic', () => {
    const result = calculateRecruiterHours({
      side: 'vendor',
      baselines: [],
      dataPoints: [
        dataPoint({ id: 'm-1', dataPointKey: 'recruiter_hours', valueNumeric: 3 }),
        dataPoint({ id: 'm-2', dataPointKey: 'recruiter_hours', valueNumeric: 4.5 }),
      ],
    })
    expect(result).toMatchObject({
      status: 'computed',
      value: 7.5,
      inputsUsed: expect.arrayContaining(['m-1', 'm-2']),
    })
  })

  it('drops a superseded (corrected) entry from the sum', () => {
    const result = calculateRecruiterHours({
      side: 'vendor',
      baselines: [],
      dataPoints: [
        dataPoint({ id: 'm-1', dataPointKey: 'recruiter_hours', valueNumeric: 3 }),
        dataPoint({
          id: 'm-2',
          dataPointKey: 'recruiter_hours',
          valueNumeric: 5,
          supersedesMetricId: 'm-1',
        }),
      ],
    })
    expect(result).toMatchObject({ status: 'computed', value: 5, inputsUsed: ['m-2'] })
  })

  it('is pending on the vendor side when no manual log entries exist', () => {
    const result = calculateRecruiterHours({ side: 'vendor', baselines: [], dataPoints: [] })
    expect(result.status).toBe('pending')
  })
})
