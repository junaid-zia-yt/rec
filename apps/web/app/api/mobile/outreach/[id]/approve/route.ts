import { NextResponse } from 'next/server'
import { z } from 'zod'
import type {
  CommunicationChannel,
  CommunicationPreferenceStatus,
  OutreachMessageStatus,
} from '@rqi/types'
import { authenticateMobileRequest } from '@/lib/auth/mobile-session'
import { requirePermission } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit/log'
import { captureError } from '@/lib/monitoring/capture'
import { checkOutreachOptOutGate } from '@/lib/outreach/opt-out'

/**
 * POST /api/mobile/outreach/[id]/approve — Build Phase 13 Wave 1.
 *
 * Mirrors `recordOutreachApprovalAction`
 * (apps/web/lib/outreach/outreach-actions.ts) exactly: `[id]` is the
 * outreach message id (`outreachMessageId` in the web action). Same
 * 'outreach'/'update' gate (see that file's PERMISSIONS NOTE — 'outreach'
 * has no role with the 'approve' permission LEVEL at all, so this is
 * gated on the 'update' ACTION, never 'approve', exactly like the web
 * action), same opt-out gate check on an 'approved' decision, same audit
 * action mapping. No `revalidatePath` (no meaning for a JSON API —
 * intentionally omitted).
 *
 * Request body:
 * {
 *   organizationId: string (uuid)
 *   decision: 'approved' | 'rejected' | 'changes_requested'
 *   reason?: string (max 2000 chars — required unless decision === 'approved')
 *   editedBeforeApproval?: boolean
 * }
 *
 * Response:
 * { success: true, data: { outreachMessageId, status } }
 * { success: false, error: string }
 */
const BodySchema = z.object({
  organizationId: z.string().uuid(),
  decision: z.enum(['approved', 'rejected', 'changes_requested']),
  reason: z.string().trim().max(2000).optional(),
  editedBeforeApproval: z.boolean().optional(),
})

const APPROVAL_AUDIT_ACTION = {
  approved: 'outreach.approved',
  rejected: 'outreach.rejected',
  changes_requested: 'outreach.changes_requested',
} as const

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: outreachMessageId } = await params
  if (!z.string().uuid().safeParse(outreachMessageId).success) {
    return NextResponse.json(
      { success: false, error: 'Invalid outreach message id.' },
      { status: 400 },
    )
  }

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
      { success: false, error: 'Check the request body and try again.' },
      { status: 400 },
    )
  }
  if (parsed.data.decision !== 'approved' && !parsed.data.reason) {
    return NextResponse.json(
      { success: false, error: 'A reason is required when rejecting or requesting changes.' },
      { status: 400 },
    )
  }

  try {
    await requirePermission(user.id, parsed.data.organizationId, 'outreach', 'update', supabase)
  } catch {
    return NextResponse.json(
      { success: false, error: 'You do not have permission to perform this action.' },
      { status: 403 },
    )
  }

  const { data: existing } = await supabase
    .from('outreach_messages')
    .select('status, outreach_sequence_id, channel, candidate_id')
    .eq('id', outreachMessageId)
    .eq('organization_id', parsed.data.organizationId)
    .maybeSingle()

  if (!existing) {
    return NextResponse.json(
      { success: false, error: 'Could not find this message.' },
      { status: 404 },
    )
  }
  if (existing.status !== 'awaiting_approval') {
    return NextResponse.json(
      { success: false, error: 'Only a message awaiting approval can be decided on.' },
      { status: 409 },
    )
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
    if (!gate.allowed) {
      return NextResponse.json({ success: false, error: gate.reason }, { status: 409 })
    }
  }

  const { data: approval, error: approvalError } = await supabase
    .from('outreach_approvals')
    .insert({
      organization_id: parsed.data.organizationId,
      outreach_message_id: outreachMessageId,
      approver_id: user.id,
      decision: parsed.data.decision,
      reason: parsed.data.reason ?? null,
      edited_before_approval: Boolean(parsed.data.editedBeforeApproval),
    })
    .select('id')
    .single()

  if (approvalError || !approval) {
    return NextResponse.json(
      { success: false, error: 'Could not record this decision.' },
      { status: 400 },
    )
  }

  const { error: statusError } = await supabase
    .from('outreach_messages')
    .update({ status: nextStatus })
    .eq('id', outreachMessageId)
  if (statusError) {
    // A genuine server-side failure (not the well-formed 400/403/409
    // branches above, which are normal operation) — the approval decision
    // itself was already durably recorded, but the message's own status
    // update failed, leaving it inconsistent until someone notices.
    captureError(new Error(`outreach status update failed: ${statusError.message}`), {
      category: 'api',
      organizationId: parsed.data.organizationId,
      extra: { route: 'mobile/outreach/[id]/approve', outreachMessageId },
    })
    return NextResponse.json(
      {
        success: false,
        error: 'The decision was recorded but the message status could not be updated.',
      },
      { status: 500 },
    )
  }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: APPROVAL_AUDIT_ACTION[parsed.data.decision],
      entityType: 'outreach_messages',
      entityId: outreachMessageId,
      metadata: { reason: parsed.data.reason ?? null },
    },
    supabase,
  )

  return NextResponse.json({ success: true, data: { outreachMessageId, status: nextStatus } })
}
