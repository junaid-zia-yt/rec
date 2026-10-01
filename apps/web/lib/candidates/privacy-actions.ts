'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { supabaseConfigured } from '@/lib/env'
import { logAuditEvent } from '@/lib/audit/log'
import { GENERIC_AUTH_ERROR_MESSAGE } from '@/lib/auth/errors'
import { requirePermission } from '@/lib/auth/session'
import { deleteStorageObjects } from '@/lib/files/storage'
import type { ActionResult } from '@/lib/auth/actions'
import {
  CANDIDATE_ERASURE_DELETE_TABLES,
  buildCandidateCoreRedaction,
  buildCandidateExportPayload,
  buildCandidateProfileRedaction,
  buildDeletionFulfillmentUpdate,
  buildDocumentProcessingRedaction,
  buildExtractedFieldRedaction,
  type CandidateExportSource,
} from './privacy'

/**
 * Data-subject-request fulfillment actions (Build Phase 14 Wave 3 privacy
 * review, docs/privacy-review.md). Two actions:
 *
 *   - erasePersonalDataAction: actually fulfills a previously RECORDED
 *     deletion request (requestCandidateDeletionAction in actions.ts only
 *     records the request — docs/07-data-model.md §7.6 explicitly deferred
 *     fulfillment to "a later, explicitly audited admin action"; this is
 *     that action). Gated on candidate_consents.deletion_requested already
 *     being true — an erasure is never a one-step, undiscussed action.
 *   - exportCandidateDataAction: a full JSON export of the PII this
 *     platform holds on one candidate, for a data-subject access/
 *     portability request.
 *
 * Both follow the established server-action shape (Zod validation,
 * requirePermission, an audit_events row, revalidatePath) every other
 * action in this directory uses. See privacy.ts for the pure, unit-tested
 * redaction/export-shape logic these actions call — and its header comment
 * for the honest, documented limits of what erasure can and cannot reach
 * (append-only audit/evidence tables retain historical excerpts by
 * deliberate design; docs/privacy-review.md §3 records this as an open
 * legal question, not something this action silently works around).
 *
 * Build Phase 17A Wave 2: erasePersonalDataAction now also deletes the
 * candidate's uploaded CV/document FILE BYTES from Supabase Storage
 * (docs/privacy-review.md §3c, tracked High since Build Phase 14) — the
 * original file very likely carries more identifiable information than any
 * extracted field, so DB-only redaction was never a complete fix.
 *
 * Ordering is deliberately Storage-first: every candidate_documents ->
 * document_uploads storage path is resolved and deleteStorageObjects is
 * attempted BEFORE any DB row is touched. If a Storage delete fails
 * (network error, provider outage), the action returns failure immediately
 * and does NOT anonymize/delete the DB rows — a retry needs both the
 * document_uploads.storage_path reference and the underlying file to still
 * exist to know what to delete, so losing the DB record first while a file
 * remains undeleted would orphan it, undiscoverable, forever. The reverse
 * order (DB first) would risk exactly that: a successful DB anonymization
 * followed by a failed Storage delete leaves an un-owned file with no
 * candidate record pointing back at it to retry.
 *
 * This is naturally idempotent and retry-safe: deleteStorageObjects (see
 * its own header, apps/web/lib/files/storage.ts) treats an already-absent
 * Storage object as a success, so re-running this action after a partial
 * failure simply re-resolves the SAME full path list, no-ops the paths
 * already removed, and only needs the genuinely-still-failing paths to
 * succeed this time — the caller never has to track "which ones" itself.
 */

const CandidateIdSchema = z.object({
  organizationId: z.string().uuid(),
  candidateId: z.string().uuid(),
})

async function authorizeDestructive(organizationId: string) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { error: GENERIC_AUTH_ERROR_MESSAGE as string, supabase: null, userId: null }

  // Same permission level requestCandidateDeletionAction/archiveCandidateAction
  // already use ('candidate_records'/'delete' — only agency_admin/recruiter
  // hold 'full' on this resource; platform_admin deliberately holds 'none'
  // per the matrix, client_decision_maker/read_only_reviewer hold 'read'
  // only) — an erasure or a full-PII export is at least as sensitive as an
  // archive, never less.
  await requirePermission(user.id, organizationId, 'candidate_records', 'delete')
  return { error: null, supabase: supabase!, userId: user.id }
}

/**
 * Fulfills a previously recorded deletion request: redacts every field this
 * codebase can safely redact without touching an append-only audit/evidence
 * table (see privacy.ts header for the exact, documented scope), deletes
 * the PII-only child rows whose FKs are all ON DELETE SET NULL downstream,
 * stamps candidates.deleted_at, and records fulfillment on
 * candidate_consents. Never throws away the deletion_reason/requested_by
 * trail already on candidate_consents — only adds to it.
 */
