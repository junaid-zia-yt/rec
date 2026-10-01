import { describe, expect, it } from 'vitest'
import { nextRequirementStatusAfterEdit } from './edit-rules'

describe('nextRequirementStatusAfterEdit', () => {
  it('marks an AI-proposed, unreviewed requirement as reviewed once a human edits it', () => {
    expect(nextRequirementStatusAfterEdit('proposed')).toBe('reviewed')
  })

  it('keeps an already-reviewed requirement reviewed', () => {
    expect(nextRequirementStatusAfterEdit('reviewed')).toBe('reviewed')
  })

  it('never changes a manually-added requirement to reviewed — there was nothing AI-proposed to review', () => {
    expect(nextRequirementStatusAfterEdit('manually_added')).toBe('manually_added')
  })

  it('human-edit preservation: the transition is status-only — this function has no way to touch ai_generated, by construction (its signature never receives it)', () => {
    // Documents the invariant the type signature already enforces:
    // nextRequirementStatusAfterEdit(status: RequirementSourceStatus) =>
    // RequirementSourceStatus can only ever return a status, never an
    // ai_generated flag, so a human edit can never accidentally launder an
    // AI-authored requirement into looking human-authored (or vice versa).
    const result = nextRequirementStatusAfterEdit('proposed')
    expect(typeof result).toBe('string')
    expect(['reviewed', 'manually_added']).toContain(result)
  })
})
