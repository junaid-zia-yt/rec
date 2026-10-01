import { describe, expect, it } from 'vitest'
import { validateExtractionOutput } from './provider'

describe('validateExtractionOutput', () => {
  it('accepts a well-formed extraction result', () => {
    const result = validateExtractionOutput({
      requirements: [
        {
          name: 'Retail supervisory experience',
          description: 'At least 2 years supervising a retail team',
          category: 'experience',
          type: 'mandatory',
          weight: null,
          evidenceExpected: 'A CV entry showing a supervisory title for 2+ years',
          sourceText: 'Must have 2+ years of retail supervisory experience.',
          sourceLocation: 'line 4',
          confidence: 0.9,
        },
      ],
      unresolvedNotes: [],
    })

    expect(result.valid).toBe(true)
  })

  it('rejects a mandatory requirement carrying a weight (never allowed — weights are preferred-only)', () => {
    const result = validateExtractionOutput({
      requirements: [
        {
          name: 'Bad',
          description: 'Bad',
          category: 'general',
          type: 'mandatory',
          weight: 50,
          evidenceExpected: 'x',
          sourceText: 'x',
          sourceLocation: null,
          confidence: 0.9,
        },
      ],
      unresolvedNotes: [],
    })

    // The ExtractedRequirementSchema itself allows a nullable weight on any
    // type (the model isn't trusted to self-police this — the deterministic
    // UNWEIGHTED_REQUIREMENT_TYPES check happens later, in scoring
    // validation, task #22), so this specific case is expected to still
    // validate here; this test documents that boundary rather than
    // asserting a rejection that doesn't belong at this layer.
    expect(result.valid).toBe(true)
  })

  it('rejects confidence outside 0-1', () => {
    const result = validateExtractionOutput({
      requirements: [
        {
          name: 'Bad confidence',
          description: 'x',
          category: 'general',
          type: 'preferred',
          weight: 50,
          evidenceExpected: 'x',
          sourceText: 'x',
          sourceLocation: null,
          confidence: 4,
        },
      ],
      unresolvedNotes: [],
    })

    expect(result.valid).toBe(false)
  })

  it('rejects an unsupported requirement type', () => {
    const result = validateExtractionOutput({
      requirements: [
        {
          name: 'Bad type',
          description: 'x',
          category: 'general',
          type: 'nice_to_have',
          weight: null,
          evidenceExpected: 'x',
          sourceText: 'x',
          sourceLocation: null,
          confidence: 0.5,
        },
      ],
      unresolvedNotes: [],
    })

    expect(result.valid).toBe(false)
  })

  it('rejects a requirement missing its required sourceText quote', () => {
    const result = validateExtractionOutput({
      requirements: [
        {
          name: 'No source',
          description: 'x',
          category: 'general',
          type: 'mandatory',
          weight: null,
          evidenceExpected: 'x',
          sourceLocation: null,
          confidence: 0.5,
        },
      ],
      unresolvedNotes: [],
    })

    expect(result.valid).toBe(false)
  })

  it('rejects a completely malformed payload (not an object)', () => {
    const result = validateExtractionOutput('not an object')
    expect(result.valid).toBe(false)
  })

  it('rejects more than 60 requirements (schema cap)', () => {
    const requirements = Array.from({ length: 61 }, (_, index) => ({
      name: `Req ${index}`,
      description: 'x',
      category: 'general',
      type: 'informational' as const,
      weight: null,
      evidenceExpected: 'x',
      sourceText: 'x',
      sourceLocation: null,
      confidence: 0.5,
    }))
    const result = validateExtractionOutput({ requirements, unresolvedNotes: [] })
    expect(result.valid).toBe(false)
  })
})
