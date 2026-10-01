'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { supabaseConfigured } from '@/lib/env'
import { logAuditEvent } from '@/lib/audit/log'
import { GENERIC_AUTH_ERROR_MESSAGE } from '@/lib/auth/errors'
import { requirePermission } from '@/lib/auth/session'
import type { ActionResult } from '@/lib/auth/actions'
import type {
  CommunicationChannel,
  CommunicationPreferenceStatus,
  OutreachMessageStatus,
  CandidateResponseClassification,
} from '@rqi/types'
import { runOutreachDraftGeneration } from '@/lib/ai/run-outreach-draft-generation'
import { runResponseClassification } from '@/lib/ai/run-response-classification'
import { validateOutreachDraftEvidence } from './unsupported-claims'
import { checkOutreachOptOutGate } from './opt-out'
import { canTransitionOutreachMessageStatus } from './status-transitions'
import { generateOutreachIdempotencyKey } from './idempotency'
import { getEmailChannelAdapter } from './channels/email'
import {
  buildLinkedInManualSendRecord,
  buildLinkedInManualResponseRecord,
} from './channels/linkedin'
import { loadCandidateVerifiedEvidenceBundle } from './evidence'
import {
  notifyOutreachAwaitingApproval,
  notifyCandidateResponded,
} from '@/lib/notifications/event-triggers'

/**
 * Outreach server actions (Build Phase 9 Wave 3, brief Task A). Same
 * 'use server' + Zod + requirePermission + Supabase write + logAuditEvent +
 * revalidatePath + ActionResult shape as apps/web/lib/shortlists/
 * shortlist-actions.ts — every write here follows that exact template.
 *
 * PERMISSIONS NOTE (documented per the task brief's explicit instruction to
 * verify this before writing the first action): packages/types/src/
 * permissions.ts's 'outreach' resource row is
 * `{ agency_admin: 'full', recruiter: 'full', client_decision_maker: 'none',
 * read_only_reviewer: 'read' }`. hasPermission()'s 'full' branch is
 * `action !== 'approve'` — 'full' grants create/read/update/delete but
 * NEVER 'approve'. No role has the 'approve' PermissionLevel on 'outreach'
 * at all (contrast 'shortlists', which gives client_decision_maker
 * 'approve'). So EVERY approval-gated write in this file — including
 * recordOutreachApprovalAction, which records an approve/reject/
 * changes_requested DECISION — is gated on the 'update' ACTION, never
 * 'approve', mirroring exactly how internallyApproveShortlistAction was
 * fixed in Build Phase 8 (see that file's own comment on the same issue).
 * Gating any outreach write on 'approve' would make it uncallable by any
 * role and is therefore always wrong here.
 *
 * AI_RUNS JUDGMENT CALL: outreach_messages.ai_run_id and candidate_
 * responses.ai_run_id both reference public.ai_runs(id) on delete set
 * null (nullable). ai_runs.workflow_type carries a DB CHECK constraint
 * (supabase/migrations/0017, extended by 0027) admitting only
 * 'requirement_extraction' | 'candidate_document_extraction' |
 * 'candidate_matching' — migration 0029 (this wave's own schema) does NOT
 * extend that constraint to admit an outreach-drafting or response-
 * classification workflow type, and this wave's brief forbids touching
 * migrations. Inserting a real ai_runs row for either AI call here would
 * therefore always fail its CHECK constraint. Rather than silently
 * swallowing that error or mis-labeling the workflow_type as
 * 'candidate_matching' (which would corrupt that table's own accounting),
 * this file NEVER inserts an ai_runs row for outreach drafting/response
 * classification — ai_run_id is always left null on both tables, and the
 * full model/prompt-version/token/cost/latency/confidence record that
 * would otherwise live in ai_runs is instead captured in full on the
 * corresponding audit_events row's metadata (still satisfies core rule
 * #10, "every AI action... must be auditable" — just via audit_events
 * rather than the ai_runs table). Flagged here for the next wave
 * (tests+docs) and for a future migration to actually extend the
 * workflow_type constraint.
 */

async function getAuthedSupabase() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  return { supabase: supabase!, user }
}

// ---------------------------------------------------------------------------
// 1. startOutreachSequenceAction
// ---------------------------------------------------------------------------

const StartSequenceSchema = z.object({
  organizationId: z.string().uuid(),
  candidateRoleMatchId: z.string().uuid(),
})

/** Creates an outreach_sequences row for a candidate_role_match. The DB trigger (enforce_outreach_sequence_consistency) is the real gate on review_status = 'approved_for_outreach' — this action just surfaces its rejection cleanly. */
export async function startOutreachSequenceAction(formData: FormData): Promise<ActionResult> {
  const parsed = StartSequenceSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const { supabase, user } = await getAuthedSupabase()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'outreach', 'create')

  const { data: match } = await supabase
    .from('candidate_role_matches')
    .select('candidate_id, job_id, recruitment_project_id, review_status')
    .eq('id', parsed.data.candidateRoleMatchId)
    .eq('organization_id', parsed.data.organizationId)
    .maybeSingle()

  if (!match) return { success: false, message: 'Could not find this candidate evaluation.' }

  const { data: sequence, error } = await supabase
    .from('outreach_sequences')
    .insert({
      organization_id: parsed.data.organizationId,
      candidate_role_match_id: parsed.data.candidateRoleMatchId,
      candidate_id: match.candidate_id,
      recruitment_project_id: match.recruitment_project_id,
      job_id: match.job_id,
      started_by: user.id,
    })
    .select('id')
    .single()

  if (error || !sequence) {
    const friendly = error?.message?.includes('has not been approved for outreach')
      ? 'This candidate has not been approved for outreach yet — approve them in the quality-review queue first.'
      : 'Could not start an outreach sequence for this candidate.'
    return { success: false, message: friendly }
  }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'outreach.sequence_started',
      entityType: 'outreach_sequences',
      entityId: sequence.id,
      metadata: { candidateRoleMatchId: parsed.data.candidateRoleMatchId },
    },
    supabase,
  )

  revalidatePath('/outreach')
  return { success: true, message: 'Outreach sequence started.' }
}

// ---------------------------------------------------------------------------
// 2. generateOutreachDraftAction
// ---------------------------------------------------------------------------

const GenerateDraftSchema = z.object({
  organizationId: z.string().uuid(),
  outreachSequenceId: z.string().uuid(),
  channel: z.enum(['email', 'phone', 'linkedin', 'sms']),
  templateId: z.string().uuid().optional(),
  contactPointId: z.string().uuid().optional(),
  toneInstructions: z.string().trim().max(1000).optional(),
})