export async function erasePersonalDataAction(formData: FormData): Promise<ActionResult> {
  const parsed = CandidateIdSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured) {
    return { success: false, message: 'This environment is not connected to a live database yet.' }
  }

  const { organizationId, candidateId } = parsed.data
  const { error: authError, supabase, userId } = await authorizeDestructive(organizationId)
  if (authError || !supabase || !userId)
    return { success: false, message: authError ?? GENERIC_AUTH_ERROR_MESSAGE }

  const { data: consent } = await supabase
    .from('candidate_consents')
    .select('deletion_requested')
    .eq('candidate_id', candidateId)
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (!consent?.deletion_requested) {
    return {
      success: false,
      message:
        'No recorded deletion request for this candidate yet. Use "Request deletion" first, then fulfill it here — erasure is always a two-step, audited action.',
    }
  }

  // Storage-first (see header comment for why): resolve every Storage
  // object this candidate's documents reference, via candidate_documents
  // -> document_uploads (candidate_documents itself has no storage path —
  // it is a polymorphic FK to the shared document_uploads bookkeeping
  // table, supabase/migrations/0011_job_descriptions.sql /
  // 0019_candidate_documents.sql). Both queries are explicitly organization-
  // scoped in addition to RLS (belt-and-suspenders, same pattern
  // markNotificationReadAction documents) so a cross-tenant candidateId can
  // never resolve another organization's files.
  const { data: documents } = await supabase
    .from('candidate_documents')
    .select('document_upload_id')
    .eq('candidate_id', candidateId)
    .eq('organization_id', organizationId)

  const uploadIds = (documents ?? []).map((d) => d.document_upload_id as string)
  let storagePaths: string[] = []
  if (uploadIds.length > 0) {
    const { data: uploads } = await supabase
      .from('document_uploads')
      .select('storage_path')
      .in('id', uploadIds)
      .eq('organization_id', organizationId)
    storagePaths = (uploads ?? []).map((u) => u.storage_path as string)
  }

  if (storagePaths.length > 0) {
    const storageResult = await deleteStorageObjects(supabase, storagePaths)
    if (storageResult.failedPaths.length > 0) {
      // Partial (or total) failure — do NOT proceed to DB anonymization
      // (see header comment). Nothing here is swallowed: the caller sees
      // exactly how many of the candidate's files could not be deleted.
      // No DB row was touched, so the retry re-resolves this exact same
      // path list next time and only the still-failing paths need to
      // succeed (deleteStorageObjects is idempotent per path).
      return {
        success: false,
        message: `Could not delete ${storageResult.failedPaths.length} of ${storagePaths.length} uploaded file(s) from storage (${storageResult.error ?? 'unknown storage error'}). No candidate data was changed — retry once the storage issue clears; already-deleted files will not be re-attempted.`,
      }
    }
  }

  const nowIso = new Date().toISOString()

  if (uploadIds.length > 0) {
    // Every Storage object is now gone — mark the document rows so the UI
    // never offers a signed-URL download for a file that no longer exists
    // (docs/privacy-review.md §3's documented follow-up: "mark the
    // candidate's candidate_documents rows status = 'rejected'").
    await supabase
      .from('candidate_documents')
      .update({ status: 'rejected' })
      .eq('candidate_id', candidateId)
      .eq('organization_id', organizationId)
  }

  const { error: candidateError } = await supabase
    .from('candidates')
    .update(buildCandidateCoreRedaction(nowIso))
    .eq('id', candidateId)
    .eq('organization_id', organizationId)
  if (candidateError)
    return { success: false, message: "Could not erase this candidate's core record." }

  await supabase
    .from('candidate_profiles')
    .update(buildCandidateProfileRedaction())
    .eq('candidate_id', candidateId)
    .eq('organization_id', organizationId)

  for (const table of CANDIDATE_ERASURE_DELETE_TABLES) {
    await supabase
      .from(table)
      .delete()
      .eq('candidate_id', candidateId)
      .eq('organization_id', organizationId)
  }

  const { data: processingJobs } = await supabase
    .from('candidate_document_processing_jobs')
    .select('id')
    .eq('candidate_id', candidateId)
    .eq('organization_id', organizationId)
  if (processingJobs && processingJobs.length > 0) {
    await supabase
      .from('candidate_document_processing_jobs')
      .update(buildDocumentProcessingRedaction())
      .eq('candidate_id', candidateId)
      .eq('organization_id', organizationId)
  }

  await supabase
    .from('candidate_extracted_fields')
    .update(buildExtractedFieldRedaction())
    .eq('candidate_id', candidateId)
    .eq('organization_id', organizationId)
    // edited_value rows require a non-null edited_value (CHECK constraint) —
    // never touch those; documented residual gap, privacy.ts header.
    .neq('verification_status', 'edited')

  await supabase
    .from('candidate_consents')
    .update(buildDeletionFulfillmentUpdate(nowIso, userId))
    .eq('candidate_id', candidateId)
    .eq('organization_id', organizationId)

  await logAuditEvent(
    {
      organizationId,
      actorId: userId,
      action: 'candidate.pii_erased',
      entityType: 'candidates',
      entityId: candidateId,
      metadata: {
        redactedTables: ['candidates', 'candidate_profiles', ...CANDIDATE_ERASURE_DELETE_TABLES],
        // Count only — never the storage paths themselves, which embed the
        // original (possibly identifying) file name. Recording the count
        // proves erasure occurred without retaining exactly the PII this
        // action just deleted (project AI/audit rule: audit what happened,
        // never the erased content itself).
        storageFilesDeleted: storagePaths.length,
        note: 'requirement_evidence/audit_events/communication_events/candidate_responses excerpts are append-only and were not touched; uploaded CV/document files in Supabase Storage were deleted (Build Phase 17A Wave 2) — see docs/privacy-review.md §3.',
      },
    },
    supabase,
  )

  revalidatePath('/candidates')
  revalidatePath(`/candidates/${candidateId}`)
  return {
    success: true,
    message:
      'Candidate personal data erased where technically possible. See the privacy review for what remains in append-only audit/evidence tables.',
  }
}

