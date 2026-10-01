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
import { uploadDocument } from '@/lib/files/storage'
import { validateCandidateDocumentFile } from '@/lib/files/validate'
import type { ActionResult } from '@/lib/auth/actions'
import { addDemoCandidate, importDemoCandidatesCsv } from '@/lib/demo/engine'

/**
 * Candidate Foundation server actions (Build Phase 5 brief §DATABASE /
 * §FUNCTIONAL REQUIREMENTS). Every write: Zod-validated input,
 * requirePermission (+ requireProjectAccess when a project is involved), a
 * Supabase write, an audit_events row, revalidatePath — the same shape
 * every prior phase's server actions use.
 */

/**
 * A `<select defaultValue="">` with a "Not specified" placeholder option
 * submits `''` via FormData whenever the recruiter leaves it untouched —
 * which is the default, out-of-the-box state of the candidate form. Zod's
 * `.enum([...]).optional()` only tolerates a MISSING field, not an empty
 * string, so without this preprocessing every optional enum field below
 * rejects the form's own default state with a raw "Invalid enum value"
 * error — discovered via Playwright browser testing (not caught by the
 * existing unit tests, which never exercised the unmodified form) as the
 * root cause blocking candidate creation whenever no workplace preference
 * was chosen. This affects createCandidateAction and (via
 * UpdateCandidateSchema's .omit()) updateCandidateAction alike, in both
 * live and demo mode, since both share this schema.
 */
function optionalEnum<T extends [string, ...string[]]>(values: T) {
  return z.preprocess((v) => (v === '' ? undefined : v), z.enum(values).optional())
}

const CandidateCoreSchema = z.object({
  organizationId: z.string().uuid(),
  fullName: z.string().trim().min(1, 'Full name is required.').max(200),
  primaryEmail: z.string().trim().email('Not a valid email.').or(z.literal('')).optional(),
  primaryPhone: z.string().trim().max(40).optional(),
  currentTitle: z.string().trim().max(200).optional(),
  currentCompany: z.string().trim().max(200).optional(),
  location: z.string().trim().max(200).optional(),
  workAuthorization: z.string().trim().max(200).optional(),
  compensationMin: z.coerce.number().min(0).optional(),
  compensationMax: z.coerce.number().min(0).optional(),
  compensationCurrency: z.string().trim().length(3).optional().default('USD'),
  compensationPeriod: optionalEnum(['annual', 'hourly', 'daily', 'monthly']),
  availabilityDate: z.string().trim().optional(),
  noticePeriodDays: z.coerce.number().int().min(0).optional(),
  workplacePreference: optionalEnum(['remote', 'hybrid', 'onsite', 'flexible']),
  recruiterNotes: z.string().trim().max(4000).optional(),
  clientVisibleNotes: z.string().trim().max(4000).optional(),
  // Optional: link the new candidate straight into a project (Build Phase 5
  // brief §"Candidate creation": "Project assignment", "Source tracking").
  projectId: z.string().uuid().optional().or(z.literal('')),
  projectClientId: z.string().uuid().optional().or(z.literal('')),
  sourceChannel: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z
      .enum(['linkedin', 'referral', 'apollo', 'manual', 'csv_import', 'job_board', 'other'])
      .optional()
      .default('manual'),
  ),
  sourceDetail: z.string().trim().max(500).optional(),
})

/**
 * Creates a candidate with an optional immediate profile, one primary
 * contact point per supplied channel, a candidate_sources row, and —
 * only if a project was specified — a candidate_project_entries row at
 * 'discovered' plus its first candidate_pipeline_events row. Every write
 * happens even on partial data: only fullName is required, per the brief's
 * "AI must never invent... Missing information must be marked as
 * unverified" — an empty field is left null, never guessed.
 */
