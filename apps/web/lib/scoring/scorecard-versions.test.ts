import { describe, expect, it } from 'vitest'
import {
  buildRequirementSnapshot,
  canApproveScorecardVersion,
  nextVersionNumber,
  requiresNewDraftVersion,
} from './scorecard-versions'

describe('buildRequirementSnapshot', () => {
  it('captures id, type, and weight only — never any other field', () => {
    const snapshot = buildRequirementSnapshot([{ id: 'r1', type: 'preferred', weight: 100 }])
    expect(snapshot).toEqual([{ requirementId: 'r1', type: 'preferred', weight: 100 }])
  })
})

describe('nextVersionNumber', () => {
  it('starts at 1 for a scorecard with no versions yet', () => {
    expect(nextVersionNumber([])).toBe(1)
  })

  it('increments past the highest existing version number', () => {
    expect(nextVersionNumber([1, 2, 3])).toBe(4)
  })

  it('is not fooled by out-of-order input', () => {
    expect(nextVersionNumber([3, 1, 2])).toBe(4)
  })
})

describe('requiresNewDraftVersion', () => {
  it('is false for a draft version (may edit in place)', () => {
    expect(requiresNewDraftVersion('draft')).toBe(false)
  })

  it('is false for a pending_approval version (may still edit in place before decision)', () => {
    expect(requiresNewDraftVersion('pending_approval')).toBe(false)
  })

  it('is true once a version has ever been active — editing always creates a new draft', () => {
    expect(requiresNewDraftVersion('active')).toBe(true)
  })

  it('is true for a superseded version', () => {
    expect(requiresNewDraftVersion('superseded')).toBe(true)
  })
})

describe('canApproveScorecardVersion', () => {
  it('allows approval of a pending_approval version with valid weights', () => {
    const result = canApproveScorecardVersion({
      versionStatus: 'pending_approval',
      requirements: [
        { id: 'r1', type: 'mandatory', weight: null },
        { id: 'r2', type: 'preferred', weight: 100 },
      ],
    })
    expect(result.canApprove).toBe(true)
    expect(result.reasons).toHaveLength(0)
  })

  it('refuses approval of an already-active version', () => {
    const result = canApproveScorecardVersion({
      versionStatus: 'active',
      requirements: [{ id: 'r1', type: 'mandatory', weight: null }],
    })
    expect(result.canApprove).toBe(false)
    expect(result.reasons[0]).toMatch(/already active/)
  })

  it('refuses approval of a superseded version', () => {
    const result = canApproveScorecardVersion({
      versionStatus: 'superseded',
      requirements: [{ id: 'r1', type: 'mandatory', weight: null }],
    })
    expect(result.canApprove).toBe(false)
  })

  it('refuses approval of a version with zero requirements', () => {
    const result = canApproveScorecardVersion({
      versionStatus: 'pending_approval',
      requirements: [],
    })
    expect(result.canApprove).toBe(false)
    expect(result.reasons[0]).toMatch(/at least one requirement/)
  })

  it('refuses approval — the core Build Phase 4 rule — when preferred weights do not total 100%', () => {
    const result = canApproveScorecardVersion({
      versionStatus: 'pending_approval',
      requirements: [
        { id: 'r1', type: 'preferred', weight: 40 },
        { id: 'r2', type: 'preferred', weight: 40 },
      ],
    })
    expect(result.canApprove).toBe(false)
    expect(result.reasons.some((reason) => reason.includes('100%'))).toBe(true)
  })

  it('refuses approval when a mandatory requirement carries a weight', () => {
    const result = canApproveScorecardVersion({
      versionStatus: 'draft',
      requirements: [{ id: 'r1', type: 'mandatory', weight: 20 }],
    })
    expect(result.canApprove).toBe(false)
  })

  it('collects every independent reason at once, not just the first', () => {
    const result = canApproveScorecardVersion({ versionStatus: 'active', requirements: [] })
    expect(result.reasons.length).toBeGreaterThanOrEqual(2)
  })
})
