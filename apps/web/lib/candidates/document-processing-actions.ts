'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { supabaseConfigured } from '@/lib/env'
import { logAuditEvent } from '@/lib/audit/log'
import { GENERIC_AUTH_ERROR_MESSAGE } from '@/lib/auth/errors'
import { requirePermission } from '@/lib/auth/session'
import { enqueueJob } from '@/lib/jobs/enqueue'
import { executeJob } from '@/lib/jobs/executor'
import { DEFAULT_JOB_HANDLERS } from '@/lib/jobs/handlers'
import type { DocumentProcessingResult } from '@/lib/jobs/handlers/document-processing'
import {
  computeProcessingIdempotencyKey,
  SCALAR_FIELD_TO_PROFILE_COLUMN,
  SCALAR_FIELD_TO_PROFILE_NOTES_COLUMN,
} from './document-processing'
import type { ActionResult } from '@/lib/auth/actions'

/**
 * AI candidate-document processing server actions (Build Phase 6 brief
 * §AI PIPELINE / §HUMAN CONTROL / §UI).
 *
 * PERMISSIONS NOTE (documented explicitly, matching this codebase's
 * convention of recording interpretive decisions rather than silently
 * applying them — see docs/06-roles-permissions.md §6.2's own worked
 * examples): every write action below is gated on the 'candidate_documents'
 * resource, not 'candidate_evidence'. The permission matrix
 * (packages/types/src/permissions.ts) gives agency_admin/recruiter only
 * 'read' on candidate_evidence, because that resource represents AI/
 * system-authored CONTENT — no human "creates" evidence text, the model
 * does. But kicking off processing, reprocessing, and reviewing (verify/
 * reject/edit/accept) a proposed field are all human actions performed ON
 * the document-processing pipeline, the same category of action as
 * uploading or rejecting a CV document, which the matrix already grants
 * agency_admin/recruiter 'full' on via 'candidate_documents'. Migration
 * 0022's RLS policies encode the identical interpretation at the database
 * layer (candidate_document_processing_jobs_write_internal and
 * candidate_extracted_fields_write_internal both admit agency_admin/
 * recruiter, never client_decision_maker). A client_decision_maker's
 * matrix-granted 'read' on candidate_evidence is enforced purely by RLS
 * select policies — they have no server action here that could write.
 */

const StartProcessingSchema = z.object({
  organizationId: z.string().uuid(),
  candidateId: z.string().uuid(),
  candidateDocumentId: z.string().uuid(),
})

/**
 * Kicks off (or reports the existing) processing job for one
 * candidate_documents row (Build Phase 6 brief §UI: "Processing queue
 * state", "Processing progress"). Runs the pipeline inline and
 * synchronously — this environment has no background job queue configured
 * (docs/17-deployment-operations.md), so "queued" is a real but
 * momentary state; a future phase can move the pipeline body into an
 * actual background worker without changing this action's contract.
 */
export async function startCandidateDocumentProcessingAction(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = StartProcessingSchema.safeParse({
    organizationId: formData.get('organizationId'),
    candidateId: formData.get('candidateId'),
    candidateDocumentId: formData.get('candidateDocumentId'),
  })
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured) {
    return { success: false, message: 'This environment is not connected to a live database yet.' }
  }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'candidate_documents', 'update')

  const { data: existingInFlight } = await supabase!
    .from('candidate_document_processing_jobs')
    .select('id')
    .eq('candidate_document_id', parsed.data.candidateDocumentId)
    .in('status', ['queued', 'extracting_text', 'parsing'])
    .limit(1)
    .maybeSingle()

  if (existingInFlight) {
    return { success: false, message: 'This document is already being processed.' }
  }

  const { data: priorAttempts } = await supabase!
    .from('candidate_document_processing_jobs')
    .select('attempt_no')
    .eq('candidate_document_id', parsed.data.candidateDocumentId)
    .order('attempt_no', { ascending: false })
    .limit(1)

  const attemptNo = (priorAttempts?.[0]?.attempt_no ?? 0) + 1

  return runProcessingJob(supabase!, {
    organizationId: parsed.data.organizationId,
    candidateId: parsed.data.candidateId,
    candidateDocumentId: parsed.data.candidateDocumentId,
    attemptNo,
    reprocessOfJobId: null,
    reprocessReason: null,
    requestedBy: user.id,
  })
}