export async function createCandidateAction(formData: FormData): Promise<ActionResult> {
  const raw = Object.fromEntries(formData.entries())
  const parsed = CandidateCoreSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? 'Check the candidate details.',
    }
  }
  const data = parsed.data
  const projectId = data.projectId && data.projectId.length > 0 ? data.projectId : null
  const projectClientId =
    data.projectClientId && data.projectClientId.length > 0 ? data.projectClientId : null
  if (projectId && !projectClientId) {
    return { success: false, message: 'Missing project context.' }
  }

  // Build Phase 18: candidate creation is reachable in the private demo
  // (no Supabase project needed) — writes go to the in-memory demo engine
  // instead, enforcing the same "only name is required, everything else
  // stays honestly unverified" rule as the live path above.
  if (!supabaseConfigured) {
    if (!projectId) {
      return { success: false, message: 'Choose a project to add this candidate to.' }
    }
    const result = addDemoCandidate(
      projectId,
      {
        fullName: data.fullName,
        primaryEmail: data.primaryEmail || undefined,
        primaryPhone: data.primaryPhone || undefined,
        currentTitle: data.currentTitle || undefined,
        currentCompany: data.currentCompany || undefined,
        location: data.location || undefined,
        sourceChannel: data.sourceChannel,
        sourceDetail: data.sourceDetail,
      },
      'Dana Reyes (demo)',
    )
    revalidatePath('/candidates')
    revalidatePath(`/projects/${projectId}`)
    return result
  }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  const membership = await requirePermission(
    user.id,
    data.organizationId,
    'candidate_records',
    'create',
  )
  if (projectId && projectClientId) {
    await requireProjectAccess(user.id, membership, { id: projectId, clientId: projectClientId })
  }

  const { data: candidate, error: candidateError } = await supabase!
    .from('candidates')
    .insert({
      organization_id: data.organizationId,
      full_name: data.fullName,
      primary_email: data.primaryEmail || null,
      primary_phone: data.primaryPhone || null,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (candidateError || !candidate) {
    return { success: false, message: 'Could not create the candidate.' }
  }

  await supabase!.from('candidate_profiles').insert({
    organization_id: data.organizationId,
    candidate_id: candidate.id,
    current_title: data.currentTitle || null,
    current_company: data.currentCompany || null,
    location: data.location || null,
    work_authorization: data.workAuthorization || null,
    compensation_min: data.compensationMin ?? null,
    compensation_max: data.compensationMax ?? null,
    compensation_currency: data.compensationCurrency || 'USD',
    compensation_period: data.compensationPeriod ?? null,
    availability_date: data.availabilityDate || null,
    notice_period_days: data.noticePeriodDays ?? null,
    workplace_preference: data.workplacePreference ?? null,
    recruiter_notes: data.recruiterNotes || null,
    client_visible_notes: data.clientVisibleNotes || null,
    created_by: user.id,
  })

  const contactRows = [
    data.primaryEmail
      ? {
          organization_id: data.organizationId,
          candidate_id: candidate.id,
          type: 'email',
          value: data.primaryEmail,
          normalized_value: data.primaryEmail.trim().toLowerCase(),
          is_primary: true,
          created_by: user.id,
        }
      : null,
    data.primaryPhone
      ? {
          organization_id: data.organizationId,
          candidate_id: candidate.id,
          type: 'phone',
          value: data.primaryPhone,
          normalized_value: data.primaryPhone.replace(/[^0-9]/g, ''),
          is_primary: true,
          created_by: user.id,
        }
      : null,
  ].filter((row): row is NonNullable<typeof row> => row !== null)

  if (contactRows.length > 0) {
    await supabase!.from('candidate_contact_points').insert(contactRows)
  }

  await supabase!.from('candidate_sources').insert({
    organization_id: data.organizationId,
    candidate_id: candidate.id,
    recruitment_project_id: projectId,
    channel: data.sourceChannel,
    source_detail: data.sourceDetail || null,
    sourced_by: user.id,
  })

  if (projectId) {
    await supabase!.from('candidate_project_entries').insert({
      organization_id: data.organizationId,
      candidate_id: candidate.id,
      recruitment_project_id: projectId,
      current_stage: 'discovered',
      added_by: user.id,
    })
    await supabase!.from('candidate_pipeline_events').insert({
      organization_id: data.organizationId,
      candidate_id: candidate.id,
      recruitment_project_id: projectId,
      from_stage: null,
      to_stage: 'discovered',
      actor_id: user.id,
      reason: null,
    })
    await logProjectActivity(
      {
        organizationId: data.organizationId,
        recruitmentProjectId: projectId,
        actorId: user.id,
        action: 'candidate.created',
        summary: `${data.fullName} added to the pipeline.`,
      },
      supabase,
    )
  }

  await logAuditEvent(
    {
      organizationId: data.organizationId,
      actorId: user.id,
      action: 'candidate.created',
      entityType: 'candidates',
      entityId: candidate.id,
      after: { fullName: data.fullName, source: data.sourceChannel },
    },
    supabase,
  )

  revalidatePath('/candidates')
  if (projectId) revalidatePath(`/projects/${projectId}`)
  return { success: true, message: 'Candidate created.' }
}

const ImportCsvSchema = z.object({
  organizationId: z.string().uuid(),
  projectId: z.string().uuid().optional().or(z.literal('')),
  projectClientId: z.string().uuid().optional().or(z.literal('')),
  /** JSON-encoded array of already-reviewed, already-valid CsvCandidateRow objects — the CSV-import-review screen is what produces this, never the raw file re-parsed server-side (the recruiter's edits during review must be respected). */
  rows: z.string().min(1),
})

/**
 * Commits a CSV import batch. Only ever called with rows the recruiter has
 * reviewed on the CSV-import-review screen (Build Phase 5 brief §UI) —
 * server-side re-validation still runs (never trust client-submitted data),
 * but the review step is what lets a recruiter fix a bad row before any
 * database write happens at all, rather than after.
 */
export async function importCandidatesFromCsvAction(formData: FormData): Promise<ActionResult> {
  const parsed = ImportCsvSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }

  let rows: {
    fullName: string
    primaryEmail: string | null
    primaryPhone: string | null
    currentTitle: string | null
    currentCompany: string | null
    location: string | null
  }[]
  try {
    rows = JSON.parse(parsed.data.rows)
  } catch {
    return { success: false, message: 'The reviewed row data was malformed.' }
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return { success: false, message: 'No rows to import.' }
  }

  // Build Phase 18: CSV import is reachable in the private demo — same
  // client-reviewed-rows contract as the live path, written to the demo
  // engine instead of Supabase, with the same duplicate-detection rule.
  if (!supabaseConfigured) {
    const projectId = parsed.data.projectId && parsed.data.projectId.length > 0 ? parsed.data.projectId : null
    if (!projectId) {
      return { success: false, message: 'Choose a project to import these candidates into.' }
    }
    const result = importDemoCandidatesCsv(
      projectId,
      rows.map((r) => ({
        fullName: r.fullName,
        primaryEmail: r.primaryEmail ?? undefined,
        primaryPhone: r.primaryPhone ?? undefined,
        currentTitle: r.currentTitle ?? undefined,
        currentCompany: r.currentCompany ?? undefined,
        location: r.location ?? undefined,
      })),
      'Dana Reyes (demo)',
    )
    revalidatePath('/candidates')
    revalidatePath(`/projects/${projectId}`)
    return result
  }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  const membership = await requirePermission(
    user.id,
    parsed.data.organizationId,
    'candidate_records',
    'create',
  )
  const projectId =
    parsed.data.projectId && parsed.data.projectId.length > 0 ? parsed.data.projectId : null
  const projectClientId =
    parsed.data.projectClientId && parsed.data.projectClientId.length > 0
      ? parsed.data.projectClientId
      : null
  if (projectId && projectClientId) {
    await requireProjectAccess(user.id, membership, { id: projectId, clientId: projectClientId })
  }

  let created = 0
  let failed = 0
  for (const row of rows) {
    if (!row.fullName || row.fullName.trim().length === 0) {
      failed += 1
      continue
    }

    const { data: candidate, error } = await supabase!
      .from('candidates')
      .insert({
        organization_id: parsed.data.organizationId,
        full_name: row.fullName,
        primary_email: row.primaryEmail || null,
        primary_phone: row.primaryPhone || null,
        created_by: user.id,
      })
      .select('id')
      .single()

    if (error || !candidate) {
      failed += 1
      continue
    }

    await supabase!.from('candidate_profiles').insert({
      organization_id: parsed.data.organizationId,
      candidate_id: candidate.id,
      current_title: row.currentTitle || null,
      current_company: row.currentCompany || null,
      location: row.location || null,
      created_by: user.id,
    })

    await supabase!.from('candidate_sources').insert({
      organization_id: parsed.data.organizationId,
      candidate_id: candidate.id,
      recruitment_project_id: projectId,
      channel: 'csv_import',
      sourced_by: user.id,
    })

    if (projectId) {
      await supabase!.from('candidate_project_entries').insert({
        organization_id: parsed.data.organizationId,
        candidate_id: candidate.id,
        recruitment_project_id: projectId,
        current_stage: 'discovered',
        added_by: user.id,
      })
      await supabase!.from('candidate_pipeline_events').insert({
        organization_id: parsed.data.organizationId,
        candidate_id: candidate.id,
        recruitment_project_id: projectId,
        from_stage: null,
        to_stage: 'discovered',
        actor_id: user.id,
      })
    }

    created += 1
  }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'candidate.csv_imported',
      entityType: 'candidates',
      metadata: { created, failed, total: rows.length, projectId },
    },
    supabase,
  )

  revalidatePath('/candidates')
  if (projectId) revalidatePath(`/projects/${projectId}`)
  return {
    success: created > 0,
    message:
      failed > 0
        ? `Imported ${created} of ${rows.length} candidates (${failed} failed).`
        : `Imported ${created} candidate(s).`,
  }
}

