import { describe, expect, it } from 'vitest'
import type {
  FrozenRequirement,
  MatchRequirementAssessment,
  ScoringCriterionComputation,
} from '@rqi/types'
import {
  computeAggregateConfidence,
  computeConfidenceDiscount,
  computeDataCompletenessPct,
  computeEvidenceCoveragePct,
  computeWeightedScore,
  flagTiedCandidates,
  scorePreferredRequirements,
} from './scoring'

function requirement(overrides: Partial<FrozenRequirement> = {}): FrozenRequirement {
  return { requirementId: 'req-1', name: 'P&L scale', type: 'preferred', weight: 30, ...overrides }
}

function assessment(
  overrides: Partial<MatchRequirementAssessment> = {},
): MatchRequirementAssessment {
  return {
    requirementId: 'req-1',
    requirementType: 'preferred',
    relevanceScore: 0.98,
    confidence: 0.95,
    gateSuggestion: null,
    explanation: '$65M P&L managed vs target.',
    evidenceRefs: [
      {
        sourceKind: 'experience',
        sourceId: 'exp-1',
        excerpt: 'Managed $65M annual P&L across 42 units',
        location: null,
        isDirectStatement: true,
      },
    ],
    riskNotes: [],
    ...overrides,
  }
}

describe('computeConfidenceDiscount', () => {
  it('applies no discount for high-confidence direct evidence', () => {
    expect(computeConfidenceDiscount(0.9, true)).toBe(1)
  })

  it('discounts low-confidence evidence', () => {
    expect(computeConfidenceDiscount(0.3, true)).toBe(0.6)
  })

  it('discounts inferred (non-direct) evidence even at high confidence', () => {
    expect(computeConfidenceDiscount(0.9, false)).toBe(0.6)
  })

  it('discounts a null confidence — never treated as full trust', () => {
    expect(computeConfidenceDiscount(null, true)).toBe(0.6)
  })
})

describe('scorePreferredRequirements', () => {
  it('scores a requirement with direct, high-confidence evidence at face value', () => {
    const [result] = scorePreferredRequirements({
      preferredRequirements: [requirement()],
      assessments: [assessment()],
    }) as [ScoringCriterionComputation]
    expect(result.rawScore).toBe(0.98)
    expect(result.confidenceDiscount).toBe(1)
    expect(result.effectiveScore).toBe(0.98)
    expect(result.weightedContribution).toBe(29.4)
    expect(result.hasEvidence).toBe(true)
  })

  it('contributes exactly 0 for a requirement with no evidence — never imputed', () => {
    const [result] = scorePreferredRequirements({
      preferredRequirements: [requirement()],
      assessments: [assessment({ evidenceRefs: [], relevanceScore: null })],
    }) as [ScoringCriterionComputation]
    expect(result.rawScore).toBeNull()
    expect(result.weightedContribution).toBe(0)
    expect(result.hasEvidence).toBe(false)
  })

  it('contributes exactly 0 when the requirement has no assessment at all', () => {
    const [result] = scorePreferredRequirements({
      preferredRequirements: [requirement()],
      assessments: [],
    }) as [ScoringCriterionComputation]
    expect(result.weightedContribution).toBe(0)
    expect(result.hasEvidence).toBe(false)
  })

  it('caps a low-confidence match rather than scoring it at face value', () => {
    const [result] = scorePreferredRequirements({
      preferredRequirements: [requirement({ weight: 20 })],
      assessments: [assessment({ confidence: 0.3, relevanceScore: 1 })],
    }) as [ScoringCriterionComputation]
    expect(result.confidenceDiscount).toBe(0.6)
    expect(result.effectiveScore).toBe(0.6)
    expect(result.weightedContribution).toBe(12)
  })
})

