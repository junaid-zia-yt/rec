'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { supabaseConfigured } from '@/lib/env'
import { logAuditEvent } from '@/lib/audit/log'
import { GENERIC_AUTH_ERROR_MESSAGE } from '@/lib/auth/errors'
import { requirePermission } from '@/lib/auth/session'
import { requireProjectAccess } from '@/lib/auth/project-access'
import { enqueueJob } from '@/lib/jobs/enqueue'
import { executeJob } from '@/lib/jobs/executor'
import { DEFAULT_JOB_HANDLERS } from '@/lib/jobs/handlers'
import type { AiExtractionResult } from '@/lib/jobs/handlers/ai-extraction'
import { nextRequirementStatusAfterEdit } from './edit-rules'
import type { ActionResult } from '@/lib/auth/actions'

/**
 * Job-requirement server actions (Build Phase 4 brief §AI WORKFLOW /
 * §PERMISSIONS). AI extraction never writes anything the human reviewer
 * cannot see and change: every AI-proposed row lands in job_requirements
 * with status='proposed' and ai_generated=true, and this module's edit/
 * delete/reclassify actions are the ONLY way those rows are promoted,
 * corrected, or removed — the AI has no path to update or approve its own
 * output. "Approval" itself (moving a set of requirements into an active
 * scorecard version) lives in lib/scorecards/actions.ts, one deliberate
 * layer further from the AI call.
 */

const RunExtractionSchema = z.object({
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  projectClientId: z.string().uuid(),
  jobId: z.string().uuid(),
  jobDescriptionId: z.string().uuid(),
})

/**
 * Runs AI requirement extraction against one job description version (Build
 * Phase 4 brief §AI WORKFLOW). Loads trusted job metadata and the untrusted
 * document text itself (never anything from the request body), then hands
 * the actual AI call + every resulting write off to the durable job engine
 * (Build Phase 14, Wave 4b — see `lib/jobs/handlers/ai-extraction.ts`'s own
 * header note) via `enqueueJob` immediately followed by `executeJob` in this
 * same request ("enqueue and try now" — common-case behavior for the
 * caller/UI is unchanged: this still returns the final result synchronously
 * before the request completes; what changed is that the job engine's own
 * retry/backoff/dead-letter bookkeeping now sits around the AI call).
 * `requirement_extraction_results` remains the domain source of truth the
 * UI reads — the handler writes it exactly as this action used to.
 */
