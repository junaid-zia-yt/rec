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
import { checkPipelineTransition, nextClientVisible, transitionRequiresReason } from './pipeline'
import type { CandidatePipelineStage } from '@rqi/types'
import type { ActionResult } from '@/lib/auth/actions'

const PIPELINE_STAGES = [
  'discovered',
  'eligibility_check',
  'scored',
  'quality_review',
  'outreach',
  'shortlisted',
  'rejected',
  'withdrawn',
] as const

const AssignToProjectSchema = z.object({
  organizationId: z.string().uuid(),
  candidateId: z.string().uuid(),
  projectId: z.string().uuid(),
  projectClientId: z.string().uuid(),
  jobId: z.string().uuid().optional().or(z.literal('')),
})

/** Links an existing (already-sourced) candidate into a project's pipeline, starting at 'discovered' — Build Phase 5 brief §"Candidate creation": "Project assignment". */
export async function assignCandidateToProjectAction(formData: FormData): Promise<ActionResult> {
  const parsed = AssignToProjectSchema.safeParse(Object.fromEntries(formData.entries()))
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
    'candidate_records',
    'update',
  )
  await requireProjectAccess(user.id, membership, {
    id: parsed.data.projectId,
    clientId: parsed.data.projectClientId,
  })

  const jobId = parsed.data.jobId && parsed.data.jobId.length > 0 ? parsed.data.jobId : null

  const { error } = await supabase!.from('candidate_project_entries').insert({
    organization_id: parsed.data.organizationId,
    candidate_id: parsed.data.candidateId,
    recruitment_project_id: parsed.data.projectId,
    job_id: jobId,
    current_stage: 'discovered',
    added_by: user.id,
  })

  if (error) {
    return {
      success: false,
      message:
        error.code === '23505'
          ? 'This candidate is already in this project.'
          : 'Could not assign the candidate.',
    }
  }

  await supabase!.from('candidate_pipeline_events').insert({
    organization_id: parsed.data.organizationId,
    candidate_id: parsed.data.candidateId,
    recruitment_project_id: parsed.data.projectId,
    from_stage: null,
    to_stage: 'discovered',
    actor_id: user.id,
  })

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'candidate.assigned_to_project',
      entityType: 'candidate_project_entries',
      entityId: parsed.data.candidateId,
      metadata: { projectId: parsed.data.projectId, jobId },
    },
    supabase,
  )
  await logProjectActivity(
    {
      organizationId: parsed.data.organizationId,
      recruitmentProjectId: parsed.data.projectId,
      actorId: user.id,
      action: 'candidate.assigned_to_project',
      summary: 'A candidate was added to this project’s pipeline.',
    },
    supabase,
  )

  revalidatePath(`/candidates/${parsed.data.candidateId}`)
  revalidatePath(`/projects/${parsed.data.projectId}`)
  return { success: true, message: 'Candidate added to the project pipeline.' }
}

const TransitionStageSchema = z.object({
  organizationId: z.string().uuid(),
  candidateId: z.string().uuid(),
  projectId: z.string().uuid(),
  projectClientId: z.string().uuid(),
  toStage: z.enum(PIPELINE_STAGES),
  reason: z.string().trim().max(1000).optional(),
})

/**
 * Moves a candidate's pipeline stage within one project (Build Phase 5
 * brief §"Pipeline stages"). Every transition: permission-checked
 * (requirePermission + requireProjectAccess), timestamped (created_at
 * default), records the actor (actor_id = auth.uid(), never spoofable —
 * same RLS-backed guarantee as every other append-only table in this
 * repo), records a reason when the brief requires one (terminal stages),
 * and produces both a candidate_pipeline_events row and an audit_events
 * row. The transition itself is validated by the pure, unit-tested
 * checkPipelineTransition — invalid transitions (skipped stages, out of a
 * terminal stage) never reach the database.
 */
