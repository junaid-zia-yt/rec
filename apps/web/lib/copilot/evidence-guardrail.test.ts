import { describe, expect, it } from 'vitest'
import type { CopilotCitation } from '@rqi/types'
import {
  copilotResponseMakesEvidenceClaims,
  validateCopilotEvidenceCitations,
  type CopilotClaimWithCitation,
} from './evidence-guardrail'

function authorizedRecord(overrides: Partial<CopilotCitation> = {}): CopilotCitation {
  return {
    kind: 'candidate_extracted_field',
    id: 'field-1',
    excerpt: '5 years retail management experience',
    ...overrides,
  }
}

function claim(overrides: Partial<CopilotClaimWithCitation> = {}): CopilotClaimWithCitation {
  return {
    claimText: 'has 5 years retail management experience',
    citation: authorizedRecord(),
    ...overrides,
  }
}

describe('validateCopilotEvidenceCitations', () => {
  it('is valid with no claims to check', () => {
    expect(
      validateCopilotEvidenceCitations({ claims: [], authorizedRecords: [authorizedRecord()] }),
    ).toEqual({ valid: true })
  })

  it('passes when the citation exists among authorized records and the excerpt matches verbatim', () => {
    const result = validateCopilotEvidenceCitations({
      claims: [claim()],
      authorizedRecords: [authorizedRecord()],
    })
    expect(result.valid).toBe(true)
  })

  it('passes when the citation has no excerpt at all (a whole-record reference)', () => {
    const result = validateCopilotEvidenceCitations({
      claims: [claim({ citation: authorizedRecord({ excerpt: null }) })],
      authorizedRecords: [authorizedRecord({ excerpt: null })],
    })
    expect(result.valid).toBe(true)
  })

  it("rejects a citation whose (kind, id) does not exist among this turn's authorized records (fabricated id)", () => {
    const result = validateCopilotEvidenceCitations({
      claims: [claim({ citation: authorizedRecord({ id: 'field-does-not-exist' }) })],
      authorizedRecords: [authorizedRecord()],
    })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.issues[0]).toMatch(/not among this turn's authorized records/)
  })

  it('rejects a citation whose (kind, id) exists but whose excerpt is not verbatim in the authorized record (fabricated/paraphrased excerpt)', () => {
    const result = validateCopilotEvidenceCitations({
      claims: [
        claim({
          citation: authorizedRecord({ excerpt: 'a completely different, invented sentence' }),
        }),
      ],
      authorizedRecords: [authorizedRecord()],
    })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.issues[0]).toMatch(/not found verbatim/)
  })

  it('rejects a citation into a DIFFERENT record kind sharing the same id (kind matters, not just id)', () => {
    const result = validateCopilotEvidenceCitations({
      claims: [claim({ citation: authorizedRecord({ kind: 'human_review', id: 'field-1' }) })],
      authorizedRecords: [authorizedRecord({ kind: 'candidate_extracted_field', id: 'field-1' })],
    })
    expect(result.valid).toBe(false)
  })

  it('reports every failing claim, not just the first', () => {
    const result = validateCopilotEvidenceCitations({
      claims: [
        claim({ citation: authorizedRecord({ id: 'missing-1' }) }),
        claim({ citation: authorizedRecord({ id: 'missing-2' }) }),
      ],
      authorizedRecords: [authorizedRecord()],
    })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.issues).toHaveLength(2)
  })
})

describe('copilotResponseMakesEvidenceClaims', () => {
  it('is false for an empty claim list and true otherwise', () => {
    expect(copilotResponseMakesEvidenceClaims([])).toBe(false)
    expect(copilotResponseMakesEvidenceClaims([claim()])).toBe(true)
  })
})
