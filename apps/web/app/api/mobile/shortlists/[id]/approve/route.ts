import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateMobileRequest } from '@/lib/auth/mobile-session'
import { requirePermission } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit/log'
import { validateOverrideAuthorization } from '@/lib/shortlists/rules'

/**
 * POST /api/mobile/shortlists/[id]/approve — Build Phase 13 Wave 1.
 *
 * Mirrors `internallyApproveShortlistAction`
 * (apps/web/lib/shortlists/shortlist-actions.ts) exactly: `[id]` is the
 * shortlist id (`shortlistId` in the web action). This is the internal
 * agency sign-off step ONLY (gated on 'update', never 'approve' — see the
 * web action's own comment on why: the permission matrix's 'approve'
 * ACTION on 'shortlists' is what client_decision_maker's decision uses,
 * not an agency-internal sign-off). Sending the shortlist to the client
 * is a deliberate, separate act — not built in this wave (see report).
 *
 * Request body:
 * {
 *   organizationId: string (uuid)
 *   shortlistVersionId: string (uuid)
 *   overrideMaxCandidates?: boolean
 *   overrideReason?: string (max 2000 chars)
 * }
 *
 * Response:
 * { success: true, data: { shortlistId, shortlistVersionId, status: 'internally_approved' } }
 * { success: false, error: string }
 */
const BodySchema = z.object({
  organizationId: z.string().uuid(),
  shortlistVersionId: z.string().uuid(),
  overrideMaxCandidates: z.boolean().optional(),
  overrideReason: z.string().trim().max(2000).optional(),
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

  try {
    await requirePermission(user.id, parsed.data.organizationId, 'shortlists', 'update', supabase)
  } catch {
    return NextResponse.json(
      { success: false, error: 'You do not have permission to perform this action.' },
      { status: 403 },
    )
  }

  if (parsed.data.overrideMaxCandidates) {
    const authError = validateOverrideAuthorization({
      overrideMaxCandidates: true,
      overrideBy: user.id,
      overrideReason: parsed.data.overrideReason ?? null,
    })
    if (authError) {
      return NextResponse.json({ success: false, error: authError }, { status: 400 })
    }

    await supabase
      .from('shortlists')
      .update({
        override_max_candidates: true,
        override_by: user.id,
        override_reason: parsed.data.overrideReason,
      })
      .eq('id', shortlistId)
  }

  const { error: versionError } = await supabase
    .from('shortlist_versions')
    .update({
      status: 'internally_approved',
      internally_approved_by: user.id,
      internally_approved_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.shortlistVersionId)
  if (versionError) {
    return NextResponse.json(
      { success: false, error: 'Could not record internal approval.' },
      { status: 400 },
    )
  }

  await supabase.from('shortlists').update({ status: 'internally_approved' }).eq('id', shortlistId)

  await supabase.from('shortlist_activity').insert({
    organization_id: parsed.data.organizationId,
    shortlist_id: shortlistId,
    actor_id: user.id,
    action: 'internally_approved',
    summary: 'Shortlist internally approved.',
    client_visible: false,
  })

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'shortlist.internally_approved',
      entityType: 'shortlist_versions',
      entityId: parsed.data.shortlistVersionId,
      metadata: { overrideMaxCandidates: Boolean(parsed.data.overrideMaxCandidates) },
    },
    supabase,
  )

  return NextResponse.json({
    success: true,
    data: {
      shortlistId,
      shortlistVersionId: parsed.data.shortlistVersionId,
      status: 'internally_approved',
    },
  })
}
