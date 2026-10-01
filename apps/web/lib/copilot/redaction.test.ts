import { describe, expect, it } from 'vitest'
import {
  excludesRecruiterOnlySources,
  redactCandidateProfile,
  redactCandidateMatchDetail,
  redactForClassification,
  redactShortlistCandidate,
  redactShortlistCandidates,
} from './redaction'

describe('redactForClassification', () => {
  it('returns the record unchanged for standard classification', () => {
    const record = { a: 1, b: 2 }
    expect(redactForClassification(record, ['a'], 'standard')).toEqual({ a: 1, b: 2 })
  })

  it('strips the listed fields entirely (not nulled) for restricted_notes_excluded', () => {
    const record = { a: 1, b: 2 }
    const result = redactForClassification(record, ['a'], 'restricted_notes_excluded')
    expect(result).toEqual({ b: 2 })
    expect('a' in result).toBe(false)
  })
})

describe('redactCandidateProfile', () => {
  it('keeps recruiterNotes for a standard conversation', () => {
    const profile = { recruiterNotes: 'flight risk', currentTitle: 'Store Manager' }
    const result = redactCandidateProfile(profile, 'standard')
    expect(result.recruiterNotes).toBe('flight risk')
  })

  it('strips recruiterNotes entirely for a restricted_notes_excluded (client) conversation', () => {
    const profile = { recruiterNotes: 'flight risk', currentTitle: 'Store Manager' }
    const result = redactCandidateProfile(profile, 'restricted_notes_excluded')
    expect('recruiterNotes' in result).toBe(false)
    expect(result.currentTitle).toBe('Store Manager')
  })
})

describe('redactShortlistCandidate(s)', () => {
  it('strips recruiterNote for a restricted conversation, keeps every other field', () => {
    const candidate = { candidateId: 'c1', recruiterNote: 'internal risk note', rank: 1 }
    const result = redactShortlistCandidate(candidate, 'restricted_notes_excluded')
    expect('recruiterNote' in result).toBe(false)
    expect(result.candidateId).toBe('c1')
    expect(result.rank).toBe(1)
  })

  it('redacts every element of an array', () => {
    const candidates = [
      { candidateId: 'c1', recruiterNote: 'note 1' },
      { candidateId: 'c2', recruiterNote: 'note 2' },
    ]
    const result = redactShortlistCandidates(candidates, 'restricted_notes_excluded')
    expect(result.every((c) => !('recruiterNote' in c))).toBe(true)
  })
})

describe('redactCandidateMatchDetail', () => {
  it('strips reviewerNote and humanReviewReason for a restricted conversation', () => {
    const detail = {
      reviewerNote: 'internal',
      humanReviewReason: 'gate override',
      eligibility: 'eligible',
    }
    const result = redactCandidateMatchDetail(detail, 'restricted_notes_excluded')
    expect('reviewerNote' in result).toBe(false)
    expect('humanReviewReason' in result).toBe(false)
    expect(result.eligibility).toBe('eligible')
  })
})

describe('excludesRecruiterOnlySources', () => {
  it('is true only for restricted_notes_excluded', () => {
    expect(excludesRecruiterOnlySources('restricted_notes_excluded')).toBe(true)
    expect(excludesRecruiterOnlySources('standard')).toBe(false)
  })
})