const ReprocessSchema = z.object({
  organizationId: z.string().uuid(),
  candidateId: z.string().uuid(),
  candidateDocumentId: z.string().uuid(),
  priorJobId: z.string().uuid(),
  reason: z.string().trim().min(1, 'A reason is required to reprocess.').max(1000),
})

/** Reprocesses a document that previously failed, needed OCR, or whose review the recruiter wants redone (Build Phase 6 brief §UI: "Reprocess with reason"). A reason is mandatory — this is a deliberate, auditable re-run, never a silent retry. */
export async function reprocessCandidateDocumentAction(formData: FormData): Promise<ActionResult> {
  const parsed = ReprocessSchema.safeParse({
    organizationId: formData.get('organizationId'),
    candidateId: formData.get('candidateId'),
    candidateDocumentId: formData.get('candidateDocumentId'),
    priorJobId: formData.get('priorJobId'),
    reason: formData.get('reason'),
  })
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? 'A reason is required to reprocess.',
    }
  }
  if (!supabaseConfigured) {
    return { success: false, message: 'This environment is not connected to a live database yet.' }
  }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'candidate_documents', 'update')

  const { data: existingInFlight } = await supabase!
    .from('candidate_document_processing_jobs')
    .select('id')
    .eq('candidate_document_id', parsed.data.candidateDocumentId)
    .in('status', ['queued', 'extracting_text', 'parsing'])
    .limit(1)
    .maybeSingle()

  if (existingInFlight) {
    return { success: false, message: 'This document is already being processed.' }
  }

  const { data: priorAttempts } = await supabase!
    .from('candidate_document_processing_jobs')
    .select('attempt_no')
    .eq('candidate_document_id', parsed.data.candidateDocumentId)
    .order('attempt_no', { ascending: false })
    .limit(1)

  const attemptNo = (priorAttempts?.[0]?.attempt_no ?? 0) + 1

  return runProcessingJob(supabase!, {
    organizationId: parsed.data.organizationId,
    candidateId: parsed.data.candidateId,
    candidateDocumentId: parsed.data.candidateDocumentId,
    attemptNo,
    reprocessOfJobId: parsed.data.priorJobId,
    reprocessReason: parsed.data.reason,
    requestedBy: user.id,
  })
}

/**
 * Shared job-creation-and-execution path for both the first attempt and a
 * reprocess. The full pipeline (download the source document, extract/OCR
 * its text, run the AI parse, write the candidate_document_processing_jobs
 * status walk and, on success, candidate_extracted_fields) now runs through
 * the durable job engine (Build Phase 14, Wave 4b — see `lib/jobs/handlers/
 * document-processing.ts`'s own header note) via `enqueueJob` immediately
 * followed by `executeJob` in this same request ("enqueue and try now" —
 * the common-case return to the caller/UI is unchanged: still synchronous,
 * still the final result, before this request completes).
 */
