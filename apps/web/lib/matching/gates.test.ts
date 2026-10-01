import { describe, expect, it } from 'vitest'
import type { FrozenRequirement, MatchRequirementAssessment } from '@rqi/types'
import { deriveEligibility, deriveGateState, evaluateMandatoryGates } from './gates'

function requirement(overrides: Partial<FrozenRequirement> = {}): FrozenRequirement {
  return {
    requirementId: 'req-1',
    name: 'Food safety certification',
    type: 'mandatory',
    weight: null,
    ...overrides,
  }
}

function assessment(
  overrides: Partial<MatchRequirementAssessment> = {},
): MatchRequirementAssessment {
  return {
    requirementId: 'req-1',
    requirementType: 'mandatory',
    relevanceScore: 0.9,
    confidence: 0.9,
    gateSuggestion: 'pass',
    explanation: 'Direct statement in resume.',
    evidenceRefs: [
      {
        sourceKind: 'certification',
        sourceId: 'cert-1',
        excerpt: 'ServSafe certified, 2023',
        location: null,
        isDirectStatement: true,
      },
    ],
    riskNotes: [],
    ...overrides,
  }
}

describe('evaluateMandatoryGates', () => {
  it('passes a requirement with direct evidence and an AI pass suggestion', () => {
    const results = evaluateMandatoryGates({
      mandatoryRequirements: [requirement()],
      assessments: [assessment()],
    })
    const result = results[0]!
    expect(result.deterministicResult).toBe('pass')
    expect(result.hasAnyEvidence).toBe(true)
  })

  it('fails a requirement with evidence and an AI fail suggestion', () => {
    const results = evaluateMandatoryGates({
      mandatoryRequirements: [requirement()],
      assessments: [
        assessment({ gateSuggestion: 'fail', explanation: 'Certification expired in 2019.' }),
      ],
    })
    const result = results[0]!
    expect(result.deterministicResult).toBe('fail')
  })

  it('routes a requirement with zero evidence to insufficient_evidence regardless of AI suggestion', () => {
    const results = evaluateMandatoryGates({
      mandatoryRequirements: [requirement()],
      assessments: [assessment({ gateSuggestion: 'pass', evidenceRefs: [] })],
    })
    const result = results[0]!
    expect(result.deterministicResult).toBe('insufficient_evidence')
    expect(result.hasAnyEvidence).toBe(false)
  })

  it('routes to insufficient_evidence when there is no assessment at all for the requirement', () => {
    const results = evaluateMandatoryGates({
      mandatoryRequirements: [requirement()],
      assessments: [],
    })
    const result = results[0]!
    expect(result.deterministicResult).toBe('insufficient_evidence')
  })

  it('routes to insufficient_evidence when evidence exists but the AI itself reported insufficient_evidence', () => {
    const results = evaluateMandatoryGates({
      mandatoryRequirements: [requirement()],
      assessments: [assessment({ gateSuggestion: 'insufficient_evidence' })],
    })
    const result = results[0]!
    expect(result.deterministicResult).toBe('insufficient_evidence')
  })

  it('evaluates every mandatory requirement independently', () => {
    const requirements = [
      requirement({ requirementId: 'req-1' }),
      requirement({ requirementId: 'req-2', name: '25+ multi-unit sites managed' }),
    ]
    const assessments = [
      assessment({ requirementId: 'req-1', gateSuggestion: 'pass' }),
      assessment({
        requirementId: 'req-2',
        gateSuggestion: 'fail',
        explanation: 'Only 10 sites managed.',
      }),
    ]
    const results = evaluateMandatoryGates({ mandatoryRequirements: requirements, assessments })
    expect(results.map((r) => r.deterministicResult)).toEqual(['pass', 'fail'])
  })
})

describe('deriveGateState', () => {
  it('maps pass/fail/insufficient_evidence to passed/failed/unknown', () => {
    expect(deriveGateState('pass')).toBe('passed')
    expect(deriveGateState('fail')).toBe('failed')
    expect(deriveGateState('insufficient_evidence')).toBe('unknown')
  })
})

describe('deriveEligibility', () => {
  it('is eligible when every gate passes', () => {
    expect(deriveEligibility(['pass', 'pass'])).toBe('eligible')
  })

  it('is ineligible when any gate fails, even alongside a pass', () => {
    expect(deriveEligibility(['pass', 'fail'])).toBe('ineligible')
  })

  it('is pending_verification when a gate is unresolved but none failed', () => {
    expect(deriveEligibility(['pass', 'insufficient_evidence'])).toBe('pending_verification')
  })

  it('prioritizes ineligible over pending_verification when both are present', () => {
    expect(deriveEligibility(['fail', 'insufficient_evidence'])).toBe('ineligible')
  })

  it('is vacuously eligible when there are no mandatory requirements', () => {
    expect(deriveEligibility([])).toBe('eligible')
  })
})