const UploadDocumentSchema = z.object({
  organizationId: z.string().uuid(),
  candidateId: z.string().uuid(),
  docType: z.enum(['cv', 'cover_letter', 'reference', 'other']).default('cv'),
})

/**
 * Uploads a CV/cover-letter/reference file (Build Phase 5 brief §"CV
 * document management"). Validates format/size (lib/files/validate.ts),
 * computes a checksum, stores the original via document_uploads (shared
 * with job descriptions), and versions candidate_documents — a new upload
 * of the same doc_type supersedes the prior active version rather than
 * replacing it, so evidence citations against an old CV remain resolvable
 * (docs/07-data-model.md §7.5).
 */
export async function uploadCandidateDocumentAction(formData: FormData): Promise<ActionResult> {
  const parsed = UploadDocumentSchema.safeParse({
    organizationId: formData.get('organizationId'),
    candidateId: formData.get('candidateId'),
    docType: formData.get('docType') || 'cv',
  })
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return { success: false, message: 'Choose a file to upload.' }
  }

  const validation = validateCandidateDocumentFile({
    fileName: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
  })
  if (!validation.valid) {
    return { success: false, message: validation.message ?? 'This file cannot be accepted.' }
  }

  if (!supabaseConfigured) {
    return { success: false, message: 'This environment is not connected to a live database yet.' }
  }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'candidate_documents', 'create')

  const bytes = new Uint8Array(await file.arrayBuffer())
  let uploadResult
  try {
    uploadResult = await uploadDocument(supabase!, {
      organizationId: parsed.data.organizationId,
      ownerType: 'candidate_document',
      ownerId: parsed.data.candidateId,
      fileName: file.name,
      mimeType: file.type,
      bytes,
    })
  } catch {
    return { success: false, message: 'Could not store the uploaded file.' }
  }

  const { data: upload, error: uploadRowError } = await supabase!
    .from('document_uploads')
    .insert({
      organization_id: parsed.data.organizationId,
      owner_type: 'candidate_document',
      owner_id: parsed.data.candidateId,
      storage_path: uploadResult.storagePath,
      file_name: file.name,
      mime_type: file.type,
      size_bytes: uploadResult.sizeBytes,
      checksum_sha256: uploadResult.checksumSha256,
      uploaded_by: user.id,
    })
    .select('id')
    .single()

  if (uploadRowError || !upload) {
    return { success: false, message: 'Could not record the uploaded file.' }
  }

  const { data: priorVersions } = await supabase!
    .from('candidate_documents')
    .select('id, version_no')
    .eq('candidate_id', parsed.data.candidateId)
    .eq('doc_type', parsed.data.docType)
    .order('version_no', { ascending: false })
    .limit(1)

  const nextVersionNo = (priorVersions?.[0]?.version_no ?? 0) + 1

  if (priorVersions && priorVersions.length > 0) {
    await supabase!
      .from('candidate_documents')
      .update({ status: 'superseded', superseded_at: new Date().toISOString() })
      .eq('id', priorVersions[0]!.id)
  }

  const { error: docError } = await supabase!.from('candidate_documents').insert({
    organization_id: parsed.data.organizationId,
    candidate_id: parsed.data.candidateId,
    document_upload_id: upload.id,
    doc_type: parsed.data.docType,
    version_no: nextVersionNo,
    created_by: user.id,
  })

  if (docError) {
    return { success: false, message: 'Could not link the uploaded file to the candidate.' }
  }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'candidate.document_uploaded',
      entityType: 'candidate_documents',
      entityId: parsed.data.candidateId,
      metadata: {
        docType: parsed.data.docType,
        versionNo: nextVersionNo,
        checksum: uploadResult.checksumSha256,
      },
    },
    supabase,
  )

  revalidatePath(`/candidates/${parsed.data.candidateId}`)
  return { success: true, message: `Uploaded ${parsed.data.docType} (version ${nextVersionNo}).` }
}

