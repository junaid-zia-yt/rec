'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { supabaseConfigured } from '@/lib/env'
import { logAuditEvent } from '@/lib/audit/log'
import { GENERIC_AUTH_ERROR_MESSAGE } from '@/lib/auth/errors'
import { requirePermission } from '@/lib/auth/session'
import type { ActionResult } from '@/lib/auth/actions'
import type { CopilotCitation, CopilotDataClassification } from '@rqi/types'
import { runCopilotTurn, type CopilotTurnOutcome } from './orchestration/run-copilot-turn'
import { assertResourceOwnership, ResourceOwnershipError } from './resource-ownership'

/**
 * Copilot server actions (Build Phase 11 Wave 4, Task A). Same
 * 'use server' + Zod + requirePermission + Supabase write + logAuditEvent +
 * revalidatePath + ActionResult template as apps/web/lib/outreach/
 * outreach-actions.ts — every write here follows that exact shape, except
 * `sendCopilotMessageAction`, whose result is intentionally a richer typed
 * union (see its own comment) so the UI can render each `CopilotTurnOutcome`
 * failure variant distinctly, as the brief requires.
 *
 * WAVE 3 ORCHESTRATION DOES THE HEAVY LIFTING. This file never re-implements
 * permission narrowing, rate limiting, tool authorization, evidence
 * grounding or persistence — `run-copilot-turn.ts`'s `runCopilotTurn()`
 * already does every bit of that and is the only place this file calls into
 * for the actual AI turn. This file's job is strictly: validate the
 * request, resolve the caller's live membership, hand off to
 * `runCopilotTurn`, and map its result onto the UI-facing action contract
 * (audit logging + revalidation for the paths wave 3 does not already cover
 * — see `sendCopilotMessageAction`'s "AUDIT ACTION MAPPING" comment).
 *
 * CANCELLATION — JUDGMENT CALL (flagged explicitly per the brief): no
 * `cancelCopilotMessageAction` is implemented. `sendCopilotMessageAction` is
 * an ordinary Next.js Server Action: the browser calls it, the server
 * process `await`s the full `runCopilotTurn()` call (which itself already
 * races against a wall-clock timeout and an internal `AbortSignal` —
 * `run-copilot-turn.ts`'s own `signal` parameter), and only then returns a
 * response. There is no second, separate request a "Cancel" button could
 * make that this server action's own in-flight invocation could ever
 * observe — a Server Action has no request ID the client can hand back to
 * a *different* invocation to signal "abort that one, specifically", and
 * this codebase has no shared, cross-request registry of in-flight
 * `AbortController`s (nor a queue/worker process outside the Vercel
 * request/response model — docs/17-deployment-operations.md's "Background
 * job processing" is listed as an infrastructure goal, not something wired
 * up yet). Building one now (e.g. a `Map` keyed by conversation id, held in
 * module scope) would not reliably work in this deployment target anyway:
 * Vercel serverless functions are not guaranteed to share process memory
 * across concurrent invocations/instances, so a "cancel" request could
 * easily land on a different instance than the one running the turn and do
 * nothing. A true cancel-in-flight UX needs a different mechanism — e.g. a
 * durable "cancellation requested" row a background worker polls between
 * tool-call iterations, or moving this whole call to a real background-job
 * queue instead of a synchronous Server Action — and is explicitly out of
 * scope for this wave. What the UI CAN honestly offer instead: the
 * `DEFAULT_TURN_TIMEOUT_MS` (45s) wall-clock cap `runCopilotTurn` already
 * enforces server-side regardless of what the client does, so a stuck turn
 * always resolves within a bounded time even with no cancel button at all.
 */

async function getAuthedSupabase() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  return { supabase: supabase!, user }
}

// ---------------------------------------------------------------------------
// 1. startCopilotConversationAction
// ---------------------------------------------------------------------------

const StartConversationSchema = z.object({
  organizationId: z.string().uuid(),
  // Optional at the schema level (an org-wide role may start an unscoped
  // conversation) — required-ness for recruiter/client_decision_maker is
  // enforced below, against the caller's LIVE role, never trusted from the
  // client either way.
  recruitmentProjectId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(200).optional(),
})