/** Generates an AI outreach draft and persists it as a new drafted outreach_messages row. Never claims evidence-backed personalization that fails validateOutreachDraftEvidence — see the module comment for exactly how a failed check is handled. */
export async function generateOutreachDraftAction(formData: FormData): Promise<ActionResult> {
  const parsed = GenerateDraftSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const { supabase, user } = await getAuthedSupabase()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'outreach', 'create')

  const { data: sequence } = await supabase
    .from('outreach_sequences')
    .select('id, status, candidate_id, job_id, recruitment_project_id, candidate_role_match_id')
    .eq('id', parsed.data.outreachSequenceId)
    .eq('organization_id', parsed.data.organizationId)
    .maybeSingle()

  if (!sequence) return { success: false, message: 'Could not find this outreach sequence.' }
  if (sequence.status !== 'active')
    return { success: false, message: 'This outreach sequence is no longer active.' }

  const [{ data: job }, { data: candidate }, { data: template }, { data: profile }] =
    await Promise.all([
      supabase
        .from('jobs')
        .select('title, recruitment_project_id')
        .eq('id', sequence.job_id)
        .maybeSingle(),
      supabase.from('candidates').select('full_name').eq('id', sequence.candidate_id).maybeSingle(),
      parsed.data.templateId
        ? supabase
            .from('outreach_templates')
            .select('subject_template, body_template')
            .eq('id', parsed.data.templateId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from('user_profiles').select('full_name').eq('id', user.id).maybeSingle(),
    ])

  let clientName: string | null = null
  if (job?.recruitment_project_id) {
    const { data: project } = await supabase
      .from('recruitment_projects')
      .select('client_id')
      .eq('id', job.recruitment_project_id)
      .maybeSingle()
    if (project?.client_id) {
      const { data: client } = await supabase
        .from('clients')
        .select('name')
        .eq('id', project.client_id)
        .maybeSingle()
      clientName = client?.name ?? null
    }
  }

  const evidence = await loadCandidateVerifiedEvidenceBundle(supabase, sequence.candidate_id)

  const outcome = await runOutreachDraftGeneration({
    trustedContext: {
      jobTitle: job?.title ?? 'Unknown role',
      clientName,
      recruiterName: profile?.full_name ?? null,
      channel: parsed.data.channel,
      templateBody: template?.body_template ?? null,
      templateSubject: template?.subject_template ?? null,
      toneInstructions: parsed.data.toneInstructions ?? null,
    },
    candidateEvidence: evidence,
  })

  if (outcome.status === 'not_configured') {
    return {
      success: false,
      message: outcome.errorMessage ?? 'AI outreach drafting is not available in this environment.',
    }
  }
  if (outcome.status === 'error') {
    return { success: false, message: 'The AI draft could not be generated. Try again.' }
  }
  if (outcome.status === 'rejected_by_validation' || !outcome.validated) {
    return {
      success: false,
      message: 'The AI draft failed structured-output validation and was not saved.',
    }
  }

  // Deterministic backstop: the AI's own self-reported evidence references
  // are checked against the candidate's real verified evidence bundle. A
  // claim that fails this check is never persisted or shown as evidence-
  // backed — the draft is still saved (it may still be a perfectly usable
  // generic message) but with personalization_evidence stripped to empty,
  // so a reviewer never sees an unverified/fabricated evidence citation.
  const evidenceCheck = validateOutreachDraftEvidence({
    personalizationEvidence: outcome.validated.personalizationEvidence,
    verifiedEvidenceBundle: evidence,
  })
  const evidenceToStore = evidenceCheck.valid ? outcome.validated.personalizationEvidence : []

  const { data: message, error } = await supabase
    .from('outreach_messages')
    .insert({
      organization_id: parsed.data.organizationId,
      outreach_sequence_id: sequence.id,
      candidate_id: sequence.candidate_id,
      recruitment_project_id: sequence.recruitment_project_id,
      candidate_role_match_id: sequence.candidate_role_match_id,
      template_id: parsed.data.templateId ?? null,
      contact_point_id: parsed.data.contactPointId ?? null,
      channel: parsed.data.channel,
      status: 'drafted',
      subject: outcome.validated.subject,
      draft_body: outcome.validated.body,
      personalization_evidence: evidenceToStore,
      generated_by: 'ai',
      ai_run_id: null,
      edited_by_human: false,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error || !message) return { success: false, message: 'Could not save the generated draft.' }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'outreach.draft_generated',
      entityType: 'outreach_messages',
      entityId: message.id,
      metadata: {
        provider: outcome.provider,
        model: outcome.model,
        promptVersion: outcome.promptVersion,
        inputTokens: outcome.inputTokens,
        outputTokens: outcome.outputTokens,
        costUsd: outcome.costUsd,
        latencyMs: outcome.latencyMs,
        retried: outcome.retried,
        wroteGenerically: outcome.validated.wroteGenerically,
        unresolvedNotes: outcome.validated.unresolvedNotes,
        evidenceValidation: evidenceCheck.valid
          ? { valid: true }
          : { valid: false, issues: evidenceCheck.issues },
      },
    },
    supabase,
  )

  revalidatePath(`/outreach/${sequence.id}`)
  return {
    success: true,
    message: evidenceCheck.valid
      ? 'Draft generated.'
      : "Draft generated, but its self-reported evidence could not be verified against the candidate's record and was removed. Review the draft carefully before approving.",
  }
}

// ---------------------------------------------------------------------------
// 3. editOutreachDraftAction
// ---------------------------------------------------------------------------

const EditDraftSchema = z.object({
  organizationId: z.string().uuid(),
  outreachMessageId: z.string().uuid(),
  subject: z.string().trim().max(300).optional(),
  draftBody: z.string().trim().min(1).max(8000),
})

