import { describe, expect, it } from 'vitest'
import {
  CANDIDATE_QUALITY_PRIMARY_METRIC_KEYS,
  METRIC_KEYS,
  METRIC_REGISTRY,
} from './metric-definitions'
import { orderMetricsForDisplay } from './compare-benchmark'

/**
 * Registry-completeness checks. supabase/migrations/0030_poc_benchmarks.sql
 * seeds exactly 15 metric_definitions rows (version 1) — this file asserts
 * the TypeScript mirror stays in lockstep, since a drift here would mean a
 * calculator silently has no registry entry (or vice versa) without any
 * runtime error surfacing it until a report tries to render the gap.
 */

const EXPECTED_METRIC_KEYS = [
  'time_to_first_qualified_candidate',
  'time_to_completed_shortlist',
  'candidates_discovered',
  'candidates_reviewed',
  'mandatory_gate_pass_rate',
  'candidates_scoring_90_or_higher',
  'evidence_coverage',
  'shortlist_acceptance_rate',
  'candidate_response_rate',
  'candidate_interest_rate',
  'interview_progression',
  'offer_progression',
  'recruiter_hours',
  'critical_errors',
  'unsupported_claims',
] as const

describe('METRIC_KEYS / METRIC_REGISTRY completeness', () => {
  it('has exactly the 15 metric keys the migration seeds, in this exact set', () => {
    expect(METRIC_KEYS).toHaveLength(15)
    expect([...METRIC_KEYS].sort()).toEqual([...EXPECTED_METRIC_KEYS].sort())
  })

  it('has a registry entry for every METRIC_KEYS entry, and no extras', () => {
    const registryKeys = Object.keys(METRIC_REGISTRY).sort()
    expect(registryKeys).toEqual([...METRIC_KEYS].sort())
  })

  it("every registry entry's metricKey field matches its own object key", () => {
    for (const key of METRIC_KEYS) {
      expect(METRIC_REGISTRY[key].metricKey).toBe(key)
    }
  })

  it('every registry entry is at version 1 (no metric has been revised since this wave)', () => {
    for (const key of METRIC_KEYS) {
      expect(METRIC_REGISTRY[key].version).toBe(1)
    }
  })

  it('every registry entry declares a non-empty displayName, unit and category', () => {
    for (const key of METRIC_KEYS) {
      const entry = METRIC_REGISTRY[key]
      expect(entry.displayName.length).toBeGreaterThan(0)
      expect(entry.unit).toBeTruthy()
      expect(entry.category).toBeTruthy()
    }
  })

  it('offer_progression and the two raw discovery/review counts are the only metrics with a null (no intrinsic direction) higherIsBetter', () => {
    const nullDirection = METRIC_KEYS.filter((key) => METRIC_REGISTRY[key].higherIsBetter === null)
    expect(nullDirection.sort()).toEqual(
      ['candidates_discovered', 'candidates_reviewed', 'offer_progression'].sort(),
    )
  })
})

describe('CANDIDATE_QUALITY_PRIMARY_METRIC_KEYS', () => {
  it('contains exactly the three brief-designated candidate-quality-primary metrics', () => {
    expect([...CANDIDATE_QUALITY_PRIMARY_METRIC_KEYS].sort()).toEqual(
      ['mandatory_gate_pass_rate', 'candidates_scoring_90_or_higher', 'evidence_coverage'].sort(),
    )
  })

  it('every member is itself a valid METRIC_KEYS entry', () => {
    for (const key of CANDIDATE_QUALITY_PRIMARY_METRIC_KEYS) {
      expect(METRIC_KEYS).toContain(key)
    }
  })
})

describe('orderMetricsForDisplay — full-catalog ordering', () => {
  it('over the complete 15-key catalog, puts all three primary metrics first (in catalog order) followed by the remaining 12 in catalog order', () => {
    const ordered = orderMetricsForDisplay([...METRIC_KEYS])
    expect(ordered).toHaveLength(15)
    expect(ordered.slice(0, 3)).toEqual([
      'mandatory_gate_pass_rate',
      'candidates_scoring_90_or_higher',
      'evidence_coverage',
    ])
    expect(ordered.slice(3)).toEqual(
      METRIC_KEYS.filter((key) => !CANDIDATE_QUALITY_PRIMARY_METRIC_KEYS.has(key)),
    )
  })

  it('drops an unknown key not present in METRIC_KEYS rather than reordering it in unpredictably', () => {
    // @ts-expect-error — deliberately passing an invalid key to assert runtime behavior for a caller that skipped validation.
    const ordered = orderMetricsForDisplay(['not_a_real_metric_key'])
    expect(ordered).toEqual([])
  })

  it('is a no-op ordering-wise on an empty input', () => {
    expect(orderMetricsForDisplay([])).toEqual([])
  })
})