async function runProcessingJob(
  supabase: SupabaseClient,
  params: {
    organizationId: string
    candidateId: string
    candidateDocumentId: string
    attemptNo: number
    reprocessOfJobId: string | null
    reprocessReason: string | null
    requestedBy: string
  },
): Promise<ActionResult> {
  const idempotencyKey = computeProcessingIdempotencyKey(
    params.candidateDocumentId,
    params.attemptNo,
  )

  const { job: bgJob } = await enqueueJob({
    organizationId: params.organizationId,
    jobType: 'document_processing',
    payload: {
      candidateId: params.candidateId,
      candidateDocumentId: params.candidateDocumentId,
      attemptNo: params.attemptNo,
      reprocessOfJobId: params.reprocessOfJobId,
      reprocessReason: params.reprocessReason,
    },
    idempotencyKey,
    supabase,
    userId: params.requestedBy,
  })

  const outcome = await executeJob({ jobId: bgJob.id, supabase, handlers: DEFAULT_JOB_HANDLERS })

  revalidatePath(`/candidates/${params.candidateId}`)

  switch (outcome.kind) {
    case 'succeeded': {
      const result = outcome.result as DocumentProcessingResult
      if (result.jobStatus === 'awaiting_review') {
        return {
          success: true,
          message: 'Processing complete — extracted fields are ready for review.',
        }
      }
      if (result.jobStatus === 'needs_ocr') {
        return {
          success: false,
          message: 'This document needs OCR, which is not available in this environment.',
        }
      }
      return { success: false, message: result.errorMessage ?? 'Processing failed.' }
    }
    case 'failed_will_retry':
      return { success: false, message: 'Processing failed and will be retried automatically.' }
    case 'dead_lettered':
      return { success: false, message: outcome.errorMessage ?? 'Processing failed.' }
    case 'not_claimed':
      return { success: false, message: 'Could not start processing — it may already be running.' }
    case 'no_handler':
    default:
      return { success: false, message: 'Processing is not available in this environment.' }
  }
}

const FieldDecisionSchema = z.object({
  organizationId: z.string().uuid(),
  candidateId: z.string().uuid(),
  fieldId: z.string().uuid(),
})

/** Verifies one extracted field as correct, exactly as proposed (Build Phase 6 brief §UI: "Field-by-field verification"). */
export async function verifyExtractedFieldAction(formData: FormData): Promise<ActionResult> {
  return applyFieldDecision(formData, 'verified')
}

const RejectFieldSchema = FieldDecisionSchema.extend({
  reason: z.string().trim().max(1000).optional(),
})

/** Rejects one extracted field — it will never be applied to the candidate's real record (Build Phase 6 brief §UI: "Reject or edit extracted fields"). */
export async function rejectExtractedFieldAction(formData: FormData): Promise<ActionResult> {
  const parsed = RejectFieldSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  return applyFieldDecisionInternal(
    parsed.data.organizationId,
    parsed.data.candidateId,
    parsed.data.fieldId,
    'rejected',
    null,
    parsed.data.reason ?? null,
  )
}

const EditFieldSchema = FieldDecisionSchema.extend({
  editedValueJson: z.string().min(1, 'An edited value is required.'),
})

/** Records a human correction to an extracted field's value before it is applied (Build Phase 6 brief §UI: "Reject or edit extracted fields"). The AI's original proposal (extracted_value) is never overwritten — the correction is stored separately in edited_value, so what the model actually said remains inspectable. */
export async function editExtractedFieldAction(formData: FormData): Promise<ActionResult> {
  const parsed = EditFieldSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }

  let editedValue: unknown
  try {
    editedValue = JSON.parse(parsed.data.editedValueJson)
  } catch {
    return { success: false, message: 'The edited value was malformed.' }
  }

  return applyFieldDecisionInternal(
    parsed.data.organizationId,
    parsed.data.candidateId,
    parsed.data.fieldId,
    'edited',
    editedValue,
    null,
  )
}

async function applyFieldDecision(formData: FormData, status: 'verified'): Promise<ActionResult> {
  const parsed = FieldDecisionSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  return applyFieldDecisionInternal(
    parsed.data.organizationId,
    parsed.data.candidateId,
    parsed.data.fieldId,
    status,
    null,
    null,
  )
}

