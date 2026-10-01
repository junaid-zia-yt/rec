import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateMobileRequest } from '@/lib/auth/mobile-session'
import { requireOrgMembership } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit/log'

/**
 * POST /api/mobile/notifications/[id]/read — Build Phase 13 Wave 1.
 *
 * Mirrors `markNotificationReadAction`
 * (apps/web/lib/notifications/notification-actions.ts) exactly: `[id]` is
 * the notification id. `requireOrgMembership` only (not `requirePermission`
 * — RLS's own-recipient-only update policy is the real backstop; this just
 * establishes the caller is a member of the notification's org first, same
 * as the web action).
 *
 * Request body: `{ organizationId: string (uuid) }`
 *
 * Response:
 * { success: true, data: { notificationId, alreadyRead: boolean } }
 * { success: false, error: string }
 */
const BodySchema = z.object({ organizationId: z.string().uuid() })

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: notificationId } = await params
  if (!z.string().uuid().safeParse(notificationId).success) {
    return NextResponse.json({ success: false, error: 'Invalid notification id.' }, { status: 400 })
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

  try {
    await requireOrgMembership(user.id, parsed.data.organizationId, supabase)
  } catch {
    return NextResponse.json(
      { success: false, error: 'You do not have access to this organization.' },
      { status: 403 },
    )
  }

  const { data: updated, error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .eq('recipient_user_id', user.id)
    .is('read_at', null)
    .select('id')
    .maybeSingle()

  if (error) {
    return NextResponse.json(
      { success: false, error: 'Could not mark this notification read.' },
      { status: 400 },
    )
  }
  if (!updated) {
    return NextResponse.json({ success: true, data: { notificationId, alreadyRead: true } })
  }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'notification.read',
      entityType: 'notifications',
      entityId: updated.id as string,
    },
    supabase,
  )

  return NextResponse.json({ success: true, data: { notificationId, alreadyRead: false } })
}