export async function transitionCandidateStageAction(formData: FormData): Promise<ActionResult> {
  const parsed = TransitionStageSchema.safeParse(Object.fromEntries(formData.entries()))
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
    'candidate_records',
    'update',
  )
  await requireProjectAccess(user.id, membership, {
    id: parsed.data.projectId,
    clientId: parsed.data.projectClientId,
  })

  const { data: entry } = await supabase!
    .from('candidate_project_entries')
    .select('current_stage, client_visible')
    .eq('candidate_id', parsed.data.candidateId)
    .eq('recruitment_project_id', parsed.data.projectId)
    .single()

  if (!entry) {
    return { success: false, message: 'This candidate is not in this project.' }
  }

  const fromStage = entry.current_stage as CandidatePipelineStage
  const toStage = parsed.data.toStage as CandidatePipelineStage

  const check = checkPipelineTransition(fromStage, toStage)
  if (!check.valid) {
    return { success: false, message: check.reason ?? 'This transition is not allowed.' }
  }

  if (transitionRequiresReason(toStage) && !parsed.data.reason) {
    return { success: false, message: 'A reason is required to reject or withdraw a candidate.' }
  }

  const clientVisible = nextClientVisible(toStage, entry.client_visible as boolean)

  const { error: updateError } = await supabase!
    .from('candidate_project_entries')
    .update({ current_stage: toStage, client_visible: clientVisible })
    .eq('candidate_id', parsed.data.candidateId)
    .eq('recruitment_project_id', parsed.data.projectId)

  if (updateError) return { success: false, message: 'Could not update the candidate’s stage.' }

  await supabase!.from('candidate_pipeline_events').insert({
    organization_id: parsed.data.organizationId,
    candidate_id: parsed.data.candidateId,
    recruitment_project_id: parsed.data.projectId,
    from_stage: fromStage,
    to_stage: toStage,
    actor_id: user.id,
    reason: parsed.data.reason || null,
  })

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'candidate.stage_transitioned',
      entityType: 'candidate_project_entries',
      entityId: parsed.data.candidateId,
      before: { stage: fromStage },
      after: { stage: toStage, clientVisible },
      metadata: { reason: parsed.data.reason ?? null },
    },
    supabase,
  )
  await logProjectActivity(
    {
      organizationId: parsed.data.organizationId,
      recruitmentProjectId: parsed.data.projectId,
      actorId: user.id,
      action: 'candidate.stage_transitioned',
      summary: `A candidate moved from ${fromStage.replace('_', ' ')} to ${toStage.replace('_', ' ')}.`,
    },
    supabase,
  )

  revalidatePath(`/candidates/${parsed.data.candidateId}`)
  revalidatePath(`/projects/${parsed.data.projectId}`)
  return { success: true, message: `Moved to ${toStage.replace('_', ' ')}.` }
}

const ShareWithClientSchema = z.object({
  organizationId: z.string().uuid(),
  candidateId: z.string().uuid(),
  projectId: z.string().uuid(),
  projectClientId: z.string().uuid(),
  clientVisible: z.coerce.boolean(),
})

/** Explicitly shares (or unshares) a candidate with the client reviewer for one project, independent of pipeline stage — Build Phase 5 brief §PRIVACY: "... or explicitly shared candidates." agency_admin/recruiter only; a client reviewer can never set this for themselves. */
export async function setCandidateClientVisibilityAction(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = ShareWithClientSchema.safeParse(Object.fromEntries(formData.entries()))
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
    'candidate_records',
    'update',
  )
  await requireProjectAccess(user.id, membership, {
    id: parsed.data.projectId,
    clientId: parsed.data.projectClientId,
  })

  const { error } = await supabase!
    .from('candidate_project_entries')
    .update({ client_visible: parsed.data.clientVisible })
    .eq('candidate_id', parsed.data.candidateId)
    .eq('recruitment_project_id', parsed.data.projectId)

  if (error) return { success: false, message: 'Could not change client visibility.' }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'candidate.stage_transitioned',
      entityType: 'candidate_project_entries',
      entityId: parsed.data.candidateId,
      metadata: { clientVisible: parsed.data.clientVisible, explicitShare: true },
    },
    supabase,
  )

  revalidatePath(`/candidates/${parsed.data.candidateId}`)
  return {
    success: true,
    message: parsed.data.clientVisible
      ? 'Shared with the client.'
      : 'No longer shared with the client.',
  }
}
