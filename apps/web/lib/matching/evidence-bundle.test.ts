import { describe, expect, it } from 'vitest'
import { buildCandidateEvidenceBundle } from './evidence-bundle'

const BASE = {
  profile: null,
  experiences: [],
  education: [],
  certifications: [],
  skills: [],
  extractedFields: [],
}

describe('buildCandidateEvidenceBundle', () => {
  it('includes experience, education, certification and skill rows', () => {
    const bundle = buildCandidateEvidenceBundle({
      ...BASE,
      experiences: [
        {
          id: 'e1',
          company: 'Acme',
          title: 'Manager',
          location: null,
          startDate: '2020-01-01',
          endDate: null,
          isCurrent: true,
          description: 'Managed 42 sites',
        },
      ],
      education: [{ id: 'ed1', institution: 'State U', degree: 'BA', fieldOfStudy: 'Business' }],
      certifications: [
        {
          id: 'c1',
          name: 'ServSafe',
          issuingBody: null,
          issuedDate: '2023-01-01',
          expiresDate: null,
        },
      ],
      skills: [
        { id: 's1', skillName: 'Inventory management', proficiency: 'expert', yearsExperience: 5 },
      ],
    })
    expect(bundle).toHaveLength(4)
    expect(bundle.find((i) => i.sourceKind === 'experience')?.text).toContain('Managed 42 sites')
    expect(bundle.every((i) => i.isDirectStatement)).toBe(true)
  })

  it('includes a verified extracted field', () => {
    const bundle = buildCandidateEvidenceBundle({
      ...BASE,
      extractedFields: [
        {
          id: 'f1',
          fieldGroup: 'profile',
          fieldKey: 'leadershipScope',
          verificationStatus: 'verified',
          sourceExcerpt: 'Led a team of 12',
          extractedValue: { value: 'Led a team of 12 across 3 regions' },
          editedValue: null,
        },
      ],
    })
    expect(bundle).toHaveLength(1)
    expect(bundle[0]!.text).toContain('Led a team of 12 across 3 regions')
  })

  it('excludes a pending extracted field — never fed to the AI as confirmed fact', () => {
    const bundle = buildCandidateEvidenceBundle({
      ...BASE,
      extractedFields: [
        {
          id: 'f1',
          fieldGroup: 'profile',
          fieldKey: 'leadershipScope',
          verificationStatus: 'pending',
          sourceExcerpt: null,
          extractedValue: { value: 'Unverified claim' },
          editedValue: null,
        },
      ],
    })
    expect(bundle).toHaveLength(0)
  })

  it('excludes a rejected extracted field', () => {
    const bundle = buildCandidateEvidenceBundle({
      ...BASE,
      extractedFields: [
        {
          id: 'f1',
          fieldGroup: 'profile',
          fieldKey: 'compensation',
          verificationStatus: 'rejected',
          sourceExcerpt: null,
          extractedValue: { value: '$1M' },
          editedValue: null,
        },
      ],
    })
    expect(bundle).toHaveLength(0)
  })

  it('prefers the human-edited value over the AI-extracted one for an edited field', () => {
    const bundle = buildCandidateEvidenceBundle({
      ...BASE,
      extractedFields: [
        {
          id: 'f1',
          fieldGroup: 'profile',
          fieldKey: 'currentTitle',
          verificationStatus: 'edited',
          sourceExcerpt: null,
          extractedValue: { value: 'Assistant Manager' },
          editedValue: { value: 'Regional Manager' },
        },
      ],
    })
    expect(bundle[0]!.text).toContain('Regional Manager')
    expect(bundle[0]!.text).not.toContain('Assistant Manager')
  })

  it('includes profile scalar fields only when present', () => {
    const bundle = buildCandidateEvidenceBundle({
      ...BASE,
      profile: {
        currentTitle: 'Ops Manager',
        currentCompany: 'RetailCo',
        location: 'Columbus, OH',
        summary: null,
        leadershipScope: null,
        pnlResponsibility: null,
        workAuthorization: null,
        compensationNotes: null,
        availabilityNotes: null,
        yearsExperience: null,
        noticePeriodDays: null,
        workplacePreference: null,
      },
    })
    expect(bundle).toHaveLength(1)
    expect(bundle[0]!.text).toContain('Ops Manager')
  })

  it('caps the bundle at a bounded size', () => {
    const manySkills = Array.from({ length: 150 }, (_, i) => ({
      id: `s${i}`,
      skillName: `Skill ${i}`,
      proficiency: null,
      yearsExperience: null,
    }))
    const bundle = buildCandidateEvidenceBundle({ ...BASE, skills: manySkills })
    expect(bundle.length).toBeLessThanOrEqual(100)
  })
})
