import { describe, expect, it } from 'vitest'
import { validateCandidateMerge } from './merge'

const base = { organizationId: 'org-1', status: 'active' as const }

describe('validateCandidateMerge', () => {
  it('allows merging two distinct active candidates in the same org', () => {
    expect(validateCandidateMerge({ id: 'a', ...base }, { id: 'b', ...base })).toEqual({
      valid: true,
    })
  })

  it('rejects merging a candidate into itself', () => {
    const result = validateCandidateMerge({ id: 'a', ...base }, { id: 'a', ...base })
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/itself/i)
  })

  it('rejects a cross-tenant merge — tenant isolation', () => {
    const result = validateCandidateMerge(
      { id: 'a', organizationId: 'org-1', status: 'active' },
      { id: 'b', organizationId: 'org-2', status: 'active' },
    )
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/organization/i)
  })

  it('rejects merging into a record that is itself already merged', () => {
    const result = validateCandidateMerge(
      { id: 'a', organizationId: 'org-1', status: 'merged' },
      { id: 'b', ...base },
    )
    expect(result.valid).toBe(false)
  })

  it('rejects merging a candidate that has already been merged', () => {
    const result = validateCandidateMerge(
      { id: 'a', ...base },
      { id: 'b', organizationId: 'org-1', status: 'merged' },
    )
    expect(result.valid).toBe(false)
  })
})