/** Recruiter edits draft_body/subject before approval. Legal only while status is drafted/awaiting_approval — editing never itself changes status. */
export async function editOutreachDraftAction(formData: FormData): Promise<ActionResult> {
  const parsed = EditDraftSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const { supabase, user } = await getAuthedSupabase()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'outreach', 'update')

  const { data: existing } = await supabase
    .from('outreach_messages')
    .select('status, outreach_sequence_id')
    .eq('id', parsed.data.outreachMessageId)
    .eq('organization_id', parsed.data.organizationId)
    .maybeSingle()

  if (!existing) return { success: false, message: 'Could not find this message.' }
  if (existing.status !== 'drafted' && existing.status !== 'awaiting_approval') {
    return {
      success: false,
      message: 'This message can no longer be edited — it has already moved past drafting.',
    }
  }

  const { error } = await supabase
    .from('outreach_messages')
    .update({
      subject: parsed.data.subject ?? null,
      draft_body: parsed.data.draftBody,
      edited_by_human: true,
    })
    .eq('id', parsed.data.outreachMessageId)

  if (error) return { success: false, message: 'Could not save your edits.' }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'outreach.draft_edited',
      entityType: 'outreach_messages',
      entityId: parsed.data.outreachMessageId,
      metadata: {},
    },
    supabase,
  )

  revalidatePath(`/outreach/${existing.outreach_sequence_id}`)
  return { success: true, message: 'Draft updated.' }
}

// ---------------------------------------------------------------------------
// 4. submitOutreachDraftForApprovalAction
// ---------------------------------------------------------------------------

const SubmitForApprovalSchema = z.object({
  organizationId: z.string().uuid(),
  outreachMessageId: z.string().uuid(),
})

/** drafted -> awaiting_approval. A pure status transition with no gated fields — not individually represented in the AuditAction union (only the approval decision and terminal outcomes are), so no dedicated audit row is written for this step alone; the subsequent approval decision's audit row is the durable record of the workflow having passed through here. */
export async function submitOutreachDraftForApprovalAction(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = SubmitForApprovalSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const { supabase, user } = await getAuthedSupabase()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'outreach', 'update')

  const { data: existing } = await supabase
    .from('outreach_messages')
    .select('status, outreach_sequence_id, candidate_id, recruitment_project_id')
    .eq('id', parsed.data.outreachMessageId)
    .eq('organization_id', parsed.data.organizationId)
    .maybeSingle()

  if (!existing) return { success: false, message: 'Could not find this message.' }
  if (
    !canTransitionOutreachMessageStatus(
      existing.status as OutreachMessageStatus,
      'awaiting_approval',
    )
  ) {
    return {
      success: false,
      message: 'This message cannot be submitted for approval from its current state.',
    }
  }

  const { error } = await supabase
    .from('outreach_messages')
    .update({ status: 'awaiting_approval' })
    .eq('id', parsed.data.outreachMessageId)
  if (error) return { success: false, message: 'Could not submit this draft for approval.' }

  // Build Phase 12, Wave 5 (small, justified addition — Task A): fires the
  // `outreach_awaiting_approval` notification event once the message has
  // actually moved to `awaiting_approval` above. Best-effort, same
  // try/catch-and-log pattern as every other wired trigger this wave.
  try {
    const { data: candidate } = await supabase
      .from('candidates')
      .select('full_name')
      .eq('id', existing.candidate_id)
      .maybeSingle()
    await notifyOutreachAwaitingApproval({
      organizationId: parsed.data.organizationId,
      actorUserId: user.id,
      outreachMessageId: parsed.data.outreachMessageId,
      recruitmentProjectId: existing.recruitment_project_id as string,
      candidateName: (candidate?.full_name as string | undefined) ?? 'A candidate',
      supabase,
    })
  } catch (notifyError) {
    console.error(
      '[outreach] notifyOutreachAwaitingApproval failed:',
      notifyError instanceof Error ? notifyError.message : notifyError,
    )
  }

  revalidatePath(`/outreach/${existing.outreach_sequence_id}`)
  return { success: true, message: 'Submitted for approval.' }
}

// ---------------------------------------------------------------------------
// 5. recordOutreachApprovalAction
// ---------------------------------------------------------------------------

const RecordApprovalSchema = z.object({
  organizationId: z.string().uuid(),
  outreachMessageId: z.string().uuid(),
  decision: z.enum(['approved', 'rejected', 'changes_requested']),
  reason: z.string().trim().max(2000).optional(),
  editedBeforeApproval: z.coerce.boolean().optional(),
})

const APPROVAL_AUDIT_ACTION = {
  approved: 'outreach.approved',
  rejected: 'outreach.rejected',
  changes_requested: 'outreach.changes_requested',
} as const

/** Records an append-only outreach_approvals decision. 'approved' advances the message to 'approved'; 'rejected'/'changes_requested' send it back to 'drafted' for edits (status-transitions.ts's chosen graph). Gated on 'update' — see the module's PERMISSIONS NOTE. */
export async function recordOutreachApprovalAction(formData: FormData): Promise<ActionResult> {
  const parsed = RecordApprovalSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (parsed.data.decision !== 'approved' && !parsed.data.reason) {
    return { success: false, message: 'A reason is required when rejecting or requesting changes.' }
  }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const { supabase, user } = await getAuthedSupabase()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'outreach', 'update')

  const { data: existing } = await supabase
    .from('outreach_messages')
    .select('status, outreach_sequence_id, channel, candidate_id')
    .eq('id', parsed.data.outreachMessageId)
    .eq('organization_id', parsed.data.organizationId)
    .maybeSingle()

  if (!existing) return { success: false, message: 'Could not find this message.' }
  if (existing.status !== 'awaiting_approval') {
    return { success: false, message: 'Only a message awaiting approval can be decided on.' }
  }

  const nextStatus: OutreachMessageStatus =
    parsed.data.decision === 'approved' ? 'approved' : 'drafted'

  if (parsed.data.decision === 'approved') {
    const { data: pref } = await supabase
      .from('communication_preferences')
      .select('status')
      .eq('organization_id', parsed.data.organizationId)
      .eq('candidate_id', existing.candidate_id)
      .eq('channel', existing.channel)
      .maybeSingle()

    const gate = checkOutreachOptOutGate({
      channel: existing.channel as CommunicationChannel,
      currentPreferenceStatus: (pref?.status as CommunicationPreferenceStatus | undefined) ?? null,
      fromStatus: existing.status as OutreachMessageStatus,
      toStatus: 'approved',
    })
    if (!gate.allowed) return { success: false, message: gate.reason }
  }

  const { data: approval, error: approvalError } = await supabase
    .from('outreach_approvals')
    .insert({
      organization_id: parsed.data.organizationId,
      outreach_message_id: parsed.data.outreachMessageId,
      approver_id: user.id,
      decision: parsed.data.decision,
      reason: parsed.data.reason ?? null,
      edited_before_approval: Boolean(parsed.data.editedBeforeApproval),
    })
    .select('id')
    .single()

  if (approvalError || !approval)
    return { success: false, message: 'Could not record this decision.' }

  const { error: statusError } = await supabase
    .from('outreach_messages')
    .update({ status: nextStatus })
    .eq('id', parsed.data.outreachMessageId)
  if (statusError)
    return {
      success: false,
      message: 'The decision was recorded but the message status could not be updated.',
    }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: APPROVAL_AUDIT_ACTION[parsed.data.decision],
      entityType: 'outreach_messages',
      entityId: parsed.data.outreachMessageId,
      metadata: { reason: parsed.data.reason ?? null },
    },
    supabase,
  )

  revalidatePath(`/outreach/${existing.outreach_sequence_id}`)
  return { success: true, message: 'Decision recorded.' }
}