export interface StartConversationResult extends ActionResult {
  conversationId?: string
}

/**
 * Creates a `copilot_conversations` row. `role_at_creation` and
 * `data_classification` are ALWAYS re-derived from the caller's actual
 * current membership here — never taken from client input — mirroring
 * 0031's own `enforce_copilot_conversation_consistency` trigger validation
 * as defense in depth (the DB trigger is the final backstop either way;
 * this is the friendlier, pre-flight check that turns a would-be trigger
 * exception into a clean `ActionResult` instead).
 */
export async function startCopilotConversationAction(
  formData: FormData,
): Promise<StartConversationResult> {
  const raw = Object.fromEntries(formData.entries())
  const parsed = StartConversationSchema.safeParse({
    organizationId: raw.organizationId,
    recruitmentProjectId: raw.recruitmentProjectId ? raw.recruitmentProjectId : undefined,
    title: raw.title ? raw.title : undefined,
  })
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const { supabase, user } = await getAuthedSupabase()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  // `hasPermission(role, 'copilot', 'create')` is false for platform_admin
  // and read_only_reviewer (permissions.ts MATRIX — both get 'read' only,
  // oversight of others' conversations, never their own) — requirePermission
  // throws for those roles before any code below runs, so the
  // agency_admin/recruiter/client_decision_maker-only branches below are
  // exhaustive for every membership that reaches this point.
  const membership = await requirePermission(
    user.id,
    parsed.data.organizationId,
    'copilot',
    'create',
  )
  const role = membership.role

  let recruitmentProjectId: string | null = null
  let clientId: string | null = null
  let dataClassification: CopilotDataClassification = 'standard'

  if (role === 'recruiter' || role === 'client_decision_maker') {
    if (!parsed.data.recruitmentProjectId) {
      return {
        success: false,
        message: 'Select a recruitment project to start a copilot conversation.',
      }
    }
    try {
      await assertResourceOwnership(supabase, {
        organizationId: parsed.data.organizationId,
        userId: user.id,
        role,
        resourceType: 'recruitment_project',
        resourceId: parsed.data.recruitmentProjectId,
      })
    } catch (error) {
      if (error instanceof ResourceOwnershipError) {
        return { success: false, message: 'You do not have access to that recruitment project.' }
      }
      throw error
    }

    recruitmentProjectId = parsed.data.recruitmentProjectId
    const { data: project } = await supabase
      .from('recruitment_projects')
      .select('client_id')
      .eq('id', recruitmentProjectId)
      .maybeSingle()
    clientId = (project?.client_id as string | null) ?? null

    if (role === 'client_decision_maker') {
      dataClassification = 'restricted_notes_excluded'
      // Defense in depth beyond assertResourceOwnership's own client-match
      // check: client_id on the conversation itself must be the caller's
      // OWN represented client (0031's copilot_conversations trigger
      // enforces exactly this), never the project's client_id taken at
      // face value in case the two ever diverged.
      if (!membership.clientId || membership.clientId !== clientId) {
        return { success: false, message: 'You do not have access to that recruitment project.' }
      }
      clientId = membership.clientId
    }
  } else if (role === 'agency_admin') {
    // Org-wide by default; optionally pinned to one project if the caller
    // chose to scope this conversation, same ownership check as above.
    if (parsed.data.recruitmentProjectId) {
      try {
        await assertResourceOwnership(supabase, {
          organizationId: parsed.data.organizationId,
          userId: user.id,
          role,
          resourceType: 'recruitment_project',
          resourceId: parsed.data.recruitmentProjectId,
        })
      } catch (error) {
        if (error instanceof ResourceOwnershipError) {
          return { success: false, message: 'Could not find that recruitment project.' }
        }
        throw error
      }
      recruitmentProjectId = parsed.data.recruitmentProjectId
      const { data: project } = await supabase
        .from('recruitment_projects')
        .select('client_id')
        .eq('id', recruitmentProjectId)
        .maybeSingle()
      clientId = (project?.client_id as string | null) ?? null
    }
  } else {
    // Unreachable in practice (requirePermission above already throws for
    // platform_admin/read_only_reviewer) — kept as an explicit fail-closed
    // default rather than falling through silently.
    return { success: false, message: 'Your role cannot start a copilot conversation.' }
  }

  const { data: conversation, error } = await supabase
    .from('copilot_conversations')
    .insert({
      organization_id: parsed.data.organizationId,
      user_id: user.id,
      role_at_creation: role,
      client_id: clientId,
      recruitment_project_id: recruitmentProjectId,
      data_classification: dataClassification,
      title: parsed.data.title ?? null,
    })
    .select('id')
    .single()

  if (error || !conversation) {
    return { success: false, message: 'Could not start a new copilot conversation.' }
  }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'copilot.conversation_started',
      entityType: 'copilot_conversations',
      entityId: conversation.id,
      metadata: { role, recruitmentProjectId, dataClassification },
    },
    supabase,
  )

  revalidatePath('/copilot')
  return { success: true, message: 'Conversation started.', conversationId: conversation.id }
}

