/**
 * Deterministic, pure logic for candidate data-subject requests (Build
 * Phase 14 Wave 3 privacy review): the row-update shape a "right to
 * erasure" fulfillment action must apply, and the child tables it must
 * delete outright, plus the structural shape of a "right to access/
 * portability" export payload. Factored out of privacy-actions.ts so the
 * decision of "which fields count as personal data to redact" is unit-
 * tested directly, the same convention this codebase uses everywhere else
 * (merge.ts/pipeline.ts/visibility.ts are tested; the '"use server"'
 * actions that call them are not — see merge.test.ts vs merge-actions.ts).
 *
 * Scope and known limitation, recorded honestly (docs/privacy-review.md
 * §3): this redacts the CURRENT/mutable candidate record — candidates,
 * candidate_profiles, candidate_contact_points, and the detail tables
 * (experiences/education/certifications/skills/sources) are all ordinary
 * mutable tables an agency_admin/recruiter can already write, so redacting
 * them here is a straightforward extension of existing write access.
 * candidate_document_processing_jobs.extracted_text and
 * candidate_extracted_fields.extracted_value/source_excerpt are likewise
 * ordinary mutable columns and are redacted too (edited_value is left
 * alone — candidate_extracted_fields_edited_has_value's CHECK constraint
 * requires a non-null edited_value whenever verification_status='edited',
 * so it cannot be nulled without also changing that status, which would
 * alter the historical review record itself; documented as a residual,
 * intentional gap).
 *
 * What this does NOT and structurally CANNOT erase without a separate
 * legal/product decision: requirement_evidence.excerpt, audit_events.
 * before_json/after_json (e.g. candidate.created stores fullName),
 * communication_events.raw_payload, and candidate_responses.
 * raw_response_text all live in append-only tables (REVOKE UPDATE, DELETE
 * at the database-role level — docs/07-data-model.md §7.7/§7.9/§7.11) by
 * deliberate design, so that a scoring or audit history can never be
 * silently altered. A real candidate erasure request therefore leaves
 * verbatim historical excerpts of that candidate's data resolvable from
 * those tables indefinitely. This is precisely the tension
 * docs/12-security-compliance.md §12.9 already flagged for legal review
 * ("whether anonymized-audit-retention satisfies applicable deletion-right
 * obligations") — this module does not invent an answer to that question;
 * it erases everything that can safely be erased without touching the
 * append-only audit/evidence design, and documents the rest as an open
 * legal question in docs/privacy-review.md.
 *
 * ALSO NOT reached by this module, disclosed prominently rather than
 * silently: the actual uploaded CV/document FILE BYTES in Supabase
 * Storage (referenced by candidate_documents -> document_uploads) are
 * never deleted — apps/web/lib/files/storage.ts has no delete/remove
 * function at all yet (confirmed by inspection: only upload/sign/download
 * exist). The uploaded file itself very likely carries MORE PII than any
 * extracted field (a full CV). This is a real, significant, honestly-
 * tracked gap for a follow-up wave — see docs/privacy-review.md §3.
 */

export const CANDIDATE_ERASURE_REDACTED_NAME = '[erased]'

/** candidates row — identity + primary contact fields. */
export interface CandidateCoreRedaction {
  full_name: string
  primary_email: null
  primary_phone: null
  deleted_at: string
}

export function buildCandidateCoreRedaction(nowIso: string): CandidateCoreRedaction {
  return {
    full_name: CANDIDATE_ERASURE_REDACTED_NAME,
    primary_email: null,
    primary_phone: null,
    deleted_at: nowIso,
  }
}

/** candidate_profiles row — every free-text/PII column, nulled in place. Row itself is kept (1:1 FK, referential integrity). */
export interface CandidateProfileRedaction {
  current_title: null
  current_company: null
  summary: null
  location: null
  work_authorization: null
  compensation_min: null
  compensation_max: null
  compensation_period: null
  compensation_notes: null
  availability_date: null
  availability_notes: null
  leadership_scope: null
  pnl_responsibility: null
  notice_period_days: null
  workplace_preference: null
  recruiter_notes: null
  client_visible_notes: null
}

export function buildCandidateProfileRedaction(): CandidateProfileRedaction {
  return {
    current_title: null,
    current_company: null,
    summary: null,
    location: null,
    work_authorization: null,
    compensation_min: null,
    compensation_max: null,
    compensation_period: null,
    compensation_notes: null,
    availability_date: null,
    availability_notes: null,
    leadership_scope: null,
    pnl_responsibility: null,
    notice_period_days: null,
    workplace_preference: null,
    recruiter_notes: null,
    client_visible_notes: null,
  }
}

/**
 * Child tables holding only PII with no other row depending on their
 * primary key surviving (every downstream FK — requirement_evidence.
 * source_experience_id etc. — is ON DELETE SET NULL, confirmed against
 * supabase/migrations/0027_candidate_matching.sql) — deleted outright
 * rather than redacted in place, since several of these columns are
 * NOT NULL with a non-empty CHECK (e.g. candidate_experiences.company),
 * so nulling them in place is not possible without violating the schema.
 */
export const CANDIDATE_ERASURE_DELETE_TABLES = [
  'candidate_contact_points',
  'candidate_experiences',
  'candidate_education',
  'candidate_certifications',
  'candidate_skills',
  'candidate_sources',
] as const