async function applyFieldDecisionInternal(
  organizationId: string,
  candidateId: string,
  fieldId: string,
  status: 'verified' | 'rejected' | 'edited',
  editedValue: unknown,
  reason: string | null,
): Promise<ActionResult> {
  if (!supabaseConfigured) {
    return { success: false, message: 'This environment is not connected to a live database yet.' }
  }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, organizationId, 'candidate_documents', 'update')

  const { error } = await supabase!
    .from('candidate_extracted_fields')
    .update({
      verification_status: status,
      edited_value: status === 'edited' ? editedValue : null,
      reviewer_id: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', fieldId)
    .eq('organization_id', organizationId)

  if (error) return { success: false, message: 'Could not save the review decision.' }

  await logAuditEvent(
    {
      organizationId,
      actorId: user.id,
      action:
        status === 'verified'
          ? 'candidate.extracted_field_verified'
          : status === 'rejected'
            ? 'candidate.extracted_field_rejected'
            : 'candidate.extracted_field_edited',
      entityType: 'candidate_extracted_fields',
      entityId: fieldId,
      metadata: reason ? { reason } : undefined,
    },
    supabase,
  )

  revalidatePath(`/candidates/${candidateId}`)
  return { success: true, message: 'Review decision saved.' }
}

const AcceptAllVerifiedSchema = z.object({
  organizationId: z.string().uuid(),
  candidateId: z.string().uuid(),
  processingJobId: z.string().uuid(),
})

/**
 * "Accept all verified fields" (Build Phase 6 brief §UI). Applies every
 * field for this job whose verification_status is 'verified' or 'edited'
 * into the candidate's real record — candidates.full_name,
 * candidate_profiles' matching column, candidate_contact_points, and the
 * candidate_experiences/_education/_certifications/_skills tables — and
 * stamps applied_at on each row it touched. A 'rejected' or still-'pending'
 * field is never applied (Build Phase 6 brief §HUMAN CONTROL: "AI-extracted
 * data must remain pending until reviewed or explicitly accepted"). The
 * original candidate_documents row and its file are never written to here
 * (§AI PIPELINE step 10: "without destroying the original document").
 */
export async function acceptAllVerifiedFieldsAction(formData: FormData): Promise<ActionResult> {
  const parsed = AcceptAllVerifiedSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured) {
    return { success: false, message: 'This environment is not connected to a live database yet.' }
  }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'candidate_documents', 'update')

  const { data: fields } = await supabase!
    .from('candidate_extracted_fields')
    .select(
      'id, field_group, field_key, item_index, extracted_value, edited_value, verification_status, applied_at, source_document_id',
    )
    .eq('processing_job_id', parsed.data.processingJobId)
    .in('verification_status', ['verified', 'edited'])
    .is('applied_at', null)

  if (!fields || fields.length === 0) {
    return { success: true, message: 'No newly verified fields to apply.' }
  }

  let appliedCount = 0
  const profileUpdate: Record<string, unknown> = {}
  let fullNameUpdate: string | null = null

  for (const field of fields) {
    const value =
      field.verification_status === 'edited' ? field.edited_value : field.extracted_value
    if (value == null) continue

    if (field.field_group === 'profile' && field.item_index === null) {
      const scalarValue = (value as { value?: unknown }).value
      if (typeof scalarValue !== 'string' || scalarValue.length === 0) continue

      if (field.field_key === 'fullName') {
        fullNameUpdate = scalarValue
      } else if (SCALAR_FIELD_TO_PROFILE_COLUMN[field.field_key]) {
        profileUpdate[SCALAR_FIELD_TO_PROFILE_COLUMN[field.field_key]!] = scalarValue
      } else if (SCALAR_FIELD_TO_PROFILE_NOTES_COLUMN[field.field_key]) {
        profileUpdate[SCALAR_FIELD_TO_PROFILE_NOTES_COLUMN[field.field_key]!] = scalarValue
      } else {
        continue // industryExposure and any other profile-group array item is handled below, not here
      }
    } else if (field.field_group === 'contact') {
      const contact = value as { type?: string; value?: string }
      if (!contact.type || !contact.value) continue
      await supabase!.from('candidate_contact_points').insert({
        organization_id: parsed.data.organizationId,
        candidate_id: parsed.data.candidateId,
        type: contact.type,
        value: contact.value,
        normalized_value: contact.value.trim().toLowerCase(),
        is_primary: false,
        created_by: user.id,
      })
    } else if (field.field_group === 'experience') {
      const item = value as {
        company?: string
        title?: string
        startDate?: string | null
        endDate?: string | null
        isCurrent?: boolean
        responsibilities?: string[]
      }
      if (!item.company || !item.title) continue
      await supabase!.from('candidate_experiences').insert({
        organization_id: parsed.data.organizationId,
        candidate_id: parsed.data.candidateId,
        company: item.company,
        title: item.title,
        start_date: item.startDate ?? null,
        end_date: item.endDate ?? null,
        is_current: item.isCurrent ?? false,
        description: item.responsibilities?.join('; ') ?? null,
        source: 'ai',
        created_by: user.id,
      })
    } else if (field.field_group === 'education') {
      const item = value as {
        institution?: string
        degree?: string | null
        fieldOfStudy?: string | null
        startDate?: string | null
        endDate?: string | null
      }
      if (!item.institution) continue
      await supabase!.from('candidate_education').insert({
        organization_id: parsed.data.organizationId,
        candidate_id: parsed.data.candidateId,
        institution: item.institution,
        degree: item.degree ?? null,
        field_of_study: item.fieldOfStudy ?? null,
        start_date: item.startDate ?? null,
        end_date: item.endDate ?? null,
        source: 'ai',
        created_by: user.id,
      })
    } else if (field.field_group === 'certification') {
      const item = value as {
        name?: string
        issuingBody?: string | null
        issuedDate?: string | null
        expiresDate?: string | null
      }
      if (!item.name) continue
      await supabase!.from('candidate_certifications').insert({
        organization_id: parsed.data.organizationId,
        candidate_id: parsed.data.candidateId,
        name: item.name,
        issuing_body: item.issuingBody ?? null,
        issued_date: item.issuedDate ?? null,
        expires_date: item.expiresDate ?? null,
        source: 'ai',
        created_by: user.id,
      })
    } else if (field.field_group === 'skill') {
      const item = value as { skillName?: string }
      if (!item.skillName) continue
      // candidate_skills_unique_per_candidate_idx is a functional unique
      // index (lower(skill_name)), which Supabase's upsert onConflict
      // cannot target directly — a plain insert whose failure is ignored
      // has the same net effect (the skill is already recorded) without
      // needing that index's exact expression as a conflict target.
      await supabase!.from('candidate_skills').insert({
        organization_id: parsed.data.organizationId,
        candidate_id: parsed.data.candidateId,
        skill_name: item.skillName,
        source: 'ai',
        created_by: user.id,
      })
    } else {
      continue
    }

    await supabase!
      .from('candidate_extracted_fields')
      .update({ applied_at: new Date().toISOString() })
      .eq('id', field.id)
    appliedCount += 1
  }

  if (fullNameUpdate) {
    await supabase!
      .from('candidates')
      .update({ full_name: fullNameUpdate })
      .eq('id', parsed.data.candidateId)
      .eq('organization_id', parsed.data.organizationId)
  }
  if (Object.keys(profileUpdate).length > 0) {
    await supabase!
      .from('candidate_profiles')
      .update(profileUpdate)
      .eq('candidate_id', parsed.data.candidateId)
      .eq('organization_id', parsed.data.organizationId)
  }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'candidate.extracted_fields_applied',
      entityType: 'candidate_document_processing_jobs',
      entityId: parsed.data.processingJobId,
      metadata: { appliedCount },
    },
    supabase,
  )

  revalidatePath(`/candidates/${parsed.data.candidateId}`)
  return {
    success: true,
    message: `Applied ${appliedCount} verified field(s) to the candidate record.`,
  }
}
