import { describe, expect, it } from 'vitest'
import type { FrozenRequirement, MatchRequirementAssessment } from '@rqi/types'
import { computeDeterministicMatchResult, computeRawWeightedScoreForOverride } from './evaluate'

const REQUIREMENTS: FrozenRequirement[] = [
  {
    requirementId: 'gate-1',
    name: '25+ multi-unit sites managed',
    type: 'mandatory',
    weight: null,
  },
  {
    requirementId: 'gate-2',
    name: 'Valid food-safety certification',
    type: 'mandatory',
    weight: null,
  },
  { requirementId: 'pref-1', name: 'P&L scale', type: 'preferred', weight: 60 },
  { requirementId: 'pref-2', name: 'Domain match', type: 'preferred', weight: 40 },
]

function assessment(overrides: Partial<MatchRequirementAssessment>): MatchRequirementAssessment {
  return {
    requirementId: 'gate-1',
    requirementType: 'mandatory',
    relevanceScore: null,
    confidence: null,
    gateSuggestion: null,
    explanation: '',
    evidenceRefs: [],
    riskNotes: [],
    ...overrides,
  }
}

describe('computeDeterministicMatchResult', () => {
  it('produces a fully eligible, scored result when every gate passes and every criterion has strong evidence', () => {
    const assessments: MatchRequirementAssessment[] = [
      assessment({
        requirementId: 'gate-1',
        gateSuggestion: 'pass',
        evidenceRefs: [
          {
            sourceKind: 'experience',
            sourceId: 'e1',
            excerpt: '42 sites managed',
            location: null,
            isDirectStatement: true,
          },
        ],
      }),
      assessment({
        requirementId: 'gate-2',
        gateSuggestion: 'pass',
        evidenceRefs: [
          {
            sourceKind: 'certification',
            sourceId: 'c1',
            excerpt: 'ServSafe certified',
            location: null,
            isDirectStatement: true,
          },
        ],
      }),
      assessment({
        requirementId: 'pref-1',
        requirementType: 'preferred',
        relevanceScore: 1,
        confidence: 0.9,
        evidenceRefs: [
          {
            sourceKind: 'experience',
            sourceId: 'e1',
            excerpt: '$65M P&L',
            location: null,
            isDirectStatement: true,
          },
        ],
      }),
      assessment({
        requirementId: 'pref-2',
        requirementType: 'preferred',
        relevanceScore: 0.5,
        confidence: 0.9,
        evidenceRefs: [
          {
            sourceKind: 'experience',
            sourceId: 'e2',
            excerpt: 'Retail + c-stores',
            location: null,
            isDirectStatement: true,
          },
        ],
      }),
    ]

    const result = computeDeterministicMatchResult({ requirements: REQUIREMENTS, assessments })

    expect(result.eligibility).toBe('eligible')
    expect(result.gates.every((g) => g.deterministicResult === 'pass')).toBe(true)
    // (1*60 + 0.5*40)/100 * 100 = 80
    expect(result.weighted.overallScore).toBe(80)
    expect(result.weighted.evidenceCoveragePct).toBe(100)
    expect(result.weighted.dataCompletenessPct).toBe(100)
  })

  it('suppresses overall_score entirely when a mandatory gate fails, even if preferred criteria score well', () => {
    const assessments: MatchRequirementAssessment[] = [
      assessment({
        requirementId: 'gate-1',
        gateSuggestion: 'fail',
        evidenceRefs: [
          {
            sourceKind: 'experience',
            sourceId: 'e1',
            excerpt: 'Only 10 sites',
            location: null,
            isDirectStatement: true,
          },
        ],
      }),
      assessment({
        requirementId: 'gate-2',
        gateSuggestion: 'pass',
        evidenceRefs: [
          {
            sourceKind: 'certification',
            sourceId: 'c1',
            excerpt: 'Certified',
            location: null,
            isDirectStatement: true,
          },
        ],
      }),
      assessment({
        requirementId: 'pref-1',
        requirementType: 'preferred',
        relevanceScore: 1,
        confidence: 1,
        evidenceRefs: [
          {
            sourceKind: 'experience',
            sourceId: 'e1',
            excerpt: 'strong',
            location: null,
            isDirectStatement: true,
          },
        ],
      }),
      assessment({
        requirementId: 'pref-2',
        requirementType: 'preferred',
        relevanceScore: 1,
        confidence: 1,
        evidenceRefs: [
          {
            sourceKind: 'experience',
            sourceId: 'e2',
            excerpt: 'strong',
            location: null,
            isDirectStatement: true,
          },
        ],
      }),
    ]

    const result = computeDeterministicMatchResult({ requirements: REQUIREMENTS, assessments })

    expect(result.eligibility).toBe('ineligible')
    expect(result.weighted.overallScore).toBeNull()
    // The underlying arithmetic is still computable for the override flow.
    expect(computeRawWeightedScoreForOverride(result.criteria)).toBe(100)
  })

  it('routes to pending_verification (not ineligible, not eligible) when a gate has no evidence', () => {
    const assessments: MatchRequirementAssessment[] = [
      assessment({ requirementId: 'gate-1', evidenceRefs: [] }),
      assessment({
        requirementId: 'gate-2',
        gateSuggestion: 'pass',
        evidenceRefs: [
          {
            sourceKind: 'certification',
            sourceId: 'c1',
            excerpt: 'Certified',
            location: null,
            isDirectStatement: true,
          },
        ],
      }),
    ]

    const result = computeDeterministicMatchResult({ requirements: REQUIREMENTS, assessments })

    expect(result.eligibility).toBe('pending_verification')
    expect(result.weighted.overallScore).toBeNull()
  })

  it('never contributes fabricated evidence for a conflicting-evidence assessment — score reflects only what the AI actually grounded', () => {
    // Two evidence refs for the same requirement, with the assessment
    // itself reporting lower confidence because of the conflict — the
    // scoring layer applies the discount, it does not try to "resolve" the
    // conflict itself.
    const assessments: MatchRequirementAssessment[] = [
      assessment({
        requirementId: 'gate-1',
        gateSuggestion: 'pass',
        evidenceRefs: [
          {
            sourceKind: 'experience',
            sourceId: 'e1',
            excerpt: '42 sites',
            location: null,
            isDirectStatement: true,
          },
        ],
      }),
      assessment({
        requirementId: 'gate-2',
        gateSuggestion: 'pass',
        evidenceRefs: [
          {
            sourceKind: 'certification',
            sourceId: 'c1',
            excerpt: 'Certified',
            location: null,
            isDirectStatement: true,
          },
        ],
      }),
      assessment({
        requirementId: 'pref-1',
        requirementType: 'preferred',
        relevanceScore: 0.7,
        confidence: 0.4,
        evidenceRefs: [
          {
            sourceKind: 'experience',
            sourceId: 'e1',
            excerpt: '$65M P&L (resume)',
            location: null,
            isDirectStatement: true,
          },
          {
            sourceKind: 'extracted_field',
            sourceId: 'f1',
            excerpt: '$40M P&L (LinkedIn)',
            location: null,
            isDirectStatement: true,
          },
        ],
      }),
      assessment({ requirementId: 'pref-2', requirementType: 'preferred', evidenceRefs: [] }),
    ]

    const result = computeDeterministicMatchResult({ requirements: REQUIREMENTS, assessments })

    const pref1 = result.criteria.find((c) => c.requirementId === 'pref-1')!
    expect(pref1.confidenceDiscount).toBe(0.6) // low confidence (0.4) -> capped, not scored at face value
    expect(pref1.effectiveScore).toBe(0.42)
  })
})
