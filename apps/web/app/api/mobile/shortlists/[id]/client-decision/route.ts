import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateMobileRequest } from '@/lib/auth/mobile-session'
import { requirePermission } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit/log'

/**
 * POST /api/mobile/shortlists/[id]/client-decision — Build Phase 13
 * Wave 1.
 *
 * Mirrors `recordClientDecisionAction`
 * (apps/web/lib/shortlists/shortlist-actions.ts) exactly: `[id]` is the
 * shortlist id. This is the ONE action gated on the 'approve' permission
 * level on 'shortlists' — the only action a client_decision_maker can
 * take on this resource per the permission matrix.
 *
 * Request body:
 * {
 *   organizationId: string (uuid)
 *   shortlistVersionId: string (uuid)
 *   clientId: string (uuid)
 *   decision: 'accept' | 'discuss' | 'reject'
 *   notes?: string (max 4000 chars — required unless decision === 'accept')
 * }
 *
 * Response:
 * { success: true, data: { shortlistId, decision } }
 * { success: false, error: string }
 */
const BodySchema = z.object({
  organizationId: z.string().uuid(),
  shortlistVersionId: z.string().uuid(),
  clientId: z.string().uuid(),
  decision: z.enum(['accept', 'discuss', 'reject']),
  notes: z.string().trim().max(4000).optional(),
})

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: shortlistId } = await params
  if (!z.string().uuid().safeParse(shortlistId).success) {
    return NextResponse.json({ success: false, error: 'Invalid shortlist id.' }, { status: 400 })
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
  if (parsed.data.decision !== 'accept' && !parsed.data.notes) {
    return NextResponse.json(
      { success: false, error: 'Notes are required when discussing or rejecting a shortlist.' },
      { status: 400 },
    )
  }

  try {
    await requirePermission(user.id, parsed.data.organizationId, 'shortlists', 'approve', supabase)
  } catch {
    return NextResponse.json(
      { success: false, error: 'You do not have permission to perform this action.' },
      { status: 403 },
    )
  }

  const { data: decisionRow, error } = await supabase
    .from('client_decisions')
    .insert({
      organization_id: parsed.data.organizationId,
      shortlist_id: shortlistId,
      shortlist_version_id: parsed.data.shortlistVersionId,
      client_id: parsed.data.clientId,
      decided_by: user.id,
      decision: parsed.data.decision,
      notes: parsed.data.notes ?? null,
    })
    .select('id')
    .single()

  if (error || !decisionRow) {
    return NextResponse.json(
      { success: false, error: 'Could not record this decision.' },
      { status: 400 },
    )
  }

  await supabase.from('shortlists').update({ status: parsed.data.decision }).eq('id', shortlistId)

  await supabase.from('shortlist_activity').insert({
    organization_id: parsed.data.organizationId,
    shortlist_id: shortlistId,
    actor_id: user.id,
    action: `client_${parsed.data.decision}`,
    summary: `Client ${parsed.data.decision === 'accept' ? 'accepted' : parsed.data.decision === 'discuss' ? 'requested discussion on' : 'rejected'} the shortlist.`,
    client_visible: true,
  })

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'shortlist.client_decided',
      entityType: 'client_decisions',
      entityId: decisionRow.id,
      metadata: { decision: parsed.data.decision, notes: parsed.data.notes },
    },
    supabase,
  )

  return NextResponse.json({ success: true, data: { shortlistId, decision: parsed.data.decision } })
}
