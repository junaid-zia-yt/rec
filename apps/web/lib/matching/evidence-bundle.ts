import 'server-only'
import type { CandidateEvidenceBundleItem } from '@/lib/ai/matching-provider'

/**
 * Matching pipeline step 2 + step 5: "Load normalized candidate data" /
 * "Retrieve relevant candidate evidence" — deterministic assembly of every
 * piece of the candidate's already-structured, human-visible record into
 * one bundle the AI semantic-assist call then judges for RELEVANCE per
 * requirement (docs/08-candidate-scoring.md §8.1 Layer C). This function
 * does no relevance filtering itself — narrowing "relevant" evidence out
 * of everything available is exactly the semantic judgment call this
 * codebase's AI safety rules reserve for the AI-assisted layer, not a
 * deterministic pre-filter that could silently drop something that
 * mattered.
 *
 * Only ALREADY-VERIFIED candidate data is included: an `experience`/
 * `education`/`certification`/`skill` row (any `source`, including
 * Build-Phase-6 AI-parsed-then-human-accepted ones — acceptance is what
 * makes them part of the candidate's real record) and a
 * `candidate_extracted_fields` row ONLY when its `verificationStatus` is
 * `verified` or `edited` (never `pending`/`rejected` — an AI-proposed-but-
 * not-yet-reviewed CV field is not yet part of the candidate's record per
 * Build Phase 6 brief §HUMAN CONTROL, so it must never silently feed a
 * later AI call as if it were confirmed fact).
 */
const MAX_BUNDLE_ITEMS = 100
const MAX_ITEM_TEXT_LENGTH = 600

export interface CandidateProfileForEvidence {
  currentTitle: string | null
  currentCompany: string | null
  location: string | null
  summary: string | null
  leadershipScope: string | null
  pnlResponsibility: string | null
  workAuthorization: string | null
  compensationNotes: string | null
  availabilityNotes: string | null
  yearsExperience: number | null
  noticePeriodDays: number | null
  workplacePreference: string | null
}

export interface CandidateExperienceForEvidence {
  id: string
  company: string
  title: string
  location: string | null
  startDate: string | null
  endDate: string | null
  isCurrent: boolean
  description: string | null
}

export interface CandidateEducationForEvidence {
  id: string
  institution: string
  degree: string | null
  fieldOfStudy: string | null
}

export interface CandidateCertificationForEvidence {
  id: string
  name: string
  issuingBody: string | null
  issuedDate: string | null
  expiresDate: string | null
}

export interface CandidateSkillForEvidence {
  id: string
  skillName: string
  proficiency: string | null
  yearsExperience: number | null
}

export interface CandidateExtractedFieldForEvidence {
  id: string
  fieldGroup: string
  fieldKey: string
  verificationStatus: 'pending' | 'verified' | 'rejected' | 'edited'
  sourceExcerpt: string | null
  extractedValue: unknown
  editedValue: unknown
}

function truncate(text: string): string {
  return text.length > MAX_ITEM_TEXT_LENGTH ? `${text.slice(0, MAX_ITEM_TEXT_LENGTH)}…` : text
}