const UpdateCandidateSchema = CandidateCoreSchema.omit({
  projectId: true,
  projectClientId: true,
  sourceChannel: true,
  sourceDetail: true,
}).extend({
  candidateId: z.string().uuid(),
})

/** Edits both candidates' core identity fields and its candidate_profiles row in one call — the candidate detail screen's single edit form. */
export async function updateCandidateAction(formData: FormData): Promise<ActionResult> {
  const parsed = UpdateCandidateSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? 'Check the candidate details.',
    }
  }
  if (!supabaseConfigured) {
    return { success: false, message: 'This environment is not connected to a live database yet.' }
  }

  const data = parsed.data
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, data.organizationId, 'candidate_records', 'update')

  const { error: candidateError } = await supabase!
    .from('candidates')
    .update({
      full_name: data.fullName,
      primary_email: data.primaryEmail || null,
      primary_phone: data.primaryPhone || null,
    })
    .eq('id', data.candidateId)
    .eq('organization_id', data.organizationId)

  if (candidateError) return { success: false, message: 'Could not save the candidate.' }

  await supabase!
    .from('candidate_profiles')
    .update({
      current_title: data.currentTitle || null,
      current_company: data.currentCompany || null,
      location: data.location || null,
      work_authorization: data.workAuthorization || null,
      compensation_min: data.compensationMin ?? null,
      compensation_max: data.compensationMax ?? null,
      compensation_currency: data.compensationCurrency || 'USD',
      compensation_period: data.compensationPeriod ?? null,
      availability_date: data.availabilityDate || null,
      notice_period_days: data.noticePeriodDays ?? null,
      workplace_preference: data.workplacePreference ?? null,
      recruiter_notes: data.recruiterNotes || null,
      client_visible_notes: data.clientVisibleNotes || null,
    })
    .eq('candidate_id', data.candidateId)
    .eq('organization_id', data.organizationId)

  await logAuditEvent(
    {
      organizationId: data.organizationId,
      actorId: user.id,
      action: 'candidate.updated',
      entityType: 'candidates',
      entityId: data.candidateId,
    },
    supabase,
  )

  revalidatePath(`/candidates/${data.candidateId}`)
  return { success: true, message: 'Candidate updated.' }
}