// ---------------------------------------------------------------------------
// 6. sendOutreachMessageAction (email only — the real channel-dispatch path)
// ---------------------------------------------------------------------------

const SendMessageSchema = z.object({
  organizationId: z.string().uuid(),
  outreachMessageId: z.string().uuid(),
  senderAccountIdentifier: z.string().trim().min(1).max(300),
  recipientAddress: z.string().trim().min(1).max(300),
  recipientDisplayName: z.string().trim().max(300).optional(),
})

/** Dispatches an approved/scheduled email message through the real (or clearly-labelled development) channel adapter. Safely re-callable with the same idempotency key — recomputes the attempt number from the message's outbound communication_events history, so a repeat call before any event exists reuses the same key (the adapter/provider's own idempotency dedupes it), and a repeat call after a prior 'sent' event short-circuits immediately. */
export async function sendOutreachMessageAction(formData: FormData): Promise<ActionResult> {
  const parsed = SendMessageSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const { supabase, user } = await getAuthedSupabase()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'outreach', 'update')

  const { data: message } = await supabase
    .from('outreach_messages')
    .select(
      'status, channel, subject, draft_body, candidate_id, recruitment_project_id, outreach_sequence_id, idempotency_key',
    )
    .eq('id', parsed.data.outreachMessageId)
    .eq('organization_id', parsed.data.organizationId)
    .maybeSingle()

  if (!message) return { success: false, message: 'Could not find this message.' }
  if (message.status === 'sent')
    return { success: true, message: 'This message has already been sent.' }
  if (message.channel !== 'email') {
    return {
      success: false,
      message:
        'Automated sending is only available for email. Use the manual-send action for this channel.',
    }
  }
  if (!canTransitionOutreachMessageStatus(message.status as OutreachMessageStatus, 'sent')) {
    return { success: false, message: 'This message must be approved before it can be sent.' }
  }

  const { data: pref } = await supabase
    .from('communication_preferences')
    .select('status')
    .eq('organization_id', parsed.data.organizationId)
    .eq('candidate_id', message.candidate_id)
    .eq('channel', 'email')
    .maybeSingle()

  const gate = checkOutreachOptOutGate({
    channel: 'email',
    currentPreferenceStatus: (pref?.status as CommunicationPreferenceStatus | undefined) ?? null,
    fromStatus: message.status as OutreachMessageStatus,
    toStatus: 'sent',
  })
  if (!gate.allowed) return { success: false, message: gate.reason }

  const { count: priorAttempts } = await supabase
    .from('communication_events')
    .select('id', { count: 'exact', head: true })
    .eq('outreach_message_id', parsed.data.outreachMessageId)
    .eq('direction', 'outbound')
    .in('event_type', ['sent', 'failed'])

  const attemptNumber = (priorAttempts ?? 0) + 1
  const idempotencyKey = generateOutreachIdempotencyKey({
    outreachMessageId: parsed.data.outreachMessageId,
    attemptNumber,
  })

  await supabase
    .from('outreach_messages')
    .update({
      sender_user_id: user.id,
      sender_account_identifier: parsed.data.senderAccountIdentifier,
      idempotency_key: idempotencyKey,
    })
    .eq('id', parsed.data.outreachMessageId)

  const adapter = getEmailChannelAdapter()
  const result = await adapter.send({
    id: parsed.data.outreachMessageId,
    organizationId: parsed.data.organizationId,
    channel: 'email',
    subject: message.subject,
    body: message.draft_body,
    idempotencyKey,
    senderUserId: user.id,
    senderAccountIdentifier: parsed.data.senderAccountIdentifier,
    recipientAddress: parsed.data.recipientAddress,
    recipientDisplayName: parsed.data.recipientDisplayName ?? null,
  })

  if (result.status === 'not_configured') {
    return { success: false, message: result.errorMessage }
  }

  const nowIso = new Date().toISOString()

  if (result.status === 'sent') {
    await supabase.from('communication_events').insert({
      organization_id: parsed.data.organizationId,
      outreach_message_id: parsed.data.outreachMessageId,
      candidate_id: message.candidate_id,
      recruitment_project_id: message.recruitment_project_id,
      channel: 'email',
      direction: 'outbound',
      event_type: 'sent',
      provider: result.provider,
      provider_message_id: result.providerMessageId,
      raw_payload: { simulated: result.simulated, sentAt: result.sentAt },
      occurred_at: result.sentAt,
      recorded_by: user.id,
    })

    await supabase
      .from('outreach_messages')
      .update({ status: 'sent', sent_at: result.sentAt })
      .eq('id', parsed.data.outreachMessageId)

    await logAuditEvent(
      {
        organizationId: parsed.data.organizationId,
        actorId: user.id,
        action: 'outreach.sent',
        entityType: 'outreach_messages',
        entityId: parsed.data.outreachMessageId,
        metadata: { provider: result.provider, simulated: result.simulated },
      },
      supabase,
    )

    revalidatePath(`/outreach/${message.outreach_sequence_id}`)
    return {
      success: true,
      message: result.simulated
        ? 'Message sent (simulated — no live email provider is configured).'
        : 'Message sent.',
    }
  }

  // result.status === 'failed'
  await supabase.from('communication_events').insert({
    organization_id: parsed.data.organizationId,
    outreach_message_id: parsed.data.outreachMessageId,
    candidate_id: message.candidate_id,
    recruitment_project_id: message.recruitment_project_id,
    channel: 'email',
    direction: 'outbound',
    event_type: 'failed',
    provider: result.provider,
    raw_payload: { retryable: result.retryable, errorMessage: result.errorMessage },
    occurred_at: nowIso,
    recorded_by: user.id,
  })

  await supabase
    .from('outreach_messages')
    .update({ status: 'failed', failed_at: nowIso, failure_reason: result.errorMessage })
    .eq('id', parsed.data.outreachMessageId)

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'outreach.failed',
      entityType: 'outreach_messages',
      entityId: parsed.data.outreachMessageId,
      metadata: {
        provider: result.provider,
        retryable: result.retryable,
        errorMessage: result.errorMessage,
      },
    },
    supabase,
  )

  revalidatePath(`/outreach/${message.outreach_sequence_id}`)
  return { success: false, message: `Send failed: ${result.errorMessage}` }
}

