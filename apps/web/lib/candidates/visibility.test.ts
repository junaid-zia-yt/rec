import { describe, expect, it } from 'vitest'
import type { CandidateProfile } from '@rqi/types'
import {
  canViewUnmaskedContact,
  maskContactValue,
  contactValueForRole,
  serializeCandidateProfileForRole,
} from './visibility'

describe('canViewUnmaskedContact', () => {
  it('allows agency_admin and recruiter unmasked contact', () => {
    expect(canViewUnmaskedContact('agency_admin')).toBe(true)
    expect(canViewUnmaskedContact('recruiter')).toBe(true)
  })

  it('masks contact for read_only_reviewer and client_decision_maker', () => {
    expect(canViewUnmaskedContact('read_only_reviewer')).toBe(false)
    expect(canViewUnmaskedContact('client_decision_maker')).toBe(false)
  })
})

describe('maskContactValue', () => {
  it('masks an email keeping only the first local-part character and the domain', () => {
    expect(maskContactValue('email', 'jane.doe@example.com')).toBe('j*******@example.com')
  })

  it('masks a phone keeping only the last 4 digits', () => {
    expect(maskContactValue('phone', '+1 (555) 123-4567')).toBe('*******4567')
  })

  it('masks a linkedin/other value keeping only a short 4-character prefix', () => {
    const input = 'linkedin.com/in/janedoe'
    const masked = maskContactValue('linkedin', input)
    expect(masked.startsWith('link')).toBe(true)
    expect(masked).toHaveLength(input.length)
    expect(masked.slice(4)).toBe('*'.repeat(input.length - 4))
  })

  it('never returns the original unmasked value', () => {
    const original = 'secret@candidate.com'
    expect(maskContactValue('email', original)).not.toBe(original)
  })
})

describe('contactValueForRole', () => {
  it('returns the raw value for an authorized role', () => {
    expect(contactValueForRole('recruiter', 'email', 'jane@x.com')).toBe('jane@x.com')
  })

  it('returns a masked value for an unauthorized role', () => {
    expect(contactValueForRole('client_decision_maker', 'email', 'jane@x.com')).not.toBe(
      'jane@x.com',
    )
  })
})

const fullProfile: CandidateProfile = {
  id: 'p1',
  candidateId: 'c1',
  currentTitle: 'Assistant Manager',
  currentCompany: 'Acme',
  summary: null,
  location: null,
  workAuthorization: null,
  compensationMin: null,
  compensationMax: null,
  compensationCurrency: 'USD',
  compensationPeriod: null,
  availabilityDate: null,
  availabilityNotes: null,
  noticePeriodDays: null,
  workplacePreference: null,
  yearsExperience: null,
  recruiterNotes: 'Internal: flaky references, verify with prior manager.',
  clientVisibleNotes: 'Strong retail background.',
}

describe('serializeCandidateProfileForRole', () => {
  it('includes recruiterNotes for agency_admin/recruiter/read_only_reviewer', () => {
    expect(serializeCandidateProfileForRole(fullProfile, 'agency_admin')).toHaveProperty(
      'recruiterNotes',
    )
    expect(serializeCandidateProfileForRole(fullProfile, 'recruiter')).toHaveProperty(
      'recruiterNotes',
    )
    expect(serializeCandidateProfileForRole(fullProfile, 'read_only_reviewer')).toHaveProperty(
      'recruiterNotes',
    )
  })

  it('omits recruiterNotes entirely for client_decision_maker — never nulls it', () => {
    const result = serializeCandidateProfileForRole(fullProfile, 'client_decision_maker')
    expect('recruiterNotes' in result).toBe(false)
  })

  it('keeps clientVisibleNotes for the client-safe projection', () => {
    const result = serializeCandidateProfileForRole(fullProfile, 'client_decision_maker')
    expect(result.clientVisibleNotes).toBe('Strong retail background.')
  })
})