// ---------------------------------------------------------------------------
// 2. sendCopilotMessageAction
// ---------------------------------------------------------------------------

const SendMessageSchema = z.object({
  organizationId: z.string().uuid(),
  conversationId: z.string().uuid(),
  message: z.string().trim().min(1).max(4000),
})

/**
 * A distinct, UI-renderable result for every `CopilotTurnOutcome` variant
 * (brief: "the UI needs to distinguish rate_limited vs
 * unauthorized_tool_attempt vs timeout etc.") plus one action-layer-only
 * variant (`invalid_request`) for a request that never even reached
 * `runCopilotTurn` (bad form input, no session, no permission). Every
 * variant carries a `status` discriminant a UI switch can exhaust.
 */
export type CopilotSendMessageResult =
  | { status: 'invalid_request'; message: string }
  | {
      status: 'success'
      conversationId: string
      messageId: string
      text: string
      citations: CopilotCitation[]
      citationsCaveatApplied: boolean
      unsupportedClaimsStripped: number
      model: string
    }
  | { status: 'not_configured'; conversationId: string; message: string }
  | {
      status: 'permission_narrowed_since_conversation_start'
      conversationId: string
      message: string
    }
  | { status: 'rate_limited'; conversationId: string; message: string }
  | {
      status: 'unauthorized_tool_attempt'
      conversationId: string
      toolName: string
      message: string
    }
  | { status: 'timeout'; conversationId: string; message: string }
  | { status: 'cancelled'; conversationId: string; message: string }
  | { status: 'provider_error'; conversationId: string; message: string }
  | { status: 'validation_rejected'; conversationId: string; message: string }

/**
 * AUDIT ACTION MAPPING (judgment call, flagged for wave 5): `runCopilotTurn`
 * itself already writes `copilot.message_sent` (success),
 * `copilot.rate_limited`, `copilot.unauthorized_tool_attempt` and
 * `copilot.citation_missing` internally (run-copilot-turn.ts's own audit
 * calls) — this action must NOT duplicate those, or every successful/rate-
 * limited/unauthorized turn would produce two audit rows for one event.
 * The outcomes wave 3 does NOT audit on its own —
 * `not_configured`/`permission_narrowed_since_conversation_start`/
 * `timeout`/`cancelled`/`provider_error`/`validation_rejected` — are logged
 * here, under one shared `copilot.turn_failed` action with `status` in its
 * metadata, rather than six new granular AuditAction literals: every one of
 * these is a "the turn could not complete" outcome distinguished only by
 * WHY, and `metadata.outcomeStatus` already carries that distinction
 * losslessly for anyone filtering the audit log — six near-duplicate verb
 * names would not add anything `outcomeStatus` doesn't already give a
 * reader. Flagged explicitly since wave 5's adversarial tests may want to
 * assert on `metadata.outcomeStatus` specifically, not a dedicated action
 * literal, for these six.
 */
const OUTCOMES_ALREADY_AUDITED_BY_RUN_COPILOT_TURN = new Set<CopilotTurnOutcome['status']>([
  'success',
  'rate_limited',
  'unauthorized_tool_attempt',
])

