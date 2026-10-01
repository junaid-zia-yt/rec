import { describe, expect, it } from 'vitest'
import type { PocBaseline, PocMetricDataPoint } from '@rqi/types'
import {
  CAUSATION_DISCLAIMER,
  compareBenchmark,
  compareRoleBenchmark,
  describeComparisonCaveat,
  orderMetricsForDisplay,
  type RoleBenchmarkData,
} from './compare-benchmark'
import { METRIC_KEYS } from './metric-definitions'

function emptyRoleData(overrides: Partial<RoleBenchmarkData> = {}): RoleBenchmarkData {
  return {
    role: { id: 'role-1', roleType: 'standard' },
    clientBaselines: [],
    vendorDataPoints: [],
    clientDataPoints: [],
    exclusions: [],
    candidateRoleMatches: [],
    candidateProjectEntries: [],
    shortlistCandidates: [],
    vendorClientDecisions: [],
    vendorOutreachMessages: [],
    vendorCandidateResponses: [],
    ...overrides,
  }
}

describe('compareRoleBenchmark', () => {
  it('runs all 15 registered metrics for a role', () => {
    const result = compareRoleBenchmark({ benchmark: { startTime: null }, role: emptyRoleData() })
    expect(result.metrics).toHaveLength(15)
    expect(result.metrics.map((m) => m.metricKey).sort()).toEqual([...METRIC_KEYS].sort())
  })

  it('offer_progression is not_available on both sides with a null delta, regardless of loaded data', () => {
    const result = compareRoleBenchmark({
      benchmark: { startTime: '2026-01-01T00:00:00.000Z' },
      role: emptyRoleData(),
    })
    const offerProgression = result.metrics.find((m) => m.metricKey === 'offer_progression')!
    expect(offerProgression.vendor.status).toBe('not_available')
    expect(offerProgression.client.status).toBe('not_available')
    expect(offerProgression.delta).toBeNull()
  })

  it('leaves delta null whenever either side is not computed', () => {
    const result = compareRoleBenchmark({ benchmark: { startTime: null }, role: emptyRoleData() })
    for (const metric of result.metrics) {
      if (metric.vendor.status !== 'computed' || metric.client.status !== 'computed') {
        expect(metric.delta).toBeNull()
      }
    }
  })

  it('computes a numeric delta when both sides resolve to computed (recruiter_hours)', () => {
    const clientBaseline: PocBaseline = {
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
      recruiterHoursSpent: 20,
      reportedByUserId: null,
      reportedByLabel: 'Dave',
      notes: null,
      correctionOfBaselineId: null,
      createdBy: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    }
    const vendorHoursEntry: PocMetricDataPoint = {
      id: 'm-1',
      organizationId: 'org-1',
      pocBenchmarkId: 'bench-1',
      pocRoleId: 'role-1',
      pocParticipantId: 'p-vendor',
      metricDefinitionId: 'def-1',
      metricDefinitionVersion: 1,
      dataPointKey: 'recruiter_hours',
      valueNumeric: 8,
      valueText: null,
      valueJsonb: null,
      unit: 'hours',
      source: 'manual_recruiter_entry',
      supersedesMetricId: null,
      notes: null,
      recordedBy: null,
      recordedAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    }

    const result = compareRoleBenchmark({
      benchmark: { startTime: null },
      role: emptyRoleData({
        clientBaselines: [clientBaseline],
        vendorDataPoints: [vendorHoursEntry],
      }),
    })
    const recruiterHours = result.metrics.find((m) => m.metricKey === 'recruiter_hours')!
    expect(recruiterHours.vendor).toMatchObject({ status: 'computed', value: 8 })
    expect(recruiterHours.client).toMatchObject({ status: 'computed', value: 20 })
    // Vendor spent fewer hours than the client here, so the delta is negative.
    expect(recruiterHours.delta).toBe(-12)
  })
})

describe('compareBenchmark', () => {
  it('runs compareRoleBenchmark once per role and preserves each roleId', () => {
    const results = compareBenchmark({
      benchmark: { startTime: null },
      roles: [
        emptyRoleData({ role: { id: 'role-standard', roleType: 'standard' } }),
        emptyRoleData({ role: { id: 'role-senior', roleType: 'senior_or_difficult' } }),
      ],
    })
    expect(results).toHaveLength(2)
    expect(results.map((r) => r.roleId)).toEqual(['role-standard', 'role-senior'])
    for (const result of results) {
      expect(result.metrics).toHaveLength(15)
    }
  })

  it('returns an empty array for an empty roles list', () => {
    expect(compareBenchmark({ benchmark: { startTime: null }, roles: [] })).toEqual([])
  })
})

describe('CAUSATION_DISCLAIMER / describeComparisonCaveat', () => {
  it('CAUSATION_DISCLAIMER is a non-empty, correlation-not-causation warning', () => {
    expect(CAUSATION_DISCLAIMER.length).toBeGreaterThan(0)
    expect(CAUSATION_DISCLAIMER.toLowerCase()).toContain('not a proven cause')
  })

  it('describeComparisonCaveat embeds the given metric display name', () => {
    const caveat = describeComparisonCaveat('Mandatory-Gate Pass Rate')
    expect(caveat).toContain('Mandatory-Gate Pass Rate')
    expect(caveat.toLowerCase()).toContain('not proof')
  })
})

describe('orderMetricsForDisplay', () => {
  it('puts the three candidate-quality-primary metrics first, in catalog order', () => {
    const shuffled: (typeof METRIC_KEYS)[number][] = [
      'offer_progression',
      'evidence_coverage',
      'candidates_discovered',
      'mandatory_gate_pass_rate',
      'candidate_response_rate',
      'candidates_scoring_90_or_higher',
    ]
    const ordered = orderMetricsForDisplay(shuffled)
    expect(ordered.slice(0, 3)).toEqual([
      'mandatory_gate_pass_rate',
      'candidates_scoring_90_or_higher',
      'evidence_coverage',
    ])
    expect(ordered).toHaveLength(shuffled.length)
  })

  it('preserves catalog order for the non-primary remainder', () => {
    const ordered = orderMetricsForDisplay(['recruiter_hours', 'time_to_first_qualified_candidate'])
    expect(ordered).toEqual(['time_to_first_qualified_candidate', 'recruiter_hours'])
  })
})
