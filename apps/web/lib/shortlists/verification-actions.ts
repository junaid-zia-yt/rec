'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { supabaseConfigured } from '@/lib/env'
import { logAuditEvent } from '@/lib/audit/log'
import { GENERIC_AUTH_ERROR_MESSAGE } from '@/lib/auth/errors'
import { requirePermission } from '@/lib/auth/session'
import type { ActionResult } from '@/lib/auth/actions'
import { notifyVerificationRequested } from '@/lib/notifications/event-triggers'

/**
 * Candidate-level verification-request workflow (Build Phase 8 brief
 * §"Reviewer decisions": "Request verification"; §UI: "Verification-request
 * workflow"). Same 'use server' + Zod + requirePermission + Supabase write
 * + logAuditEvent + revalidatePath + ActionResult shape as
 * apps/web/lib/matching/matching-actions.ts. Gated on 'human_reviews'
 * (full = agency_admin/recruiter), same as every other reviewer decision —
 * a client_decision_maker never opens or resolves a verification request.
 */

const OpenVerificationRequestSchema = z.object({
  organizationId: z.string().uuid(),
  candidateId: z.string().uuid(),
  candidateRoleMatchId: z.string().uuid(),
  requirementId: z.string().uuid().optional(),
  note: z.string().trim().min(1, 'A note is required to request verification.').max(1000),
})

export async function openVerificationRequestAction(formData: FormData): Promise<ActionResult> {
  const parsed = OpenVerificationRequestSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? 'Check the form and try again.',
    }
  }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'human_reviews', 'update')

  const { data: match } = await supabase!
    .from('candidate_role_matches')
    .select('latest_matching_run_id')
    .eq('id', parsed.data.candidateRoleMatchId)
    .single()
  if (!match)
    return { success: false, message: 'Could not find the match record for this request.' }

  const { data: humanReview } = await supabase!
    .from('human_reviews')
    .insert({
      organization_id: parsed.data.organizationId,
      candidate_role_match_id: parsed.data.candidateRoleMatchId,
      matching_run_id: match.latest_matching_run_id,
      reviewer_id: user.id,
      decision: 'requires_verification',
      reason: parsed.data.note,
    })
    .select('id')
    .single()

  const { data: request, error } = await supabase!
    .from('verification_requests')
    .insert({
      organization_id: parsed.data.organizationId,
      candidate_role_match_id: parsed.data.candidateRoleMatchId,
      human_review_id: humanReview?.id ?? null,
      requirement_id: parsed.data.requirementId ?? null,
      requested_by: user.id,
      request_note: parsed.data.note,
    })
    .select('id')
    .single()

  if (error || !request)
    return { success: false, message: 'Could not open the verification request.' }

  await supabase!
    .from('candidate_role_matches')
    .update({
      review_status: 'requires_verification',
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.candidateRoleMatchId)
    .eq('organization_id', parsed.data.organizationId)

  // Build Phase 12, Wave 5 (small, justified addition — Task A): the
  // verification_requests row above is the actual "opened" event.
  // Best-effort, same try/catch-and-log pattern as every other wired
  // trigger this wave.
  try {
    const [{ data: matchDetail }, { data: candidate }] = await Promise.all([
      supabase!
        .from('candidate_role_matches')
        .select('recruitment_project_id')
        .eq('id', parsed.data.candidateRoleMatchId)
        .maybeSingle(),
      supabase!
        .from('candidates')
        .select('full_name')
        .eq('id', parsed.data.candidateId)
        .maybeSingle(),
    ])
    if (matchDetail?.recruitment_project_id) {
      await notifyVerificationRequested({
        organizationId: parsed.data.organizationId,
        actorUserId: user.id,
        verificationRequestId: request.id,
        recruitmentProjectId: matchDetail.recruitment_project_id as string,
        candidateName: (candidate?.full_name as string | undefined) ?? 'A candidate',
        supabase: supabase!,
      })
    }
  } catch (notifyError) {
    console.error(
      '[verification] notifyVerificationRequested failed:',
      notifyError instanceof Error ? notifyError.message : notifyError,
    )
  }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'candidate_match.verification_requested',
      entityType: 'verification_requests',
      entityId: request.id,
      metadata: { candidateRoleMatchId: parsed.data.candidateRoleMatchId, note: parsed.data.note },
    },
    supabase!,
  )

  revalidatePath(`/candidates/${parsed.data.candidateId}`)
  return { success: true, message: 'Verification requested.' }
}

const ResolveVerificationRequestSchema = z.object({
  organizationId: z.string().uuid(),
  candidateId: z.string().uuid(),
  verificationRequestId: z.string().uuid(),
  outcome: z.enum(['resolved', 'cancelled']),
  resolutionNote: z.string().trim().min(1, 'A resolution note is required.').max(1000),
})

/** Closes an open verification_requests row once a recruiter has followed up (found or ruled out the missing evidence). Never auto-resolves — always a deliberate human action with a note. */
export async function resolveVerificationRequestAction(formData: FormData): Promise<ActionResult> {
  const parsed = ResolveVerificationRequestSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? 'Check the form and try again.',
    }
  }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'human_reviews', 'update')

  const { data: request, error } = await supabase!
    .from('verification_requests')
    .update({
      status: parsed.data.outcome,
      resolved_by: user.id,
      resolved_at: new Date().toISOString(),
      resolution_note: parsed.data.resolutionNote,
    })
    .eq('id', parsed.data.verificationRequestId)
    .eq('organization_id', parsed.data.organizationId)
    .select('id')
    .single()

  if (error || !request)
    return { success: false, message: 'Could not resolve the verification request.' }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'candidate_match.verification_resolved',
      entityType: 'verification_requests',
      entityId: request.id,
      metadata: { outcome: parsed.data.outcome, resolutionNote: parsed.data.resolutionNote },
    },
    supabase!,
  )

  revalidatePath(`/candidates/${parsed.data.candidateId}`)
  return { success: true, message: 'Verification request resolved.' }
}

const ConfirmCandidateInterestSchema = z.object({
  organizationId: z.string().uuid(),
  candidateId: z.string().uuid(),
  recruitmentProjectId: z.string().uuid(),
  interestStatus: z.enum(['interested', 'declined']),
  note: z.string().trim().max(1000).optional(),
})

/** Brief workflow step "Candidate Interest Confirmed" — recorded by a recruiter from an outreach response, never inferred by AI (docs/09-ai-architecture.md §9.3). */
export async function confirmCandidateInterestAction(formData: FormData): Promise<ActionResult> {
  const parsed = ConfirmCandidateInterestSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'candidate_records', 'update')

  const { error } = await supabase!
    .from('candidate_project_entries')
    .update({
      interest_status: parsed.data.interestStatus,
      interest_confirmed_by: user.id,
      interest_confirmed_at: new Date().toISOString(),
      interest_note: parsed.data.note ?? null,
    })
    .eq('candidate_id', parsed.data.candidateId)
    .eq('recruitment_project_id', parsed.data.recruitmentProjectId)
    .eq('organization_id', parsed.data.organizationId)

  if (error) return { success: false, message: 'Could not record candidate interest.' }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'candidate_match.interest_confirmed',
      entityType: 'candidate_project_entries',
      entityId: parsed.data.candidateId,
      metadata: { interestStatus: parsed.data.interestStatus, note: parsed.data.note },
    },
    supabase!,
  )

  revalidatePath(`/candidates/${parsed.data.candidateId}`)
  return { success: true, message: 'Candidate interest recorded.' }
}