/** Runs one turn of the copilot conversation and maps `runCopilotTurn`'s result onto `CopilotSendMessageResult`. See this file's header comment on why there is no separate cancel action. */
export async function sendCopilotMessageAction(
  formData: FormData,
): Promise<CopilotSendMessageResult> {
  const parsed = SendMessageSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success)
    return { status: 'invalid_request', message: 'Enter a message and try again.' }
  if (!supabaseConfigured)
    return {
      status: 'invalid_request',
      message: 'This environment is not connected to a live database yet.',
    }

  const { supabase, user } = await getAuthedSupabase()
  if (!user) return { status: 'invalid_request', message: GENERIC_AUTH_ERROR_MESSAGE }

  const membership = await requirePermission(
    user.id,
    parsed.data.organizationId,
    'copilot',
    'create',
  )

  const outcome = await runCopilotTurn({
    conversationId: parsed.data.conversationId,
    userMessage: parsed.data.message,
    supabase,
    userId: user.id,
    organizationId: parsed.data.organizationId,
    currentRole: membership.role,
  })

  if (!OUTCOMES_ALREADY_AUDITED_BY_RUN_COPILOT_TURN.has(outcome.status)) {
    await logAuditEvent(
      {
        organizationId: parsed.data.organizationId,
        actorId: user.id,
        action: 'copilot.turn_failed',
        entityType: 'copilot_conversations',
        entityId: parsed.data.conversationId,
        metadata: { outcomeStatus: outcome.status },
      },
      supabase,
    )
  }

  revalidatePath(`/copilot/${parsed.data.conversationId}`)
  revalidatePath('/copilot')

  switch (outcome.status) {
    case 'success':
      return {
        status: 'success',
        conversationId: outcome.conversationId,
        messageId: outcome.messageId,
        text: outcome.text,
        citations: outcome.citations,
        citationsCaveatApplied: outcome.citationsCaveatApplied,
        unsupportedClaimsStripped: outcome.unsupportedClaimsStripped,
        model: outcome.model,
      }
    case 'unauthorized_tool_attempt':
      return {
        status: 'unauthorized_tool_attempt',
        conversationId: outcome.conversationId,
        toolName: outcome.toolName,
        message: outcome.message,
      }
    default:
      return {
        status: outcome.status,
        conversationId: outcome.conversationId,
        message: outcome.message,
      }
  }
}

// ---------------------------------------------------------------------------
// 3. archiveCopilotConversationAction / endCopilotConversationAction
// ---------------------------------------------------------------------------

const ConversationStatusChangeSchema = z.object({
  organizationId: z.string().uuid(),
  conversationId: z.string().uuid(),
})

/** archived <-> active. Owner-only — 0031's `copilot_conversations_update_own` RLS policy is the actual backstop; this action's own `.eq('user_id', user.id)` filter is the same check made explicit rather than relying on RLS to silently no-op the update. */
export async function archiveCopilotConversationAction(formData: FormData): Promise<ActionResult> {
  const parsed = ConversationStatusChangeSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const { supabase, user } = await getAuthedSupabase()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'copilot', 'update')

  const { data: existing } = await supabase
    .from('copilot_conversations')
    .select('status')
    .eq('id', parsed.data.conversationId)
    .eq('organization_id', parsed.data.organizationId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!existing) return { success: false, message: 'Could not find this conversation.' }
  if (existing.status === 'ended')
    return { success: false, message: 'This conversation has ended and can no longer be archived.' }

  const { error } = await supabase
    .from('copilot_conversations')
    .update({ status: 'archived' })
    .eq('id', parsed.data.conversationId)
    .eq('user_id', user.id)
  if (error) return { success: false, message: 'Could not archive this conversation.' }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'copilot.conversation_archived',
      entityType: 'copilot_conversations',
      entityId: parsed.data.conversationId,
      metadata: {},
    },
    supabase,
  )

  revalidatePath('/copilot')
  revalidatePath(`/copilot/${parsed.data.conversationId}`)
  return { success: true, message: 'Conversation archived.' }
}

