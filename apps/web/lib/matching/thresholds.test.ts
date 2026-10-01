import { describe, expect, it } from 'vitest'
import { classifyByQualityThreshold, resolveQualityThresholds } from './thresholds'

describe('resolveQualityThresholds', () => {
  it('falls back to system defaults when a scorecard has no override', () => {
    const thresholds = resolveQualityThresholds({
      rankedConsiderationThresholdPct: null,
      preferredShortlistThresholdPct: null,
    })
    expect(thresholds.rankedConsiderationThresholdPct).toBe(90)
    expect(thresholds.preferredShortlistThresholdPct).toBe(95)
  })

  it('uses a per-scorecard override when set', () => {
    const thresholds = resolveQualityThresholds({
      rankedConsiderationThresholdPct: 85,
      preferredShortlistThresholdPct: 92,
    })
    expect(thresholds.rankedConsiderationThresholdPct).toBe(85)
    expect(thresholds.preferredShortlistThresholdPct).toBe(92)
  })
})

describe('classifyByQualityThreshold', () => {
  const thresholds = { rankedConsiderationThresholdPct: 90, preferredShortlistThresholdPct: 95 }

  it('classifies a null score (ineligible) as not_eligible, never as 0', () => {
    expect(classifyByQualityThreshold(null, thresholds)).toBe('not_eligible')
  })

  it('classifies at or above the preferred threshold as preferred_shortlist', () => {
    expect(classifyByQualityThreshold(96, thresholds)).toBe('preferred_shortlist')
    expect(classifyByQualityThreshold(95, thresholds)).toBe('preferred_shortlist')
  })

  it('classifies between the two thresholds as ranked_consideration', () => {
    expect(classifyByQualityThreshold(90, thresholds)).toBe('ranked_consideration')
    expect(classifyByQualityThreshold(94.9, thresholds)).toBe('ranked_consideration')
  })

  it('classifies below the ranked threshold as below_threshold', () => {
    expect(classifyByQualityThreshold(89.9, thresholds)).toBe('below_threshold')
  })
})
