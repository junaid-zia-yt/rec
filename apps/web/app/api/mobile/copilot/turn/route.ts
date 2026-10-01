import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateMobileRequest } from '@/lib/auth/mobile-session'
import { requirePermission } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit/log'
import {
  runCopilotTurn,
  type CopilotTurnOutcome,
} from '@/lib/copilot/orchestration/run-copilot-turn'

/**
 * POST /api/mobile/copilot/turn — Build Phase 13 Wave 1.
 *
 * Mirrors `sendCopilotMessageAction`
 * (apps/web/lib/copilot/copilot-actions.ts) exactly: same 'copilot'/
 * 'create' gate, hands off to the SAME `runCopilotTurn` orchestrator
 * (never re-implemented), same "don't double-audit the outcomes
 * `runCopilotTurn` already logs itself" mapping. This route does not
 * start a conversation (`startCopilotConversationAction` is not built
 * this wave — see report); the mobile app must already have a
 * `conversationId` (created via the web app for this wave, or a future
 * `/api/mobile/copilot/conversations` route).
 *
 * Request body:
 * {
 *   organizationId: string (uuid)
 *   conversationId: string (uuid)
 *   message: string (1-4000 chars)
 * }
 *
 * Response — mirrors `CopilotSendMessageResult`'s discriminated union
 * exactly, wrapped as `{ success: boolean, data: {...} }`:
 * { success: true, data: { status: 'success', conversationId, messageId, text, citations, citationsCaveatApplied, unsupportedClaimsStripped, model } }
 * { success: false, data: { status: 'not_configured' | 'permission_narrowed_since_conversation_start' | 'rate_limited' | 'timeout' | 'cancelled' | 'provider_error' | 'validation_rejected', conversationId, message } }
 * { success: false, data: { status: 'unauthorized_tool_attempt', conversationId, toolName, message } }
 * { success: false, error: string } — request never reached `runCopilotTurn` (bad body, no session, no permission)
 */
const BodySchema = z.object({
  organizationId: z.string().uuid(),
  conversationId: z.string().uuid(),
  message: z.string().trim().min(1).max(4000),
})

const OUTCOMES_ALREADY_AUDITED_BY_RUN_COPILOT_TURN = new Set<CopilotTurnOutcome['status']>([
  'success',
  'rate_limited',
  'unauthorized_tool_attempt',
])

export async function POST(request: Request) {
  const auth = await authenticateMobileRequest(request)
  if ('error' in auth) return auth.error
  const { user, supabase } = auth

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body.' }, { status: 400 })
  }

  const parsed = BodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Enter a message and try again.' },
      { status: 400 },
    )
  }

  let membership
  try {
    membership = await requirePermission(
      user.id,
      parsed.data.organizationId,
      'copilot',
      'create',
      supabase,
    )
  } catch {
    return NextResponse.json(
      { success: false, error: 'You do not have permission to use the copilot.' },
      { status: 403 },
    )
  }

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

  if (outcome.status === 'success') {
    return NextResponse.json({
      success: true,
      data: {
        status: 'success',
        conversationId: outcome.conversationId,
        messageId: outcome.messageId,
        text: outcome.text,
        citations: outcome.citations,
        citationsCaveatApplied: outcome.citationsCaveatApplied,
        unsupportedClaimsStripped: outcome.unsupportedClaimsStripped,
        model: outcome.model,
      },
    })
  }

  if (outcome.status === 'unauthorized_tool_attempt') {
    return NextResponse.json(
      {
        success: false,
        data: {
          status: 'unauthorized_tool_attempt',
          conversationId: outcome.conversationId,
          toolName: outcome.toolName,
          message: outcome.message,
        },
      },
      { status: 403 },
    )
  }

  return NextResponse.json(
    {
      success: false,
      data: {
        status: outcome.status,
        conversationId: outcome.conversationId,
        message: outcome.message,
      },
    },
    { status: 200 },
  )
}
