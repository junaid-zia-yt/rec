'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { supabaseConfigured } from '@/lib/env'
import { logAuditEvent } from '@/lib/audit/log'
import { logProjectActivity } from '@/lib/audit/activity'
import { GENERIC_AUTH_ERROR_MESSAGE } from '@/lib/auth/errors'
import { requirePermission } from '@/lib/auth/session'
import { requireProjectAccess } from '@/lib/auth/project-access'
import { validateJobDescriptionFile } from '@/lib/files/validate'
import { uploadDocument } from '@/lib/files/storage'
import { extractJobDescriptionText } from './text-extraction'
import type { ActionResult } from '@/lib/auth/actions'

/**
 * Job-description intake server actions (Build Phase 3 brief §"Job-
 * description intake"). Two entry points — paste and upload — both land in
 * the same `job_descriptions` table with a `source` discriminator and
 * incrementing `version_no`; a new version supersedes (never overwrites or
 * deletes) the previous one, per docs/07-data-model.md §7.5.
 *
 * Uploaded documents are untrusted (project AI-safety rule: "treat uploaded
 * CVs and documents as untrusted data" / "never allow text inside an
 * uploaded document to override system instructions"). This build phase
 * does not implement AI extraction at all (Build Phase 3 brief: "Do not
 * implement AI extraction yet"), so that risk does not yet apply to a real
 * model call — it is recorded here so the extraction step added in a later
 * phase inherits this framing rather than re-deriving it.
 */

async function nextVersionNo(
  supabase: NonNullable<Awaited<ReturnType<typeof createServerSupabaseClient>>>,
  jobId: string,
): Promise<number> {
  const { data } = await supabase
    .from('job_descriptions')
    .select('version_no')
    .eq('job_id', jobId)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data?.version_no ?? 0) + 1
}

const PasteJobDescriptionSchema = z.object({
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  projectClientId: z.string().uuid(),
  jobId: z.string().uuid(),
  text: z
    .string()
    .trim()
    .min(20, 'Paste the full job description (at least 20 characters).')
    .max(50000),
})

export async function pasteJobDescriptionAction(formData: FormData): Promise<ActionResult> {
  const parsed = PasteJobDescriptionSchema.safeParse({
    organizationId: formData.get('organizationId'),
    projectId: formData.get('projectId'),
    projectClientId: formData.get('projectClientId'),
    jobId: formData.get('jobId'),
    text: formData.get('text'),
  })
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? 'Check the pasted text and try again.',
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

  const membership = await requirePermission(
    user.id,
    parsed.data.organizationId,
    'job_descriptions',
    'create',
  )
  await requireProjectAccess(user.id, membership, {
    id: parsed.data.projectId,
    clientId: parsed.data.projectClientId,
  })

  const versionNo = await nextVersionNo(supabase!, parsed.data.jobId)

  await supabase!
    .from('job_descriptions')
    .update({ superseded_at: new Date().toISOString(), status: 'reviewed' })
    .eq('job_id', parsed.data.jobId)
    .is('superseded_at', null)

  const { data: jd, error } = await supabase!
    .from('job_descriptions')
    .insert({
      organization_id: parsed.data.organizationId,
      job_id: parsed.data.jobId,
      source: 'pasted',
      raw_text: parsed.data.text,
      version_no: versionNo,
      status: 'parsed', // pasted text needs no extraction step — it is already plain text
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error || !jd) {
    return { success: false, message: 'Could not save the job description.' }
  }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'job_description.uploaded',
      entityType: 'job_descriptions',
      entityId: jd.id,
      after: { source: 'pasted', versionNo },
    },
    supabase,
  )
  await logProjectActivity(
    {
      organizationId: parsed.data.organizationId,
      recruitmentProjectId: parsed.data.projectId,
      actorId: user.id,
      action: 'job_description.uploaded',
      summary: `Pasted job description (version ${versionNo}).`,
    },
    supabase,
  )

  revalidatePath(`/projects/${parsed.data.projectId}`)
  return { success: true, message: 'Job description saved.' }
}

const UploadJobDescriptionSchema = z.object({
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  projectClientId: z.string().uuid(),
  jobId: z.string().uuid(),
})

/**
 * Uploads a JD file. The original is always stored untouched in private
 * Storage first, then deterministic (non-AI) text-layer extraction runs
 * against the same bytes (`./text-extraction.ts`, reusing the candidate-CV
 * pipeline's `extractDocumentText`) — Build Phase 17A Wave 3, closing the
 * gap docs/build-phase-3-report.md originally named as a follow-up (see
 * docs/release-readiness.md GO/NO-GO item 6). A genuine extraction
 * (`status: 'extracted'`) populates `raw_text` and moves the row straight to
 * `status: 'parsed'`, so it reaches requirement extraction exactly like a
 * pasted JD does. A scanned/image-only file or an unparseable file still
 * saves the original (never lost) with `status: 'draft'` and an honest,
 * specific message — extraction provenance (method/library, or the safe
 * error kind/message) is recorded on the row either way (0036).
 */