/** active/archived -> ended. Owner-only, terminal — an ended conversation cannot be reopened (mirrors 0031's status column's plain three-value enum with no reverse transition enforced elsewhere; this action is the only place 'ended' is ever set). */
export async function endCopilotConversationAction(formData: FormData): Promise<ActionResult> {
  const parsed = ConversationStatusChangeSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const { supabase, user } = await getAuthedSupabase()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'copilot', 'update')

  const { data: existing } = await supabase
    .from('copilot_conversations')
    .select('status')
    .eq('id', parsed.data.conversationId)
    .eq('organization_id', parsed.data.organizationId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!existing) return { success: false, message: 'Could not find this conversation.' }
  if (existing.status === 'ended')
    return { success: true, message: 'This conversation has already ended.' }

  const { error } = await supabase
    .from('copilot_conversations')
    .update({ status: 'ended' })
    .eq('id', parsed.data.conversationId)
    .eq('user_id', user.id)
  if (error) return { success: false, message: 'Could not end this conversation.' }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'copilot.conversation_ended',
      entityType: 'copilot_conversations',
      entityId: parsed.data.conversationId,
      metadata: {},
    },
    supabase,
  )

  revalidatePath('/copilot')
  revalidatePath(`/copilot/${parsed.data.conversationId}`)
  return { success: true, message: 'Conversation ended.' }
}

// ---------------------------------------------------------------------------
// 4. recordCopilotFeedbackAction
// ---------------------------------------------------------------------------

const RecordFeedbackSchema = z.object({
  organizationId: z.string().uuid(),
  conversationId: z.string().uuid(),
  messageId: z.string().uuid(),
  rating: z.enum(['helpful', 'not_helpful']),
  comment: z.string().trim().max(1000).optional(),
})

/**
 * Records thumbs-up/down feedback on one assistant message. NO
 * `copilot_message_feedback` table exists in 0031's schema (wave 1's report
 * does not mention one, and this wave is explicitly forbidden from adding a
 * migration) — so, as a pragmatic wave-4 solution, feedback is persisted as
 * structured `metadata` on a `copilot.feedback_recorded` `audit_events` row
 * instead of a dedicated table row. This still satisfies core rule #10
 * ("every AI action... must be auditable" — a feedback signal on an AI
 * response is exactly that), and gives a durable, queryable
 * (`entity_id = messageId`) record, but it is NOT a substitute for a real
 * table: there is no unique-per-(user, message) constraint, so resubmitting
 * feedback appends another audit row rather than upserting one, and nothing
 * here aggregates feedback for a dashboard. FLAGGED FOR A LATER PHASE: a
 * dedicated `copilot_message_feedback` table (message_id, user_id, rating,
 * comment, unique per message+user, its own RLS) would be the cleaner,
 * intended design — this is documented explicitly so it isn't mistaken for
 * the final shape.
 */
export async function recordCopilotFeedbackAction(formData: FormData): Promise<ActionResult> {
  const parsed = RecordFeedbackSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const { supabase, user } = await getAuthedSupabase()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'copilot', 'update')

  // Own-conversation-only, explicit — mirrors every other action in this
  // file (RLS is the real backstop, this is the friendly pre-check): a
  // message can only be rated by the user whose own conversation it lives
  // in, and must actually be an assistant turn (rating your own question
  // makes no sense). Two plain queries rather than an embedded join, same
  // convention as every other loader/action in this codebase.
  const { data: conversation } = await supabase
    .from('copilot_conversations')
    .select('id')
    .eq('id', parsed.data.conversationId)
    .eq('organization_id', parsed.data.organizationId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!conversation) return { success: false, message: 'Could not find this conversation.' }

  const { data: message } = await supabase
    .from('copilot_messages')
    .select('id, role')
    .eq('id', parsed.data.messageId)
    .eq('copilot_conversation_id', parsed.data.conversationId)
    .eq('organization_id', parsed.data.organizationId)
    .maybeSingle()

  if (!message) return { success: false, message: 'Could not find this message.' }
  if (message.role !== 'assistant')
    return { success: false, message: 'Only an assistant response can be rated.' }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'copilot.feedback_recorded',
      entityType: 'copilot_messages',
      entityId: parsed.data.messageId,
      metadata: {
        conversationId: parsed.data.conversationId,
        rating: parsed.data.rating,
        comment: parsed.data.comment ?? null,
      },
    },
    supabase,
  )

  revalidatePath(`/copilot/${parsed.data.conversationId}`)
  return { success: true, message: 'Thanks for the feedback.' }
}
