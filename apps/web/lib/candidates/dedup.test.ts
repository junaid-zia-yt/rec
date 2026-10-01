import { describe, expect, it } from 'vitest'
import {
  normalizeEmail,
  normalizePhone,
  findDuplicateSuggestions,
  type DedupCandidateInput,
} from './dedup'

function candidate(overrides: Partial<DedupCandidateInput> & { id: string }): DedupCandidateInput {
  return {
    fullName: 'Test Candidate',
    normalizedEmail: null,
    normalizedPhone: null,
    currentCompany: null,
    location: null,
    documentChecksums: [],
    ...overrides,
  }
}

describe('normalizeEmail / normalizePhone', () => {
  it('lowercases and trims email', () => {
    expect(normalizeEmail('  Jane.Doe@Example.com ')).toBe('jane.doe@example.com')
  })

  it('returns null for an empty/whitespace email', () => {
    expect(normalizeEmail('   ')).toBeNull()
    expect(normalizeEmail(null)).toBeNull()
  })

  it('strips everything but digits from phone', () => {
    expect(normalizePhone('+1 (555) 123-4567')).toBe('15551234567')
  })

  it('returns null for a phone with no digits', () => {
    expect(normalizePhone('n/a')).toBeNull()
  })
})

describe('findDuplicateSuggestions', () => {
  it('flags an exact normalized-email match at score 1', () => {
    const target = candidate({ id: 'new', normalizedEmail: 'jane@acme.com' })
    const existing = [candidate({ id: 'existing', normalizedEmail: 'jane@acme.com' })]
    const suggestions = findDuplicateSuggestions(target, existing)
    expect(suggestions).toEqual([
      { candidateId: 'new', matchedCandidateId: 'existing', basis: 'exact_email', score: 1 },
    ])
  })

  it('flags an exact normalized-phone match at score 1', () => {
    const target = candidate({ id: 'new', normalizedPhone: '15551234567' })
    const existing = [candidate({ id: 'existing', normalizedPhone: '15551234567' })]
    const suggestions = findDuplicateSuggestions(target, existing)
    expect(suggestions[0]?.basis).toBe('exact_phone')
    expect(suggestions[0]?.score).toBe(1)
  })

  it('flags a shared document checksum at score 1', () => {
    const target = candidate({ id: 'new', documentChecksums: ['abc123'] })
    const existing = [candidate({ id: 'existing', documentChecksums: ['abc123', 'other'] })]
    const suggestions = findDuplicateSuggestions(target, existing)
    expect(suggestions[0]?.basis).toBe('document_checksum')
  })

  it('flags a fuzzy name+company+location match above the configured threshold', () => {
    const target = candidate({
      id: 'new',
      fullName: 'Jane Marie Doe',
      currentCompany: 'Acme Retail Group',
      location: 'Austin, TX',
    })
    const existing = [
      candidate({
        id: 'existing',
        fullName: 'Jane Doe',
        currentCompany: 'Acme Retail Group',
        location: 'Austin, TX',
      }),
    ]
    const suggestions = findDuplicateSuggestions(target, existing)
    expect(suggestions[0]?.basis).toBe('fuzzy')
    expect(suggestions[0]?.score).toBeGreaterThan(0)
    expect(suggestions[0]?.score).toBeLessThan(1)
  })

  it('does not suggest a fuzzy match below the configured threshold', () => {
    const target = candidate({
      id: 'new',
      fullName: 'Alex Chen',
      currentCompany: 'Foo Inc',
      location: 'Denver',
    })
    const existing = [
      candidate({
        id: 'existing',
        fullName: 'Jordan Smith',
        currentCompany: 'Bar LLC',
        location: 'Miami',
      }),
    ]
    expect(findDuplicateSuggestions(target, existing)).toEqual([])
  })

  it('never suggests a candidate against itself', () => {
    const self = candidate({ id: 'same', normalizedEmail: 'x@y.com' })
    expect(findDuplicateSuggestions(self, [self])).toEqual([])
  })

  it('exact bases are reported even when the fuzzy threshold would not otherwise be met', () => {
    const target = candidate({ id: 'new', fullName: 'Zzz Qqq', normalizedEmail: 'shared@x.com' })
    const existing = [
      candidate({
        id: 'existing',
        fullName: 'Totally Different Name',
        normalizedEmail: 'shared@x.com',
      }),
    ]
    const suggestions = findDuplicateSuggestions(target, existing)
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]?.basis).toBe('exact_email')
  })

  it('sorts suggestions most-confident first', () => {
    const target = candidate({
      id: 'new',
      fullName: 'Sam Rivera',
      currentCompany: 'Acme',
      location: 'NYC',
    })
    const existing = [
      candidate({ id: 'fuzzy-low', fullName: 'Sam R', currentCompany: 'Acme', location: '' }),
      candidate({ id: 'exact', normalizedEmail: 'shared@x.com' }),
    ]
    const targetWithEmail = { ...target, normalizedEmail: 'shared@x.com' }
    const suggestions = findDuplicateSuggestions(targetWithEmail, existing)
    expect(suggestions[0]?.matchedCandidateId).toBe('exact')
  })
})