export type CandidateErasureDeleteTable = (typeof CANDIDATE_ERASURE_DELETE_TABLES)[number]

/** candidate_document_processing_jobs — redact the raw extracted CV text (kept only for pipeline-state bookkeeping otherwise). */
export interface DocumentProcessingRedaction {
  extracted_text: null
}

export function buildDocumentProcessingRedaction(): DocumentProcessingRedaction {
  return { extracted_text: null }
}

/** candidate_extracted_fields — redact the AI-proposed value + source excerpt. edited_value is deliberately left alone (see module header). */
export interface ExtractedFieldRedaction {
  extracted_value: null
  source_excerpt: null
}

export function buildExtractedFieldRedaction(): ExtractedFieldRedaction {
  return { extracted_value: null, source_excerpt: null }
}

/** candidate_consents — records that fulfillment actually happened (structural field, Build Phase 14 Wave 3). */
export interface DeletionFulfillmentUpdate {
  deletion_fulfilled_at: string
  deletion_fulfilled_by: string
}

export function buildDeletionFulfillmentUpdate(
  nowIso: string,
  actorId: string,
): DeletionFulfillmentUpdate {
  return { deletion_fulfilled_at: nowIso, deletion_fulfilled_by: actorId }
}

// ---------------------------------------------------------------------------
// Export (data portability / subject access request) payload shape.
// ---------------------------------------------------------------------------

/**
 * A single field in the export, explicit about verification/evidence status
 * rather than presenting every value with equal confidence (core principle
 * #6: "missing candidate information must be marked as unverified").
 */
export interface ExportField<T> {
  value: T | null
  unverified: boolean
}

export interface CandidateExportPayload {
  exportedAt: string
  candidateId: string
  organizationId: string
  core: {
    fullName: string
    primaryEmail: string | null
    primaryPhone: string | null
    status: string
  }
  profile: Record<string, unknown> | null
  contactPoints: Array<{ type: string; value: string; verified: boolean }>
  experiences: Array<Record<string, unknown>>
  education: Array<Record<string, unknown>>
  certifications: Array<Record<string, unknown>>
  skills: Array<Record<string, unknown>>
  documents: Array<{ id: string; docType: string; status: string; versionNo: number }>
  consent: {
    status: string
    recordedAt: string | null
    deletionRequested: boolean
  } | null
  communicationPreferences: Array<{ channel: string; status: string }>
  outreachMessages: Array<{
    channel: string
    status: string
    sentAt: string | null
    subject: string | null
  }>
  candidateResponses: Array<{
    channel: string
    classification: string | null
    respondedVia: string | null
  }>
}

export interface CandidateExportSource {
  candidate: {
    id: string
    organization_id: string
    full_name: string
    primary_email: string | null
    primary_phone: string | null
    status: string
  }
  profile: Record<string, unknown> | null
  contactPoints: Array<{ type: string; value: string; verified: boolean | null }>
  experiences: Array<Record<string, unknown>>
  education: Array<Record<string, unknown>>
  certifications: Array<Record<string, unknown>>
  skills: Array<Record<string, unknown>>
  documents: Array<{ id: string; doc_type: string; status: string; version_no: number }>
  consent: {
    consent_status: string
    consent_recorded_at: string | null
    deletion_requested: boolean
  } | null
  communicationPreferences: Array<{ channel: string; status: string }>
  outreachMessages: Array<{
    channel: string
    status: string
    sent_at: string | null
    subject: string | null
  }>
  candidateResponses: Array<{
    channel: string
    confirmed_classification: string | null
    ai_suggested_classification: string | null
  }>
}

/** Assembles the export JSON from already-fetched rows. Pure — no I/O, no Supabase client — so it's directly unit-testable. */
export function buildCandidateExportPayload(
  source: CandidateExportSource,
  nowIso: string,
): CandidateExportPayload {
  return {
    exportedAt: nowIso,
    candidateId: source.candidate.id,
    organizationId: source.candidate.organization_id,
    core: {
      fullName: source.candidate.full_name,
      primaryEmail: source.candidate.primary_email,
      primaryPhone: source.candidate.primary_phone,
      status: source.candidate.status,
    },
    profile: source.profile,
    contactPoints: source.contactPoints.map((c) => ({
      type: c.type,
      value: c.value,
      verified: c.verified ?? false,
    })),
    experiences: source.experiences,
    education: source.education,
    certifications: source.certifications,
    skills: source.skills,
    documents: source.documents.map((d) => ({
      id: d.id,
      docType: d.doc_type,
      status: d.status,
      versionNo: d.version_no,
    })),
    consent: source.consent
      ? {
          status: source.consent.consent_status,
          recordedAt: source.consent.consent_recorded_at,
          deletionRequested: source.consent.deletion_requested,
        }
      : null,
    communicationPreferences: source.communicationPreferences,
    outreachMessages: source.outreachMessages.map((m) => ({
      channel: m.channel,
      status: m.status,
      sentAt: m.sent_at,
      subject: m.subject,
    })),
    candidateResponses: source.candidateResponses.map((r) => ({
      channel: r.channel,
      classification: r.confirmed_classification,
      respondedVia: r.ai_suggested_classification,
    })),
  }
}