export async function runRequirementExtractionAction(formData: FormData): Promise<ActionResult> {
  const parsed = RunExtractionSchema.safeParse({
    organizationId: formData.get('organizationId'),
    projectId: formData.get('projectId'),
    projectClientId: formData.get('projectClientId'),
    jobId: formData.get('jobId'),
    jobDescriptionId: formData.get('jobDescriptionId'),
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

  const membership = await requirePermission(
    user.id,
    parsed.data.organizationId,
    'scorecards',
    'create',
  )
  await requireProjectAccess(user.id, membership, {
    id: parsed.data.projectId,
    clientId: parsed.data.projectClientId,
  })

  const [{ data: job }, { data: jobDescription }] = await Promise.all([
    supabase!
      .from('jobs')
      .select('title, department, industry, employment_type, workplace_arrangement, location')
      .eq('id', parsed.data.jobId)
      .single(),
    supabase!
      .from('job_descriptions')
      .select('raw_text')
      .eq('id', parsed.data.jobDescriptionId)
      .single(),
  ])

  if (!job) return { success: false, message: 'This job could not be found.' }
  if (!jobDescription?.raw_text) {
    return {
      success: false,
      message:
        'This job description has no extractable text yet — an uploaded file needs its text extracted first, which is not available in this environment.',
    }
  }

  // Own idempotency key for this workflow (none existed before this wave —
  // requirement extraction never checked for an in-flight/duplicate attempt
  // the way matching/document-processing already did). Constructed the same
  // way those two workflows' own keys are: a per-target monotonic attempt
  // number, so a genuine double-submit for the SAME job description dedupes
  // at enqueueJob's (organizationId, jobType, idempotencyKey) layer instead
  // of silently running the AI call twice.
  const { data: priorResults } = await supabase!
    .from('requirement_extraction_results')
    .select('id')
    .eq('job_description_id', parsed.data.jobDescriptionId)
  const attemptNo = (priorResults?.length ?? 0) + 1
  const idempotencyKey = `${parsed.data.jobDescriptionId}:${attemptNo}`

  const { job: bgJob } = await enqueueJob({
    organizationId: parsed.data.organizationId,
    jobType: 'ai_extraction',
    payload: {
      targetType: 'job_description',
      targetId: parsed.data.jobDescriptionId,
      jobId: parsed.data.jobId,
      recruitmentProjectId: parsed.data.projectId,
    },
    idempotencyKey,
    supabase: supabase!,
    userId: user.id,
  })

  const outcome = await executeJob({
    jobId: bgJob.id,
    supabase: supabase!,
    handlers: DEFAULT_JOB_HANDLERS,
  })

  revalidatePath(`/projects/${parsed.data.projectId}/scorecard`)

  switch (outcome.kind) {
    case 'succeeded': {
      const result = outcome.result as AiExtractionResult
      return { success: result.status === 'success', message: result.message }
    }
    case 'failed_will_retry':
      return {
        success: false,
        message:
          'AI extraction failed and will be retried automatically. You can add requirements manually below.',
      }
    case 'dead_lettered':
      return {
        success: false,
        message:
          'AI extraction failed after multiple attempts. You can add requirements manually below.',
      }
    case 'not_claimed':
      return {
        success: false,
        message: 'Could not start the extraction — it may already be running.',
      }
    case 'no_handler':
    default:
      return {
        success: false,
        message: 'AI requirement extraction is not available in this environment.',
      }
  }
}

const CreateRequirementSchema = z.object({
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  projectClientId: z.string().uuid(),
  jobId: z.string().uuid(),
  name: z.string().trim().min(1, 'Name is required.').max(200),
  description: z.string().trim().max(2000).default(''),
  category: z.string().trim().max(100).default(''),
  type: z.enum([
    'mandatory',
    'preferred',
    'informational',
    'disqualifying',
    'requires_clarification',
  ]),
  weight: z.coerce.number().min(0).max(100).nullable().optional(),
  evidenceExpected: z.string().trim().max(500).default(''),
})

/** Adds a requirement with no AI involvement at all (Build Phase 4 brief §UI: requirement classification controls / manual authoring). */
export async function createRequirementAction(formData: FormData): Promise<ActionResult> {
  const rawWeight = formData.get('weight')
  const parsed = CreateRequirementSchema.safeParse({
    organizationId: formData.get('organizationId'),
    projectId: formData.get('projectId'),
    projectClientId: formData.get('projectClientId'),
    jobId: formData.get('jobId'),
    name: formData.get('name'),
    description: formData.get('description') ?? '',
    category: formData.get('category') ?? '',
    type: formData.get('type'),
    weight: rawWeight ? rawWeight : null,
    evidenceExpected: formData.get('evidenceExpected') ?? '',
  })
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? 'Check the requirement details.',
    }
  }
  if (parsed.data.type !== 'preferred' && parsed.data.weight != null) {
    return { success: false, message: 'Only a preferred requirement may have a weight.' }
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
    'scorecards',
    'create',
  )
  await requireProjectAccess(user.id, membership, {
    id: parsed.data.projectId,
    clientId: parsed.data.projectClientId,
  })

  const { data: requirement, error } = await supabase!
    .from('job_requirements')
    .insert({
      organization_id: parsed.data.organizationId,
      job_id: parsed.data.jobId,
      name: parsed.data.name,
      description: parsed.data.description,
      category: parsed.data.category,
      type: parsed.data.type,
      weight: parsed.data.type === 'preferred' ? (parsed.data.weight ?? null) : null,
      evidence_expected: parsed.data.evidenceExpected,
      verification_status: 'unverified',
      status: 'manually_added',
      ai_generated: false,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error || !requirement) {
    return { success: false, message: 'Could not add the requirement.' }
  }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'requirement.created',
      entityType: 'job_requirements',
      entityId: requirement.id,
      after: { name: parsed.data.name, type: parsed.data.type },
    },
    supabase,
  )

  revalidatePath(`/projects/${parsed.data.projectId}/scorecard`)
  return { success: true, message: 'Requirement added.' }
}

const UpdateRequirementSchema = z.object({
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  projectClientId: z.string().uuid(),
  requirementId: z.string().uuid(),
  name: z.string().trim().min(1, 'Name is required.').max(200),
  description: z.string().trim().max(2000).default(''),
  category: z.string().trim().max(100).default(''),
  type: z.enum([
    'mandatory',
    'preferred',
    'informational',
    'disqualifying',
    'requires_clarification',
  ]),
  weight: z.coerce.number().min(0).max(100).nullable().optional(),
  evidenceExpected: z.string().trim().max(500).default(''),
  reviewerNotes: z.string().trim().max(2000).optional(),
})

