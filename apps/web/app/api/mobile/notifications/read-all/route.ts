import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateMobileRequest } from '@/lib/auth/mobile-session'
import { requireOrgMembership } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit/log'

/**
 * POST /api/mobile/notifications/read-all — Build Phase 13 Wave 1.
 *
 * Mirrors `markAllNotificationsReadAction`
 * (apps/web/lib/notifications/notification-actions.ts) exactly: same
 * per-row-update loop (no bulk-update path exists around the DB's
 * per-row `notifications_read_only_mutation` trigger).
 *
 * Request body: `{ organizationId: string (uuid) }`
 *
 * Response:
 * { success: true, data: { markedCount: number, attempted: number } }
 * { success: false, error: string }
 */
const BodySchema = z.object({ organizationId: z.string().uuid() })

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
      { success: false, error: 'Check the request body and try again.' },
      { status: 400 },
    )
  }

  try {
    await requireOrgMembership(user.id, parsed.data.organizationId, supabase)
  } catch {
    return NextResponse.json(
      { success: false, error: 'You do not have access to this organization.' },
      { status: 403 },
    )
  }

  const { data: unread, error: lookupError } = await supabase
    .from('notifications')
    .select('id')
    .eq('recipient_user_id', user.id)
    .eq('organization_id', parsed.data.organizationId)
    .is('read_at', null)

  if (lookupError) {
    return NextResponse.json(
      { success: false, error: 'Could not load your unread notifications.' },
      { status: 400 },
    )
  }
  if (!unread || unread.length === 0) {
    return NextResponse.json({ success: true, data: { markedCount: 0, attempted: 0 } })
  }

  const nowIso = new Date().toISOString()
  let markedCount = 0
  for (const row of unread) {
    const { error } = await supabase
      .from('notifications')
      .update({ read_at: nowIso })
      .eq('id', row.id)
      .eq('recipient_user_id', user.id)
      .is('read_at', null)
    if (!error) markedCount += 1
  }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'notification.read',
      entityType: 'notifications',
      metadata: { bulk: true, markedCount, attempted: unread.length },
    },
    supabase,
  )

  return NextResponse.json({ success: true, data: { markedCount, attempted: unread.length } })
}