/**
 * Full JSON export of the PII this platform holds on one candidate (data
 * portability / subject access request). Read-only — no writes, so it is
 * safe to call repeatedly. Deliberately excludes internal-only recruiter
 * reasoning that isn't the candidate's own data (matching_runs/scorecard
 * internals, copilot conversations) — this is the candidate's OWN data
 * export, not an internal case file.
 */
export interface CandidateExportActionResult extends ActionResult {
  /** JSON-serialized CandidateExportPayload (privacy.ts) when success is true. */
  data?: string
}

export async function exportCandidateDataAction(
  formData: FormData,
): Promise<CandidateExportActionResult> {
  const parsed = CandidateIdSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured) {
    return { success: false, message: 'This environment is not connected to a live database yet.' }
  }

  const { organizationId, candidateId } = parsed.data
  const { error: authError, supabase, userId } = await authorizeDestructive(organizationId)
  if (authError || !supabase || !userId)
    return { success: false, message: authError ?? GENERIC_AUTH_ERROR_MESSAGE }

  const [
    candidateRes,
    profileRes,
    contactsRes,
    experiencesRes,
    educationRes,
    certsRes,
    skillsRes,
    documentsRes,
    consentRes,
    commPrefsRes,
    outreachRes,
    responsesRes,
  ] = await Promise.all([
    supabase
      .from('candidates')
      .select('id, organization_id, full_name, primary_email, primary_phone, status')
      .eq('id', candidateId)
      .eq('organization_id', organizationId)
      .maybeSingle(),
    supabase
      .from('candidate_profiles')
      .select('*')
      .eq('candidate_id', candidateId)
      .eq('organization_id', organizationId)
      .maybeSingle(),
    supabase
      .from('candidate_contact_points')
      .select('type, value, verified')
      .eq('candidate_id', candidateId)
      .eq('organization_id', organizationId),
    supabase
      .from('candidate_experiences')
      .select('*')
      .eq('candidate_id', candidateId)
      .eq('organization_id', organizationId),
    supabase
      .from('candidate_education')
      .select('*')
      .eq('candidate_id', candidateId)
      .eq('organization_id', organizationId),
    supabase
      .from('candidate_certifications')
      .select('*')
      .eq('candidate_id', candidateId)
      .eq('organization_id', organizationId),
    supabase
      .from('candidate_skills')
      .select('*')
      .eq('candidate_id', candidateId)
      .eq('organization_id', organizationId),
    supabase
      .from('candidate_documents')
      .select('id, doc_type, status, version_no')
      .eq('candidate_id', candidateId)
      .eq('organization_id', organizationId),
    supabase
      .from('candidate_consents')
      .select('consent_status, consent_recorded_at, deletion_requested')
      .eq('candidate_id', candidateId)
      .eq('organization_id', organizationId)
      .maybeSingle(),
    supabase
      .from('communication_preferences')
      .select('channel, status')
      .eq('candidate_id', candidateId)
      .eq('organization_id', organizationId),
    supabase
      .from('outreach_messages')
      .select('channel, status, sent_at, subject')
      .eq('candidate_id', candidateId)
      .eq('organization_id', organizationId),
    supabase
      .from('candidate_responses')
      .select('channel, confirmed_classification, ai_suggested_classification')
      .eq('candidate_id', candidateId)
      .eq('organization_id', organizationId),
  ])

  if (!candidateRes.data) return { success: false, message: 'Candidate not found.' }

  const source: CandidateExportSource = {
    candidate: candidateRes.data,
    profile: profileRes.data ?? null,
    contactPoints: contactsRes.data ?? [],
    experiences: experiencesRes.data ?? [],
    education: educationRes.data ?? [],
    certifications: certsRes.data ?? [],
    skills: skillsRes.data ?? [],
    documents: documentsRes.data ?? [],
    consent: consentRes.data ?? null,
    communicationPreferences: commPrefsRes.data ?? [],
    outreachMessages: outreachRes.data ?? [],
    candidateResponses: responsesRes.data ?? [],
  }

  const payload = buildCandidateExportPayload(source, new Date().toISOString())

  await logAuditEvent(
    {
      organizationId,
      actorId: userId,
      action: 'candidate.data_exported',
      entityType: 'candidates',
      entityId: candidateId,
    },
    supabase,
  )

  return { success: true, message: 'Export generated.', data: JSON.stringify(payload, null, 2) }
}