// ---------------------------------------------------------------------------
// 7. recordManualChannelSendAction / recordManualChannelResponseAction
//    (LinkedIn, and generically phone/SMS — no automated send() ever exists
//    for these channels; see lib/outreach/channels/linkedin.ts's module
//    comment. Named "ManualChannel" rather than "LinkedIn" here since the
//    brief explicitly asks for it to be generically usable for phone/SMS
//    manual logging too — a JUDGMENT CALL over the brief's suggested name.)
// ---------------------------------------------------------------------------

const RecordManualSendSchema = z.object({
  organizationId: z.string().uuid(),
  outreachMessageId: z.string().uuid(),
  occurredAt: z.string().datetime().optional(),
  note: z.string().trim().max(2000).optional(),
})

/** Records that a recruiter manually sent an approved/scheduled non-email message (LinkedIn/phone/SMS) outside this platform. No adapter send() call is ever invoked here — see lib/outreach/channels/linkedin.ts. */
export async function recordManualChannelSendAction(formData: FormData): Promise<ActionResult> {
  const parsed = RecordManualSendSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const { supabase, user } = await getAuthedSupabase()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'outreach', 'update')

  const { data: message } = await supabase
    .from('outreach_messages')
    .select('status, channel, candidate_id, recruitment_project_id, outreach_sequence_id')
    .eq('id', parsed.data.outreachMessageId)
    .eq('organization_id', parsed.data.organizationId)
    .maybeSingle()

  if (!message) return { success: false, message: 'Could not find this message.' }
  if (message.channel === 'email')
    return {
      success: false,
      message: 'Email is sent automatically — use the send action, not manual logging.',
    }
  if (!canTransitionOutreachMessageStatus(message.status as OutreachMessageStatus, 'sent')) {
    return {
      success: false,
      message: 'This message must be approved before a manual send can be logged.',
    }
  }

  const { data: pref } = await supabase
    .from('communication_preferences')
    .select('status')
    .eq('organization_id', parsed.data.organizationId)
    .eq('candidate_id', message.candidate_id)
    .eq('channel', message.channel)
    .maybeSingle()

  const gate = checkOutreachOptOutGate({
    channel: message.channel as CommunicationChannel,
    currentPreferenceStatus: (pref?.status as CommunicationPreferenceStatus | undefined) ?? null,
    fromStatus: message.status as OutreachMessageStatus,
    toStatus: 'sent',
  })
  if (!gate.allowed) return { success: false, message: gate.reason }

  const record = buildLinkedInManualSendRecord({
    outreachMessageId: parsed.data.outreachMessageId,
    candidateId: message.candidate_id,
    recruitmentProjectId: message.recruitment_project_id,
    organizationId: parsed.data.organizationId,
    recordedByUserId: user.id,
    occurredAt: parsed.data.occurredAt,
    note: parsed.data.note,
  })

  const provider = `${message.channel}_manual`

  await supabase.from('communication_events').insert({
    organization_id: record.organizationId,
    outreach_message_id: record.outreachMessageId,
    candidate_id: record.candidateId,
    recruitment_project_id: record.recruitmentProjectId,
    channel: message.channel,
    direction: 'outbound',
    event_type: 'sent',
    provider,
    raw_payload: { note: record.note },
    occurred_at: record.occurredAt,
    recorded_by: user.id,
  })

  await supabase
    .from('outreach_messages')
    .update({
      status: 'sent',
      sender_user_id: user.id,
      sender_account_identifier: provider,
      sent_at: record.occurredAt,
    })
    .eq('id', parsed.data.outreachMessageId)

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'outreach.sent',
      entityType: 'outreach_messages',
      entityId: parsed.data.outreachMessageId,
      metadata: { provider, manual: true },
    },
    supabase,
  )

  revalidatePath(`/outreach/${message.outreach_sequence_id}`)
  return { success: true, message: 'Manual send recorded.' }
}

const RecordManualResponseSchema = z.object({
  organizationId: z.string().uuid(),
  candidateId: z.string().uuid(),
  recruitmentProjectId: z.string().uuid(),
  channel: z.enum(['phone', 'linkedin', 'sms']),
  outreachMessageId: z.string().uuid().optional(),
  rawResponseText: z.string().trim().min(1).max(8000),
  receivedAt: z.string().datetime().optional(),
})

/** Transcribes a reply a recruiter received manually (a LinkedIn message, a phone call, an SMS) outside this platform into a candidate_responses row. rawResponseText is UNTRUSTED candidate-authored text the instant it exists here — never treated as instructions, and no AI classification is triggered automatically (a recruiter who already heard/read the reply can classify it directly via confirmCandidateResponseClassificationAction, or use recordCandidateResponseAction's runClassification option if they want the AI's second opinion first). */
export async function recordManualChannelResponseAction(formData: FormData): Promise<ActionResult> {
  const parsed = RecordManualResponseSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const { supabase, user } = await getAuthedSupabase()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'outreach', 'create')

  const record = buildLinkedInManualResponseRecord({
    outreachMessageId: parsed.data.outreachMessageId ?? null,
    candidateId: parsed.data.candidateId,
    recruitmentProjectId: parsed.data.recruitmentProjectId,
    organizationId: parsed.data.organizationId,
    recordedByUserId: user.id,
    rawResponseText: parsed.data.rawResponseText,
    receivedAt: parsed.data.receivedAt,
  })

  const { data: response, error } = await supabase
    .from('candidate_responses')
    .insert({
      organization_id: record.organizationId,
      candidate_id: record.candidateId,
      recruitment_project_id: record.recruitmentProjectId,
      outreach_message_id: record.outreachMessageId,
      channel: parsed.data.channel,
      raw_response_text: record.rawResponseText,
      received_at: record.receivedAt,
    })
    .select('id, outreach_message_id')
    .single()

  if (error || !response) return { success: false, message: 'Could not record this response.' }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'outreach.response_recorded',
      entityType: 'candidate_responses',
      entityId: response.id,
      metadata: { channel: parsed.data.channel, manual: true },
    },
    supabase,
  )

  if (response.outreach_message_id) {
    const { data: msg } = await supabase
      .from('outreach_messages')
      .select('outreach_sequence_id, status')
      .eq('id', response.outreach_message_id)
      .maybeSingle()
    if (
      msg &&
      canTransitionOutreachMessageStatus(msg.status as OutreachMessageStatus, 'responded')
    ) {
      await supabase
        .from('outreach_messages')
        .update({ status: 'responded' })
        .eq('id', response.outreach_message_id)
    }
    if (msg) revalidatePath(`/outreach/${msg.outreach_sequence_id}`)
  }
  revalidatePath('/outreach')
  return { success: true, message: 'Response recorded.' }
}

