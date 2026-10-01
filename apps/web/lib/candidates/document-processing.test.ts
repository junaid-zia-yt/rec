import { describe, expect, it } from 'vitest'
import {
  computeProcessingIdempotencyKey,
  mapExtractionOutputToFieldRows,
} from './document-processing'
import type { CandidateExtractionOutput } from '@rqi/types'

function unknown() {
  return {
    value: null,
    hasEvidence: false,
    sourceExcerpt: null,
    sourceLocation: null,
    confidence: null,
  }
}

const BASE_OUTPUT: CandidateExtractionOutput = {
  fullName: {
    value: 'Jordan Ellis Rivera',
    hasEvidence: true,
    sourceExcerpt: 'Jordan Ellis Rivera',
    sourceLocation: 'line 1',
    confidence: 0.95,
  },
  contactDetails: [
    {
      type: 'email',
      value: 'jordan@example.com',
      sourceExcerpt: 'jordan@example.com',
      sourceLocation: 'line 2',
      confidence: 0.95,
    },
  ],
  location: unknown(),
  currentTitle: {
    value: 'Store Manager',
    hasEvidence: true,
    sourceExcerpt: 'Store Manager',
    sourceLocation: 'line 5',
    confidence: 0.9,
  },
  currentCompany: unknown(),
  employmentHistory: [
    {
      company: 'Northfield Retail Group',
      title: 'Store Manager',
      startDate: '2020-03',
      endDate: null,
      isCurrent: true,
      responsibilities: ['Managed a team of 22'],
      sourceExcerpt: 'Store Manager — Northfield Retail Group',
      sourceLocation: 'line 8',
      confidence: 0.88,
    },
  ],
  skills: [
    {
      skillName: 'Team leadership',
      sourceExcerpt: 'Team leadership',
      sourceLocation: 'line 20',
      confidence: 0.8,
    },
  ],
  education: [],
  certifications: [],
  industryExposure: [
    { industry: 'Retail', sourceExcerpt: 'Retail', sourceLocation: 'line 22', confidence: 0.7 },
  ],
  leadershipScope: unknown(),
  pnlResponsibility: unknown(),
  workAuthorization: unknown(),
  compensation: unknown(),
  availability: unknown(),
  unresolvedNotes: [],
}

describe('mapExtractionOutputToFieldRows', () => {
  it('maps every scalar field, including unknown ones, to exactly one row with matching evidence shape', () => {
    const rows = mapExtractionOutputToFieldRows(BASE_OUTPUT)

    const fullName = rows.find((r) => r.fieldGroup === 'profile' && r.fieldKey === 'fullName')
    expect(fullName?.hasEvidence).toBe(true)
    expect(fullName?.extractedValue).toEqual({ value: 'Jordan Ellis Rivera' })
    expect(fullName?.itemIndex).toBeNull()

    const location = rows.find((r) => r.fieldGroup === 'profile' && r.fieldKey === 'location')
    expect(location?.hasEvidence).toBe(false)
    expect(location?.extractedValue).toBeNull()
    expect(location?.sourceExcerpt).toBeNull()
    expect(location?.confidence).toBeNull()
  })

  it('maps each repeated-group array item to its own row with a sequential itemIndex', () => {
    const rows = mapExtractionOutputToFieldRows(BASE_OUTPUT)

    const contact = rows.filter((r) => r.fieldGroup === 'contact')
    expect(contact).toHaveLength(1)
    expect(contact[0]?.itemIndex).toBe(0)
    expect(contact[0]?.extractedValue).toEqual({ type: 'email', value: 'jordan@example.com' })
    expect(contact[0]?.hasEvidence).toBe(true)

    const experience = rows.filter((r) => r.fieldGroup === 'experience')
    expect(experience).toHaveLength(1)
    expect(experience[0]?.extractedValue).toMatchObject({
      company: 'Northfield Retail Group',
      isCurrent: true,
    })
  })

  it('produces no rows at all for an empty repeated group (education/certifications here)', () => {
    const rows = mapExtractionOutputToFieldRows(BASE_OUTPUT)
    expect(rows.filter((r) => r.fieldGroup === 'education')).toHaveLength(0)
    expect(rows.filter((r) => r.fieldGroup === 'certification')).toHaveLength(0)
  })

  it('routes industryExposure under the profile field group (no dedicated group exists in the DB check constraint)', () => {
    const rows = mapExtractionOutputToFieldRows(BASE_OUTPUT)
    const industry = rows.filter(
      (r) => r.fieldGroup === 'profile' && r.fieldKey === 'industryExposure',
    )
    expect(industry).toHaveLength(1)
    expect(industry[0]?.extractedValue).toEqual({ industry: 'Retail' })
  })
})

describe('computeProcessingIdempotencyKey', () => {
  it('combines the document id and attempt number deterministically', () => {
    expect(computeProcessingIdempotencyKey('doc-1', 1)).toBe('doc-1:1')
    expect(computeProcessingIdempotencyKey('doc-1', 2)).toBe('doc-1:2')
  })
})