describe('computeWeightedScore', () => {
  it("matches docs/08-candidate-scoring.md §8.12's worked example (~95%)", () => {
    const criteria: ScoringCriterionComputation[] = [
      {
        requirementId: 'pnl',
        requirementName: 'P&L scale',
        weight: 30,
        rawScore: 0.98,
        confidenceDiscount: 1,
        effectiveScore: 0.98,
        weightedContribution: 29.4,
        hasEvidence: true,
      },
      {
        requirementId: 'tenure',
        requirementName: 'Tenure',
        weight: 20,
        rawScore: 0.9,
        confidenceDiscount: 1,
        effectiveScore: 0.9,
        weightedContribution: 18,
        hasEvidence: true,
      },
      {
        requirementId: 'commute',
        requirementName: 'Commute',
        weight: 10,
        rawScore: 0.95,
        confidenceDiscount: 1,
        effectiveScore: 0.95,
        weightedContribution: 9.5,
        hasEvidence: true,
      },
      {
        requirementId: 'comp',
        requirementName: 'Comp fit',
        weight: 20,
        rawScore: 1,
        confidenceDiscount: 1,
        effectiveScore: 1,
        weightedContribution: 20,
        hasEvidence: true,
      },
      {
        requirementId: 'domain',
        requirementName: 'Domain match',
        weight: 20,
        rawScore: 0.9,
        confidenceDiscount: 1,
        effectiveScore: 0.9,
        weightedContribution: 18,
        hasEvidence: true,
      },
    ]
    expect(computeWeightedScore(criteria)).toBe(94.9)
  })

  it('returns null when total weight is zero rather than dividing by zero', () => {
    expect(computeWeightedScore([])).toBeNull()
  })

  it('rounds to 2 decimal places', () => {
    const criteria: ScoringCriterionComputation[] = [
      {
        requirementId: 'a',
        requirementName: 'A',
        weight: 33,
        rawScore: 1,
        confidenceDiscount: 1,
        effectiveScore: 1,
        weightedContribution: 33,
        hasEvidence: true,
      },
      {
        requirementId: 'b',
        requirementName: 'B',
        weight: 33,
        rawScore: 1,
        confidenceDiscount: 1,
        effectiveScore: 1,
        weightedContribution: 33,
        hasEvidence: true,
      },
      {
        requirementId: 'c',
        requirementName: 'C',
        weight: 34,
        rawScore: 0,
        confidenceDiscount: 1,
        effectiveScore: 0,
        weightedContribution: 0,
        hasEvidence: true,
      },
    ]
    // (33+33+0)/100 * 100 = 66.00, exact — pick a case exercising rounding.
    const uneven: ScoringCriterionComputation[] = [
      {
        requirementId: 'a',
        requirementName: 'A',
        weight: 33,
        rawScore: 1,
        confidenceDiscount: 1,
        effectiveScore: 1,
        weightedContribution: 33,
        hasEvidence: true,
      },
      {
        requirementId: 'b',
        requirementName: 'B',
        weight: 33,
        rawScore: 0.5,
        confidenceDiscount: 1,
        effectiveScore: 0.5,
        weightedContribution: 16.5,
        hasEvidence: true,
      },
      {
        requirementId: 'c',
        requirementName: 'C',
        weight: 34,
        rawScore: 0.333,
        confidenceDiscount: 1,
        effectiveScore: 0.333,
        weightedContribution: 11.322,
        hasEvidence: true,
      },
    ]
    expect(computeWeightedScore(criteria)).toBe(66)
    expect(computeWeightedScore(uneven)).toBe(60.82)
  })
})

describe('computeEvidenceCoveragePct / computeDataCompletenessPct', () => {
  it('computes evidence coverage as a percentage of scored criteria with evidence', () => {
    expect(
      computeEvidenceCoveragePct([
        { hasEvidence: true },
        { hasEvidence: true },
        { hasEvidence: false },
        { hasEvidence: false },
      ]),
    ).toBe(50)
  })

  it('is 0 for an empty criteria list, never NaN', () => {
    expect(computeEvidenceCoveragePct([])).toBe(0)
  })

  it('computes completeness across mandatory and preferred fields together', () => {
    const pct = computeDataCompletenessPct({
      mandatoryHasEvidence: [true, false],
      preferredHasEvidence: [true, true, false],
    })
    // 3 of 5 fields have data
    expect(pct).toBe(60)
  })
})

describe('computeAggregateConfidence', () => {
  it('averages only the non-null confidence values', () => {
    expect(computeAggregateConfidence([0.9, null, 0.7])).toBe(0.8)
  })

  it('is null when nothing reported a confidence', () => {
    expect(computeAggregateConfidence([null, null])).toBeNull()
  })
})

describe('flagTiedCandidates', () => {
  it('flags two eligible candidates within epsilon of each other', () => {
    const tied = flagTiedCandidates(
      [
        { candidateId: 'a', overallScore: 91 },
        { candidateId: 'b', overallScore: 90 },
        { candidateId: 'c', overallScore: 60 },
      ],
      1.5,
    )
    expect(tied.has('a')).toBe(true)
    expect(tied.has('b')).toBe(true)
    expect(tied.has('c')).toBe(false)
  })

  it('never flags an ineligible (null-score) candidate', () => {
    const tied = flagTiedCandidates([
      { candidateId: 'a', overallScore: 91 },
      { candidateId: 'b', overallScore: null },
    ])
    expect(tied.size).toBe(0)
  })
})