// ---------------------------------------------------------------------------
// 8. recordCandidateResponseAction / confirmCandidateResponseClassificationAction
//
//    JUDGMENT CALL: two separate actions, not one — mirrors the shortlist
//    internal-approval/client-decision two-step precedent the brief points
//    to. recordCandidateResponseAction is the general "log an inbound
//    reply, on any channel" entry point (works for email too, unlike
//    recordManualChannelResponseAction above) with an OPTIONAL runClassification
//    flag that calls the advisory AI classifier inline and stores its
//    suggestion; confirmCandidateResponseClassificationAction is the ONLY
//    action that may ever set confirmed_classification, and is always a
//    separate, later, explicitly human step — never auto-applied from the
//    AI's suggestion, even when runClassification was used. This keeps the
//    "AI suggests, human confirms, only a human confirmation can trigger
//    the opt-out hard gate" rule structurally obvious: there is no code
//    path anywhere that writes confirmed_classification except this one
//    reviewer-attributed action.
// ---------------------------------------------------------------------------

const RecordResponseSchema = z.object({
  organizationId: z.string().uuid(),
  candidateId: z.string().uuid(),
  recruitmentProjectId: z.string().uuid(),
  channel: z.enum(['email', 'phone', 'linkedin', 'sms']),
  outreachMessageId: z.string().uuid().optional(),
  rawResponseText: z.string().trim().min(1).max(8000),
  runClassification: z.coerce.boolean().optional(),
})

/** Logs an inbound candidate reply (any channel) and, optionally, runs the advisory AI classifier over it. rawResponseText is UNTRUSTED candidate-authored text from the moment it is captured — never treated as instructions by this action or by the AI call it may trigger. */
export async function recordCandidateResponseAction(formData: FormData): Promise<ActionResult> {
  const parsed = RecordResponseSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const { supabase, user } = await getAuthedSupabase()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'outreach', 'create')

  let outboundMessageBody: string | null = null
  if (parsed.data.outreachMessageId) {
    const { data: outbound } = await supabase
      .from('outreach_messages')
      .select('draft_body')
      .eq('id', parsed.data.outreachMessageId)
      .maybeSingle()
    outboundMessageBody = outbound?.draft_body ?? null
  }

  let aiSuggestedClassification: CandidateResponseClassification | null = null
  let aiConfidence: number | null = null
  let classificationMetadata: Record<string, unknown> = {}

  if (parsed.data.runClassification) {
    const outcome = await runResponseClassification({
      trustedContext: { channel: parsed.data.channel, outboundMessageBody },
      rawResponseText: parsed.data.rawResponseText,
    })
    classificationMetadata = {
      classificationStatus: outcome.status,
      provider: outcome.provider,
      model: outcome.model,
      promptVersion: outcome.promptVersion,
      inputTokens: outcome.inputTokens,
      outputTokens: outcome.outputTokens,
      costUsd: outcome.costUsd,
      latencyMs: outcome.latencyMs,
    }
    if (outcome.status === 'success' && outcome.validated) {
      aiSuggestedClassification = outcome.validated.suggestedClassification
      aiConfidence = outcome.validated.confidence
      classificationMetadata.rationale = outcome.validated.rationale
    }
  }

  const { data: response, error } = await supabase
    .from('candidate_responses')
    .insert({
      organization_id: parsed.data.organizationId,
      candidate_id: parsed.data.candidateId,
      recruitment_project_id: parsed.data.recruitmentProjectId,
      outreach_message_id: parsed.data.outreachMessageId ?? null,
      channel: parsed.data.channel,
      raw_response_text: parsed.data.rawResponseText,
      ai_suggested_classification: aiSuggestedClassification,
      ai_confidence: aiConfidence,
      ai_run_id: null,
    })
    .select('id, outreach_message_id')
    .single()

  if (error || !response) return { success: false, message: 'Could not record this response.' }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'outreach.response_recorded',
      entityType: 'candidate_responses',
      entityId: response.id,
      metadata: { channel: parsed.data.channel },
    },
    supabase,
  )

  if (parsed.data.runClassification) {
    await logAuditEvent(
      {
        organizationId: parsed.data.organizationId,
        actorId: user.id,
        action: 'outreach.response_classified',
        entityType: 'candidate_responses',
        entityId: response.id,
        metadata: {
          ...classificationMetadata,
          suggested: aiSuggestedClassification,
          confirmed: false,
        },
      },
      supabase,
    )
  }

  if (response.outreach_message_id) {
    const { data: msg } = await supabase
      .from('outreach_messages')
      .select('outreach_sequence_id, status')
      .eq('id', response.outreach_message_id)
      .maybeSingle()
    if (
      msg &&
      canTransitionOutreachMessageStatus(msg.status as OutreachMessageStatus, 'responded')
    ) {
      await supabase
        .from('outreach_messages')
        .update({ status: 'responded' })
        .eq('id', response.outreach_message_id)
    }
    if (msg) revalidatePath(`/outreach/${msg.outreach_sequence_id}`)

    // Build Phase 12, Wave 5 (small, justified addition — Task A): fires
    // the `candidate_responded` notification event for the sequence's
    // owning recruiter. Best-effort, same try/catch-and-log pattern as
    // every other wired trigger this wave.
    try {
      if (msg?.outreach_sequence_id) {
        const [{ data: sequence }, { data: candidate }] = await Promise.all([
          supabase
            .from('outreach_sequences')
            .select('started_by')
            .eq('id', msg.outreach_sequence_id)
            .maybeSingle(),
          supabase
            .from('candidates')
            .select('full_name')
            .eq('id', parsed.data.candidateId)
            .maybeSingle(),
        ])
        await notifyCandidateResponded({
          organizationId: parsed.data.organizationId,
          actorUserId: user.id,
          outreachMessageId: response.outreach_message_id,
          sequenceStartedBy: (sequence?.started_by as string | null) ?? null,
          candidateName: (candidate?.full_name as string | undefined) ?? 'A candidate',
          responseEventId: response.id,
          supabase,
        })
      }
    } catch (notifyError) {
      console.error(
        '[outreach] notifyCandidateResponded failed:',
        notifyError instanceof Error ? notifyError.message : notifyError,
      )
    }
  }
  revalidatePath('/outreach')
  return {
    success: true,
    message: aiSuggestedClassification
      ? `Response recorded. AI suggests: ${aiSuggestedClassification}.`
      : 'Response recorded.',
  }
}