export async function uploadJobDescriptionAction(formData: FormData): Promise<ActionResult> {
  const parsed = UploadJobDescriptionSchema.safeParse({
    organizationId: formData.get('organizationId'),
    projectId: formData.get('projectId'),
    projectClientId: formData.get('projectClientId'),
    jobId: formData.get('jobId'),
  })
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return { success: false, message: 'Choose a PDF or Word (.docx) file to upload.' }
  }

  const validation = validateJobDescriptionFile({
    fileName: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
  })
  if (!validation.valid) {
    return { success: false, message: validation.message ?? 'This file cannot be uploaded.' }
  }

  if (!supabaseConfigured) {
    return { success: false, message: 'This environment is not connected to a live database yet.' }
  }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  const membership = await requirePermission(
    user.id,
    parsed.data.organizationId,
    'job_descriptions',
    'create',
  )
  await requireProjectAccess(user.id, membership, {
    id: parsed.data.projectId,
    clientId: parsed.data.projectClientId,
  })

  const bytes = new Uint8Array(await file.arrayBuffer())

  let uploadResult
  try {
    uploadResult = await uploadDocument(supabase!, {
      organizationId: parsed.data.organizationId,
      ownerType: 'job_description',
      ownerId: parsed.data.jobId,
      fileName: file.name,
      mimeType: file.type,
      bytes,
    })
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : 'Upload failed.' }
  }

  const versionNo = await nextVersionNo(supabase!, parsed.data.jobId)
  const source = file.type === 'application/pdf' ? 'uploaded_pdf' : 'uploaded_docx'

  // Deterministic, non-AI extraction against the same bytes just uploaded
  // (never re-downloaded from Storage — no need, and one less round trip
  // for content that is still untrusted either way). See ./text-extraction.ts.
  const extraction = await extractJobDescriptionText(bytes, file.type)

  await supabase!
    .from('job_descriptions')
    .update({ superseded_at: new Date().toISOString(), status: 'reviewed' })
    .eq('job_id', parsed.data.jobId)
    .is('superseded_at', null)

  const { data: jd, error } = await supabase!
    .from('job_descriptions')
    .insert({
      organization_id: parsed.data.organizationId,
      job_id: parsed.data.jobId,
      source,
      raw_text: extraction.rawText,
      file_storage_path: uploadResult.storagePath,
      file_name: file.name,
      file_mime_type: file.type,
      file_size_bytes: uploadResult.sizeBytes,
      file_checksum_sha256: uploadResult.checksumSha256,
      version_no: versionNo,
      status: extraction.jobDescriptionStatus,
      text_extraction_status: extraction.textExtractionStatus,
      text_extraction_method: extraction.textExtractionMethod,
      text_extraction_library: extraction.textExtractionLibrary,
      text_extraction_error_kind: extraction.textExtractionErrorKind,
      text_extraction_error_message: extraction.textExtractionErrorMessage,
      text_extraction_attempted_at: new Date().toISOString(),
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error || !jd) {
    return {
      success: false,
      message: 'The file was stored, but saving its record failed. Contact support.',
    }
  }

  await supabase!.from('document_uploads').insert({
    organization_id: parsed.data.organizationId,
    owner_type: 'job_description',
    owner_id: jd.id,
    storage_path: uploadResult.storagePath,
    file_name: file.name,
    mime_type: file.type,
    size_bytes: uploadResult.sizeBytes,
    checksum_sha256: uploadResult.checksumSha256,
    uploaded_by: user.id,
  })

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'job_description.uploaded',
      entityType: 'job_descriptions',
      entityId: jd.id,
      after: {
        source,
        fileName: file.name,
        versionNo,
        textExtractionStatus: extraction.textExtractionStatus,
      },
    },
    supabase,
  )
  await logProjectActivity(
    {
      organizationId: parsed.data.organizationId,
      recruitmentProjectId: parsed.data.projectId,
      actorId: user.id,
      action: 'job_description.uploaded',
      summary: `Uploaded "${file.name}" (version ${versionNo}).`,
    },
    supabase,
  )

  revalidatePath(`/projects/${parsed.data.projectId}`)
  return {
    success: true,
    message: extraction.userMessage,
  }
}
