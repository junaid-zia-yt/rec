import { describe, expect, it } from 'vitest'
import type { FrozenRequirement } from '@rqi/types'
import { TestMatchingAIProvider } from '@/lib/ai/matching-test-adapter'
import { runMatchingPipeline } from './matching-pipeline'

const REQUIREMENTS: FrozenRequirement[] = [
  {
    requirementId: 'gate-1',
    name: 'Valid food-safety certification',
    type: 'mandatory',
    weight: null,
  },
  { requirementId: 'pref-1', name: 'P&L scale', type: 'preferred', weight: 100 },
]

describe('runMatchingPipeline', () => {
  it('reports failed with ai_not_configured and no deterministic result when no provider is available', async () => {
    const result = await runMatchingPipeline({
      jobTitle: 'Regional Manager',
      requirements: REQUIREMENTS,
      candidateEvidence: [],
    })
    expect(result.status).toBe('failed')
    expect(result.errorKind).toBe('ai_not_configured')
    expect(result.deterministic).toBeNull()
  })

  it('produces a completed, fully-computed deterministic result on a successful AI assessment', async () => {
    const result = await runMatchingPipeline({
      jobTitle: 'Regional Manager',
      requirements: REQUIREMENTS,
      candidateEvidence: [
        {
          sourceKind: 'certification',
          sourceId: 'c1',
          text: 'Valid food-safety certification, ServSafe',
          isDirectStatement: true,
        },
        {
          sourceKind: 'experience',
          sourceId: 'e1',
          text: 'P&L scale: $65M managed across 42 units',
          isDirectStatement: true,
        },
      ],
      aiProvider: new TestMatchingAIProvider(),
    })
    expect(result.status).toBe('completed')
    expect(result.deterministic?.eligibility).toBe('eligible')
    expect(result.deterministic?.weighted.overallScore).toBe(90)
  })

  it('reports failed with validation_failed on twice-invalid AI output', async () => {
    const result = await runMatchingPipeline({
      jobTitle: 'Regional Manager',
      requirements: REQUIREMENTS,
      candidateEvidence: [],
      aiProvider: new TestMatchingAIProvider({ mode: 'invalid_output' }),
    })
    expect(result.status).toBe('failed')
    expect(result.errorKind).toBe('validation_failed')
  })

  it('reports failed with timeout distinctly from provider_error', async () => {
    const timeout = await runMatchingPipeline({
      jobTitle: 'Regional Manager',
      requirements: REQUIREMENTS,
      candidateEvidence: [],
      aiProvider: new TestMatchingAIProvider({ mode: 'timeout' }),
    })
    expect(timeout.errorKind).toBe('timeout')

    const providerError = await runMatchingPipeline({
      jobTitle: 'Regional Manager',
      requirements: REQUIREMENTS,
      candidateEvidence: [],
      aiProvider: new TestMatchingAIProvider({ mode: 'provider_error' }),
    })
    expect(providerError.errorKind).toBe('provider_error')
  })

  it('never scores an ineligible candidate — gate failure suppresses overall_score end to end', async () => {
    const result = await runMatchingPipeline({
      jobTitle: 'Regional Manager',
      requirements: REQUIREMENTS,
      candidateEvidence: [
        {
          sourceKind: 'certification',
          sourceId: 'c1',
          text: 'FAIL: valid food-safety certification expired in 2019',
          isDirectStatement: true,
        },
        {
          sourceKind: 'experience',
          sourceId: 'e1',
          text: 'P&L scale: $65M managed',
          isDirectStatement: true,
        },
      ],
      aiProvider: new TestMatchingAIProvider(),
    })
    expect(result.deterministic?.eligibility).toBe('ineligible')
    expect(result.deterministic?.weighted.overallScore).toBeNull()
  })
})
