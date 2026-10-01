import { describe, expect, it } from 'vitest'
import { validateRequirementWeights } from './validate-weights'

describe('validateRequirementWeights', () => {
  it('is valid when preferred weights total exactly 100', () => {
    const result = validateRequirementWeights([
      { id: 'r1', type: 'preferred', weight: 60 },
      { id: 'r2', type: 'preferred', weight: 40 },
    ])
    expect(result.valid).toBe(true)
    expect(result.preferredWeightTotal).toBe(100)
  })

  it('is valid with mandatory + disqualifying + informational + requires_clarification requirements carrying no weight', () => {
    const result = validateRequirementWeights([
      { id: 'r1', type: 'mandatory', weight: null },
      { id: 'r2', type: 'disqualifying', weight: null },
      { id: 'r3', type: 'informational', weight: null },
      { id: 'r4', type: 'requires_clarification', weight: null },
    ])
    expect(result.valid).toBe(true)
    expect(result.preferredWeightTotal).toBeNull()
  })

  it('rejects a mandatory requirement carrying a weight', () => {
    const result = validateRequirementWeights([{ id: 'r1', type: 'mandatory', weight: 50 }])
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toMatch(/must not carry a weight/)
  })

  it('rejects a disqualifying requirement carrying a weight', () => {
    const result = validateRequirementWeights([{ id: 'r1', type: 'disqualifying', weight: 10 }])
    expect(result.valid).toBe(false)
  })

  it('rejects a preferred requirement with no weight', () => {
    const result = validateRequirementWeights([{ id: 'r1', type: 'preferred', weight: null }])
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toMatch(/must have a weight/)
  })

  it('rejects preferred weights that sum to less than 100', () => {
    const result = validateRequirementWeights([
      { id: 'r1', type: 'preferred', weight: 60 },
      { id: 'r2', type: 'preferred', weight: 30 },
    ])
    expect(result.valid).toBe(false)
    expect(result.preferredWeightTotal).toBe(90)
    expect(result.errors[0]).toMatch(/must total 100%/)
  })

  it('rejects preferred weights that sum to more than 100', () => {
    const result = validateRequirementWeights([
      { id: 'r1', type: 'preferred', weight: 70 },
      { id: 'r2', type: 'preferred', weight: 50 },
    ])
    expect(result.valid).toBe(false)
    expect(result.preferredWeightTotal).toBe(120)
  })

  it('tolerates a floating-point rounding total within 0.01 of 100', () => {
    const result = validateRequirementWeights([
      { id: 'r1', type: 'preferred', weight: 33.33 },
      { id: 'r2', type: 'preferred', weight: 33.33 },
      { id: 'r3', type: 'preferred', weight: 33.34 },
    ])
    expect(result.valid).toBe(true)
  })

  it('is valid when there are zero preferred requirements at all (nothing to total)', () => {
    const result = validateRequirementWeights([{ id: 'r1', type: 'mandatory', weight: null }])
    expect(result.valid).toBe(true)
    expect(result.preferredWeightTotal).toBeNull()
  })

  it('rejects an out-of-range preferred weight', () => {
    const result = validateRequirementWeights([{ id: 'r1', type: 'preferred', weight: 150 }])
    expect(result.valid).toBe(false)
  })

  it('collects multiple independent errors in one pass', () => {
    const result = validateRequirementWeights([
      { id: 'r1', type: 'mandatory', weight: 10 },
      { id: 'r2', type: 'preferred', weight: null },
    ])
    expect(result.errors.length).toBeGreaterThanOrEqual(2)
  })
})