const ConfirmClassificationSchema = z.object({
  organizationId: z.string().uuid(),
  candidateResponseId: z.string().uuid(),
  confirmedClassification: z.enum([
    'interested',
    'not_interested',
    'needs_more_info',
    'follow_up_later',
    'opt_out',
    'ambiguous',
  ]),
  reviewNote: z.string().trim().max(2000).optional(),
})

/** The ONLY action that may ever set candidate_responses.confirmed_classification. Setting it to 'opt_out' is what the DB trigger (apply_confirmed_opt_out_classification) reads to cascade into communication_preferences — an unreviewed AI suggestion can never reach that trigger on its own. */
export async function confirmCandidateResponseClassificationAction(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = ConfirmClassificationSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const { supabase, user } = await getAuthedSupabase()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'outreach', 'update')

  const { data: existing } = await supabase
    .from('candidate_responses')
    .select('id, ai_suggested_classification, outreach_message_id')
    .eq('id', parsed.data.candidateResponseId)
    .eq('organization_id', parsed.data.organizationId)
    .maybeSingle()
  if (!existing) return { success: false, message: 'Could not find this response.' }

  const { error } = await supabase
    .from('candidate_responses')
    .update({
      confirmed_classification: parsed.data.confirmedClassification,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      review_note: parsed.data.reviewNote ?? null,
    })
    .eq('id', parsed.data.candidateResponseId)

  if (error) return { success: false, message: 'Could not record your classification.' }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'outreach.response_classified',
      entityType: 'candidate_responses',
      entityId: parsed.data.candidateResponseId,
      metadata: {
        confirmed: true,
        confirmedClassification: parsed.data.confirmedClassification,
        aiSuggestedClassification: existing.ai_suggested_classification,
        overrodeAiSuggestion:
          Boolean(existing.ai_suggested_classification) &&
          existing.ai_suggested_classification !== parsed.data.confirmedClassification,
      },
    },
    supabase,
  )

  if (parsed.data.confirmedClassification === 'opt_out') {
    await logAuditEvent(
      {
        organizationId: parsed.data.organizationId,
        actorId: user.id,
        action: 'outreach.opt_out_recorded',
        entityType: 'candidate_responses',
        entityId: parsed.data.candidateResponseId,
        metadata: { source: 'response_classification' },
      },
      supabase,
    )
  }

  if (existing.outreach_message_id) {
    const { data: msg } = await supabase
      .from('outreach_messages')
      .select('outreach_sequence_id')
      .eq('id', existing.outreach_message_id)
      .maybeSingle()
    if (msg) revalidatePath(`/outreach/${msg.outreach_sequence_id}`)
  }
  revalidatePath('/outreach')
  return { success: true, message: 'Classification confirmed.' }
}

// ---------------------------------------------------------------------------
// 9. updateCommunicationPreferenceAction
// ---------------------------------------------------------------------------

const UpdatePreferenceSchema = z.object({
  organizationId: z.string().uuid(),
  candidateId: z.string().uuid(),
  channel: z.enum(['email', 'phone', 'linkedin', 'sms']),
  status: z.enum(['opted_in', 'opted_out', 'unknown']),
  reason: z.string().trim().max(1000).optional(),
})

/** Direct recruiter-initiated preference/opt-out change, independent of the response-classification path (e.g. a candidate calls in and asks to be removed). */
export async function updateCommunicationPreferenceAction(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = UpdatePreferenceSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (parsed.data.status === 'opted_out' && !parsed.data.reason) {
    return { success: false, message: 'A reason is required when recording an opt-out.' }
  }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const { supabase, user } = await getAuthedSupabase()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'outreach', 'update')

  const nowIso = new Date().toISOString()
  const { error } = await supabase.from('communication_preferences').upsert(
    {
      organization_id: parsed.data.organizationId,
      candidate_id: parsed.data.candidateId,
      channel: parsed.data.channel,
      status: parsed.data.status,
      consent_source: 'recruiter_recorded',
      opted_out_at: parsed.data.status === 'opted_out' ? nowIso : null,
      opted_out_reason: parsed.data.status === 'opted_out' ? (parsed.data.reason ?? null) : null,
      opted_out_by: parsed.data.status === 'opted_out' ? user.id : null,
      updated_by: user.id,
    },
    { onConflict: 'organization_id,candidate_id,channel' },
  )

  if (error) return { success: false, message: 'Could not update this communication preference.' }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action:
        parsed.data.status === 'opted_out'
          ? 'outreach.opt_out_recorded'
          : 'outreach.communication_preference_updated',
      entityType: 'communication_preferences',
      entityId: parsed.data.candidateId,
      metadata: {
        channel: parsed.data.channel,
        status: parsed.data.status,
        reason: parsed.data.reason ?? null,
        source: 'recruiter_recorded',
      },
    },
    supabase,
  )

  revalidatePath('/outreach')
  return { success: true, message: 'Communication preference updated.' }
}

// ---------------------------------------------------------------------------
// 10. verifyContactPointAction
// ---------------------------------------------------------------------------

const VerifyContactPointSchema = z.object({
  organizationId: z.string().uuid(),
  contactPointId: z.string().uuid(),
  verified: z.coerce.boolean(),
})

