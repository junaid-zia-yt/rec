import 'server-only'
import type { CandidateExtractionOutput, ExtractedFieldGroup } from '@rqi/types'

/**
 * Pure mapping from one validated AI extraction output
 * (CandidateExtractionOutputSchema) to the flat list of
 * `candidate_extracted_fields` rows a processing job proposes (Build Phase
 * 6 brief §AI PIPELINE step 8: "Store evidence references for extracted
 * facts"). Kept as a pure, database-free function so the mapping itself
 * is unit-testable without Supabase — the server action
 * (document-processing-actions.ts) only adds the constant
 * organization_id/candidate_id/processing_job_id/source_document_id
 * columns and performs the insert.
 *
 * A scalar field (fullName, location, ...) becomes exactly one row, whose
 * `has_evidence`/`extracted_value`/`source_excerpt`/`confidence` mirror the
 * field's own evidence-wrapped shape 1:1 — including the "unknown" case
 * (hasEvidence: false), which the DB's own
 * candidate_extracted_fields_unknown_shape CHECK constraint independently
 * re-enforces (defense in depth: this mapping can never accidentally
 * smuggle a value through with has_evidence=false, because the same
 * false/null pairing the Zod schema already validated is what gets
 * written).
 *
 * A repeated group (contactDetails, employmentHistory, skills, education,
 * certifications, industryExposure) becomes one row per array item, each
 * carrying its own excerpt/location/confidence; `has_evidence` is always
 * true for these, because the model only ever includes an item in the
 * array when it found supporting text — an empty array (not an item with
 * has_evidence=false) is how "found nothing in this group" is represented.
 */
export interface ExtractedFieldInsertRow {
  fieldGroup: ExtractedFieldGroup
  fieldKey: string
  itemIndex: number | null
  extractedValue: unknown
  hasEvidence: boolean
  sourceLocation: string | null
  sourceExcerpt: string | null
  confidence: number | null
}

function scalarRow(
  fieldGroup: ExtractedFieldGroup,
  fieldKey: string,
  field: {
    value: unknown
    hasEvidence: boolean
    sourceExcerpt: string | null
    sourceLocation: string | null
    confidence: number | null
  },
): ExtractedFieldInsertRow {
  return {
    fieldGroup,
    fieldKey,
    itemIndex: null,
    extractedValue: field.hasEvidence ? { value: field.value } : null,
    hasEvidence: field.hasEvidence,
    sourceLocation: field.sourceLocation,
    sourceExcerpt: field.sourceExcerpt,
    confidence: field.confidence,
  }
}