/**
 * Edits a requirement — including reclassifying its type and adjusting its
 * weight (Build Phase 4 brief §UI: "Requirement classification controls",
 * "Weight editor"). Any edit to a proposed AI requirement marks it
 * `reviewed`, which is how the UI distinguishes "AI proposed, unreviewed"
 * from "a human has looked at and confirmed/changed this" without losing
 * `ai_generated`'s honest record of where the row originated.
 */
export async function updateRequirementAction(formData: FormData): Promise<ActionResult> {
  const rawWeight = formData.get('weight')
  const parsed = UpdateRequirementSchema.safeParse({
    organizationId: formData.get('organizationId'),
    projectId: formData.get('projectId'),
    projectClientId: formData.get('projectClientId'),
    requirementId: formData.get('requirementId'),
    name: formData.get('name'),
    description: formData.get('description') ?? '',
    category: formData.get('category') ?? '',
    type: formData.get('type'),
    weight: rawWeight ? rawWeight : null,
    evidenceExpected: formData.get('evidenceExpected') ?? '',
    reviewerNotes: formData.get('reviewerNotes') ?? undefined,
  })
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? 'Check the requirement details.',
    }
  }
  if (parsed.data.type !== 'preferred' && parsed.data.weight != null) {
    return { success: false, message: 'Only a preferred requirement may have a weight.' }
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
    'scorecards',
    'update',
  )
  await requireProjectAccess(user.id, membership, {
    id: parsed.data.projectId,
    clientId: parsed.data.projectClientId,
  })

  const { data: before } = await supabase!
    .from('job_requirements')
    .select('name, type, weight, status')
    .eq('id', parsed.data.requirementId)
    .single()

  const reclassified = Boolean(before && before.type !== parsed.data.type)

  const { error } = await supabase!
    .from('job_requirements')
    .update({
      name: parsed.data.name,
      description: parsed.data.description,
      category: parsed.data.category,
      type: parsed.data.type,
      weight: parsed.data.type === 'preferred' ? (parsed.data.weight ?? null) : null,
      evidence_expected: parsed.data.evidenceExpected,
      reviewer_notes: parsed.data.reviewerNotes ?? null,
      status: nextRequirementStatusAfterEdit(before?.status ?? 'proposed'),
      // ai_generated is deliberately never written here — an edit changes
      // review status, never who originated the content.
    })
    .eq('id', parsed.data.requirementId)
    .eq('organization_id', parsed.data.organizationId)

  if (error) return { success: false, message: 'Could not save the changes.' }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: reclassified ? 'requirement.reclassified' : 'requirement.updated',
      entityType: 'job_requirements',
      entityId: parsed.data.requirementId,
      before: before ? { name: before.name, type: before.type, weight: before.weight } : null,
      after: { name: parsed.data.name, type: parsed.data.type, weight: parsed.data.weight ?? null },
    },
    supabase,
  )

  revalidatePath(`/projects/${parsed.data.projectId}/scorecard`)
  return { success: true, message: 'Requirement updated.' }
}

const DeleteRequirementSchema = z.object({
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  projectClientId: z.string().uuid(),
  requirementId: z.string().uuid(),
})

export async function deleteRequirementAction(formData: FormData): Promise<ActionResult> {
  const parsed = DeleteRequirementSchema.safeParse({
    organizationId: formData.get('organizationId'),
    projectId: formData.get('projectId'),
    projectClientId: formData.get('projectClientId'),
    requirementId: formData.get('requirementId'),
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

  const membership = await requirePermission(
    user.id,
    parsed.data.organizationId,
    'scorecards',
    'delete',
  )
  await requireProjectAccess(user.id, membership, {
    id: parsed.data.projectId,
    clientId: parsed.data.projectClientId,
  })

  const { data: before } = await supabase!
    .from('job_requirements')
    .select('name, type')
    .eq('id', parsed.data.requirementId)
    .single()

  const { error } = await supabase!
    .from('job_requirements')
    .delete()
    .eq('id', parsed.data.requirementId)
    .eq('organization_id', parsed.data.organizationId)

  if (error) return { success: false, message: 'Could not delete the requirement.' }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'requirement.deleted',
      entityType: 'job_requirements',
      entityId: parsed.data.requirementId,
      before: before ? { name: before.name, type: before.type } : null,
    },
    supabase,
  )

  revalidatePath(`/projects/${parsed.data.projectId}/scorecard`)
  return { success: true, message: 'Requirement deleted.' }
}