const ArchiveCandidateSchema = z.object({
  organizationId: z.string().uuid(),
  candidateId: z.string().uuid(),
})

/** Archives a candidate (Build Phase 5 brief §PRIVACY: "Support archive ... status"). Soft — the row and all its history are kept. */
export async function archiveCandidateAction(formData: FormData): Promise<ActionResult> {
  const parsed = ArchiveCandidateSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured) {
    return { success: false, message: 'This environment is not connected to a live database yet.' }
  }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'candidate_records', 'delete')

  const { error } = await supabase!
    .from('candidates')
    .update({ status: 'archived' })
    .eq('id', parsed.data.candidateId)
    .eq('organization_id', parsed.data.organizationId)

  if (error) return { success: false, message: 'Could not archive this candidate.' }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'candidate.archived',
      entityType: 'candidates',
      entityId: parsed.data.candidateId,
    },
    supabase,
  )

  revalidatePath('/candidates')
  revalidatePath(`/candidates/${parsed.data.candidateId}`)
  return { success: true, message: 'Candidate archived.' }
}

const RequestDeletionSchema = z.object({
  organizationId: z.string().uuid(),
  candidateId: z.string().uuid(),
  reason: z.string().trim().max(1000).optional(),
})

/**
 * Records a data-deletion request (Build Phase 5 brief §PRIVACY: "Support
 * ... deletion-request status"). Does NOT itself erase any data — actually
 * fulfilling a deletion request is a separate, explicitly audited admin
 * action reserved for a later phase once a data-retention policy exists
 * (docs/07-data-model.md §7.6; see docs/build-phase-5-report.md's blockers).
 * This is the honest, non-destructive half of that requirement: the request
 * is durably recorded and the candidate's status reflects it immediately.
 */
export async function requestCandidateDeletionAction(formData: FormData): Promise<ActionResult> {
  const parsed = RequestDeletionSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured) {
    return { success: false, message: 'This environment is not connected to a live database yet.' }
  }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'candidate_records', 'delete')

  const { error: candidateError } = await supabase!
    .from('candidates')
    .update({ status: 'deletion_requested' })
    .eq('id', parsed.data.candidateId)
    .eq('organization_id', parsed.data.organizationId)

  if (candidateError) return { success: false, message: 'Could not record the deletion request.' }

  await supabase!.from('candidate_consents').upsert(
    {
      organization_id: parsed.data.organizationId,
      candidate_id: parsed.data.candidateId,
      deletion_requested: true,
      deletion_requested_at: new Date().toISOString(),
      deletion_requested_by: user.id,
      deletion_reason: parsed.data.reason || null,
    },
    { onConflict: 'candidate_id' },
  )

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'candidate.deletion_requested',
      entityType: 'candidates',
      entityId: parsed.data.candidateId,
      metadata: { reason: parsed.data.reason ?? null },
    },
    supabase,
  )

  revalidatePath(`/candidates/${parsed.data.candidateId}`)
  return { success: true, message: 'Deletion request recorded.' }
}