export function mapExtractionOutputToFieldRows(
  output: CandidateExtractionOutput,
): ExtractedFieldInsertRow[] {
  const rows: ExtractedFieldInsertRow[] = [
    scalarRow('profile', 'fullName', output.fullName),
    scalarRow('profile', 'location', output.location),
    scalarRow('profile', 'currentTitle', output.currentTitle),
    scalarRow('profile', 'currentCompany', output.currentCompany),
    scalarRow('profile', 'leadershipScope', output.leadershipScope),
    scalarRow('profile', 'pnlResponsibility', output.pnlResponsibility),
    scalarRow('profile', 'workAuthorization', output.workAuthorization),
    scalarRow('profile', 'compensation', output.compensation),
    scalarRow('profile', 'availability', output.availability),
  ]

  output.contactDetails.forEach((item, itemIndex) => {
    rows.push({
      fieldGroup: 'contact',
      fieldKey: 'contactDetail',
      itemIndex,
      extractedValue: { type: item.type, value: item.value },
      hasEvidence: true,
      sourceLocation: item.sourceLocation,
      sourceExcerpt: item.sourceExcerpt,
      confidence: item.confidence,
    })
  })

  output.employmentHistory.forEach((item, itemIndex) => {
    rows.push({
      fieldGroup: 'experience',
      fieldKey: 'employmentHistory',
      itemIndex,
      extractedValue: {
        company: item.company,
        title: item.title,
        startDate: item.startDate,
        endDate: item.endDate,
        isCurrent: item.isCurrent,
        responsibilities: item.responsibilities,
      },
      hasEvidence: true,
      sourceLocation: item.sourceLocation,
      sourceExcerpt: item.sourceExcerpt,
      confidence: item.confidence,
    })
  })

  output.skills.forEach((item, itemIndex) => {
    rows.push({
      fieldGroup: 'skill',
      fieldKey: 'skill',
      itemIndex,
      extractedValue: { skillName: item.skillName },
      hasEvidence: true,
      sourceLocation: item.sourceLocation,
      sourceExcerpt: item.sourceExcerpt,
      confidence: item.confidence,
    })
  })

  output.education.forEach((item, itemIndex) => {
    rows.push({
      fieldGroup: 'education',
      fieldKey: 'education',
      itemIndex,
      extractedValue: {
        institution: item.institution,
        degree: item.degree,
        fieldOfStudy: item.fieldOfStudy,
        startDate: item.startDate,
        endDate: item.endDate,
      },
      hasEvidence: true,
      sourceLocation: item.sourceLocation,
      sourceExcerpt: item.sourceExcerpt,
      confidence: item.confidence,
    })
  })

  output.certifications.forEach((item, itemIndex) => {
    rows.push({
      fieldGroup: 'certification',
      fieldKey: 'certification',
      itemIndex,
      extractedValue: {
        name: item.name,
        issuingBody: item.issuingBody,
        issuedDate: item.issuedDate,
        expiresDate: item.expiresDate,
      },
      hasEvidence: true,
      sourceLocation: item.sourceLocation,
      sourceExcerpt: item.sourceExcerpt,
      confidence: item.confidence,
    })
  })

  output.industryExposure.forEach((item, itemIndex) => {
    rows.push({
      fieldGroup: 'profile',
      fieldKey: 'industryExposure',
      itemIndex,
      extractedValue: { industry: item.industry },
      hasEvidence: true,
      sourceLocation: item.sourceLocation,
      sourceExcerpt: item.sourceExcerpt,
      confidence: item.confidence,
    })
  })

  return rows
}

/**
 * Computes the idempotency key a processing job's DB row is inserted with
 * (Build Phase 6 brief §SECURITY: "Make jobs idempotent") — paired with
 * migration 0022's unique index on this column and its partial
 * one-in-flight-job-per-document index, so retrying a stuck/duplicate
 * request can never create two concurrently in-flight jobs for the same
 * document.
 */
export function computeProcessingIdempotencyKey(
  candidateDocumentId: string,
  attemptNo: number,
): string {
  return `${candidateDocumentId}:${attemptNo}`
}

/**
 * Routes a scalar `field_key` (candidate_extracted_fields.field_key for a
 * `field_group = 'profile'` row) to the `candidate_profiles` column an
 * accepted value is written into (task #41's apply step, Build Phase 6
 * brief §AI PIPELINE step 10: "Apply approved changes without destroying
 * the original document" — only candidate_profiles is written; the source
 * candidate_documents row/file is never touched).
 *
 * `compensation` and `availability` are deliberately absent: those map to
 * candidate_profiles' STRUCTURED compensation_min/max/currency/period and
 * availability_date columns, which a recruiter enters deliberately as a
 * range/date — an AI-parsed free-text statement ("currently on 52,000
 * GBP") is not the same shape of fact and is never auto-coerced into a
 * numeric range or a specific date. Those two fields go to
 * compensation_notes/availability_notes instead (see
 * SCALAR_FIELD_TO_PROFILE_NOTES_COLUMN below) — visible next to the
 * structured field, never overwriting it.
 */
export const SCALAR_FIELD_TO_PROFILE_COLUMN: Record<string, string> = {
  currentTitle: 'current_title',
  currentCompany: 'current_company',
  location: 'location',
  workAuthorization: 'work_authorization',
  leadershipScope: 'leadership_scope',
  pnlResponsibility: 'pnl_responsibility',
}

/** See SCALAR_FIELD_TO_PROFILE_COLUMN's doc comment — compensation/availability apply to a free-text *_notes column instead of a structured one. */
export const SCALAR_FIELD_TO_PROFILE_NOTES_COLUMN: Record<string, string> = {
  compensation: 'compensation_notes',
  availability: 'availability_notes',
}

/** field_key values that apply into candidate_profiles.full_name-equivalent — fullName actually writes to candidates.full_name, not candidate_profiles, so it is routed separately by the caller rather than through either map above. */
export const FULL_NAME_FIELD_KEY = 'fullName'