/** Sets candidate_contact_points.verified/verified_at/verified_by. Gated on the 'outreach' resource (this is an outreach-readiness action, added by this wave's migration specifically for outreach) rather than 'candidate_records' — JUDGMENT CALL, documented since the column lives on a candidates-domain table. */
export async function verifyContactPointAction(formData: FormData): Promise<ActionResult> {
  const parsed = VerifyContactPointSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const { supabase, user } = await getAuthedSupabase()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'outreach', 'update')

  const { error } = await supabase
    .from('candidate_contact_points')
    .update({
      verified: parsed.data.verified,
      verified_at: parsed.data.verified ? new Date().toISOString() : null,
      verified_by: parsed.data.verified ? user.id : null,
    })
    .eq('id', parsed.data.contactPointId)
    .eq('organization_id', parsed.data.organizationId)

  if (error) return { success: false, message: 'Could not update this contact point.' }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'outreach.contact_point_verified',
      entityType: 'candidate_contact_points',
      entityId: parsed.data.contactPointId,
      metadata: { verified: parsed.data.verified },
    },
    supabase,
  )

  revalidatePath('/outreach')
  return {
    success: true,
    message: parsed.data.verified ? 'Contact point verified.' : 'Contact point marked unverified.',
  }
}

// ---------------------------------------------------------------------------
// 11. cancelOutreachSequenceAction / cancelOutreachMessageAction / retryFailedOutreachMessageAction
// ---------------------------------------------------------------------------

const CancelSequenceSchema = z.object({
  organizationId: z.string().uuid(),
  outreachSequenceId: z.string().uuid(),
  reason: z.string().trim().min(1).max(2000),
})

/** Cancels a sequence and every one of its still-cancellable messages (drafted/awaiting_approval/approved/scheduled) so no stale actionable draft is left behind once the sequence itself is cancelled. */
export async function cancelOutreachSequenceAction(formData: FormData): Promise<ActionResult> {
  const parsed = CancelSequenceSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success)
    return { success: false, message: 'A reason is required to cancel an outreach sequence.' }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const { supabase, user } = await getAuthedSupabase()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'outreach', 'update')

  const nowIso = new Date().toISOString()
  const { error } = await supabase
    .from('outreach_sequences')
    .update({
      status: 'cancelled',
      cancelled_by: user.id,
      cancelled_at: nowIso,
      cancel_reason: parsed.data.reason,
    })
    .eq('id', parsed.data.outreachSequenceId)
    .eq('organization_id', parsed.data.organizationId)

  if (error) return { success: false, message: 'Could not cancel this sequence.' }

  const { data: cancellableMessages } = await supabase
    .from('outreach_messages')
    .select('id')
    .eq('outreach_sequence_id', parsed.data.outreachSequenceId)
    .in('status', ['drafted', 'awaiting_approval', 'approved', 'scheduled'])

  for (const row of cancellableMessages ?? []) {
    await supabase
      .from('outreach_messages')
      .update({
        status: 'cancelled',
        cancelled_by: user.id,
        cancelled_at: nowIso,
        cancel_reason: `Sequence cancelled: ${parsed.data.reason}`,
      })
      .eq('id', row.id)
  }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'outreach.sequence_cancelled',
      entityType: 'outreach_sequences',
      entityId: parsed.data.outreachSequenceId,
      metadata: {
        reason: parsed.data.reason,
        cancelledMessageCount: cancellableMessages?.length ?? 0,
      },
    },
    supabase,
  )

  revalidatePath('/outreach')
  revalidatePath(`/outreach/${parsed.data.outreachSequenceId}`)
  return { success: true, message: 'Outreach sequence cancelled.' }
}

const CancelMessageSchema = z.object({
  organizationId: z.string().uuid(),
  outreachMessageId: z.string().uuid(),
  reason: z.string().trim().min(1).max(2000),
})

/** Cancels one message (only legal from drafted/awaiting_approval/approved/scheduled, per status-transitions.ts). */
export async function cancelOutreachMessageAction(formData: FormData): Promise<ActionResult> {
  const parsed = CancelMessageSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success)
    return { success: false, message: 'A reason is required to cancel a message.' }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const { supabase, user } = await getAuthedSupabase()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'outreach', 'update')

  const { data: existing } = await supabase
    .from('outreach_messages')
    .select('status, outreach_sequence_id')
    .eq('id', parsed.data.outreachMessageId)
    .eq('organization_id', parsed.data.organizationId)
    .maybeSingle()
  if (!existing) return { success: false, message: 'Could not find this message.' }
  if (!canTransitionOutreachMessageStatus(existing.status as OutreachMessageStatus, 'cancelled')) {
    return { success: false, message: 'This message can no longer be cancelled.' }
  }

  const { error } = await supabase
    .from('outreach_messages')
    .update({
      status: 'cancelled',
      cancelled_by: user.id,
      cancelled_at: new Date().toISOString(),
      cancel_reason: parsed.data.reason,
    })
    .eq('id', parsed.data.outreachMessageId)
  if (error) return { success: false, message: 'Could not cancel this message.' }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'outreach.cancelled',
      entityType: 'outreach_messages',
      entityId: parsed.data.outreachMessageId,
      metadata: { reason: parsed.data.reason },
    },
    supabase,
  )

  revalidatePath(`/outreach/${existing.outreach_sequence_id}`)
  return { success: true, message: 'Message cancelled.' }
}

const RetryFailedMessageSchema = z.object({
  organizationId: z.string().uuid(),
  outreachMessageId: z.string().uuid(),
})

/** failed -> awaiting_approval (status-transitions.ts's chosen graph: a retry re-enters the approval step rather than skipping back to 'approved', since the draft/contact details may need to change first). A pure status transition — see submitOutreachDraftForApprovalAction's comment on why no dedicated audit literal is used here. */
export async function retryFailedOutreachMessageAction(formData: FormData): Promise<ActionResult> {
  const parsed = RetryFailedMessageSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const { supabase, user } = await getAuthedSupabase()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'outreach', 'update')

  const { data: existing } = await supabase
    .from('outreach_messages')
    .select('status, outreach_sequence_id')
    .eq('id', parsed.data.outreachMessageId)
    .eq('organization_id', parsed.data.organizationId)
    .maybeSingle()
  if (!existing) return { success: false, message: 'Could not find this message.' }
  if (
    !canTransitionOutreachMessageStatus(
      existing.status as OutreachMessageStatus,
      'awaiting_approval',
    )
  ) {
    return { success: false, message: 'Only a failed message can be retried.' }
  }

  const { error } = await supabase
    .from('outreach_messages')
    .update({ status: 'awaiting_approval' })
    .eq('id', parsed.data.outreachMessageId)
  if (error) return { success: false, message: 'Could not retry this message.' }

  revalidatePath(`/outreach/${existing.outreach_sequence_id}`)
  return { success: true, message: 'Message moved back to awaiting approval for retry.' }
}