export function buildCandidateEvidenceBundle(params: {
  profile: CandidateProfileForEvidence | null
  experiences: CandidateExperienceForEvidence[]
  education: CandidateEducationForEvidence[]
  certifications: CandidateCertificationForEvidence[]
  skills: CandidateSkillForEvidence[]
  extractedFields: CandidateExtractedFieldForEvidence[]
}): CandidateEvidenceBundleItem[] {
  const items: CandidateEvidenceBundleItem[] = []

  if (params.profile) {
    const p = params.profile
    if (p.currentTitle || p.currentCompany) {
      items.push({
        sourceKind: 'profile',
        sourceId: null,
        text: truncate(
          `Current role: ${p.currentTitle ?? 'unknown title'} at ${p.currentCompany ?? 'unknown company'}${p.location ? `, ${p.location}` : ''}`,
        ),
        isDirectStatement: true,
      })
    }
    if (p.summary)
      items.push({
        sourceKind: 'profile',
        sourceId: null,
        text: truncate(`Summary: ${p.summary}`),
        isDirectStatement: true,
      })
    if (p.leadershipScope)
      items.push({
        sourceKind: 'profile',
        sourceId: null,
        text: truncate(`Leadership scope: ${p.leadershipScope}`),
        isDirectStatement: true,
      })
    if (p.pnlResponsibility)
      items.push({
        sourceKind: 'profile',
        sourceId: null,
        text: truncate(`P&L responsibility: ${p.pnlResponsibility}`),
        isDirectStatement: true,
      })
    if (p.workAuthorization)
      items.push({
        sourceKind: 'profile',
        sourceId: null,
        text: truncate(`Work authorization: ${p.workAuthorization}`),
        isDirectStatement: true,
      })
    if (p.compensationNotes)
      items.push({
        sourceKind: 'profile',
        sourceId: null,
        text: truncate(`Compensation: ${p.compensationNotes}`),
        isDirectStatement: true,
      })
    if (p.availabilityNotes)
      items.push({
        sourceKind: 'profile',
        sourceId: null,
        text: truncate(`Availability: ${p.availabilityNotes}`),
        isDirectStatement: true,
      })
    if (p.noticePeriodDays !== null)
      items.push({
        sourceKind: 'profile',
        sourceId: null,
        text: `Notice period: ${p.noticePeriodDays} days`,
        isDirectStatement: true,
      })
    if (p.workplacePreference)
      items.push({
        sourceKind: 'profile',
        sourceId: null,
        text: `Workplace preference: ${p.workplacePreference}`,
        isDirectStatement: true,
      })
    if (p.yearsExperience !== null)
      items.push({
        sourceKind: 'profile',
        sourceId: null,
        text: `Years of experience: ${p.yearsExperience}`,
        isDirectStatement: true,
      })
  }

  for (const experience of params.experiences) {
    const period = `${experience.startDate ?? 'unknown start'} to ${experience.isCurrent ? 'present' : (experience.endDate ?? 'unknown end')}`
    items.push({
      sourceKind: 'experience',
      sourceId: experience.id,
      text: truncate(
        `${experience.title} at ${experience.company} (${period})${experience.location ? `, ${experience.location}` : ''}. ${experience.description ?? ''}`.trim(),
      ),
      isDirectStatement: true,
    })
  }

  for (const education of params.education) {
    items.push({
      sourceKind: 'education',
      sourceId: education.id,
      text: truncate(
        `${education.degree ?? 'Degree'}${education.fieldOfStudy ? ` in ${education.fieldOfStudy}` : ''} — ${education.institution}`,
      ),
      isDirectStatement: true,
    })
  }

  for (const certification of params.certifications) {
    items.push({
      sourceKind: 'certification',
      sourceId: certification.id,
      text: truncate(
        `${certification.name}${certification.issuingBody ? ` (${certification.issuingBody})` : ''}${certification.issuedDate ? `, issued ${certification.issuedDate}` : ''}${certification.expiresDate ? `, expires ${certification.expiresDate}` : ''}`,
      ),
      isDirectStatement: true,
    })
  }

  for (const skill of params.skills) {
    items.push({
      sourceKind: 'skill',
      sourceId: skill.id,
      text: truncate(
        `Skill: ${skill.skillName}${skill.proficiency ? ` (${skill.proficiency})` : ''}${skill.yearsExperience ? `, ${skill.yearsExperience} years` : ''}`,
      ),
      isDirectStatement: true,
    })
  }

  // Only verified/edited CV-extracted fields are part of the candidate's
  // confirmed record (Build Phase 6 brief §HUMAN CONTROL) — a pending or
  // rejected field is never fed into this bundle.
  for (const field of params.extractedFields) {
    if (field.verificationStatus !== 'verified' && field.verificationStatus !== 'edited') continue
    const value = field.verificationStatus === 'edited' ? field.editedValue : field.extractedValue
    const valueText =
      typeof value === 'object' && value !== null && 'value' in (value as Record<string, unknown>)
        ? String((value as { value: unknown }).value ?? '')
        : JSON.stringify(value)
    items.push({
      sourceKind: 'extracted_field',
      sourceId: field.id,
      text: truncate(
        `${field.fieldGroup}.${field.fieldKey}: ${valueText}${field.sourceExcerpt ? ` (CV excerpt: "${field.sourceExcerpt}")` : ''}`,
      ),
      isDirectStatement: true,
    })
  }

  return items.slice(0, MAX_BUNDLE_ITEMS)
}
