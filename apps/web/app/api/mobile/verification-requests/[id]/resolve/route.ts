import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateMobileRequest } from '@/lib/auth/mobile-session'
import { requirePermission } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit/log'

/**
 * POST /api/mobile/verification-requests/[id]/resolve — Build Phase 13
 * Wave 1.
 *
 * Mirrors `resolveVerificationRequestAction`
 * (apps/web/lib/shortlists/verification-actions.ts) exactly: `[id]` is the
 * verification_requests id.
 *
 * Request body:
 * {
 *   organizationId: string (uuid)
 *   outcome: 'resolved' | 'cancelled'
 *   resolutionNote: string (1-1000 chars)
 * }
 *
 * Response:
 * { success: true, data: { verificationRequestId, outcome } }
 * { success: false, error: string }
 */
const BodySchema = z.object({
  organizationId: z.string().uuid(),
  outcome: z.enum(['resolved', 'cancelled']),
  resolutionNote: z.string().trim().min(1, 'A resolution note is required.').max(1000),
})

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: verificationRequestId } = await params
  if (!z.string().uuid().safeParse(verificationRequestId).success) {
    return NextResponse.json(
      { success: false, error: 'Invalid verification request id.' },
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
      {
        success: false,
        error: parsed.error.issues[0]?.message ?? 'Check the request body and try again.',
      },
      { status: 400 },
    )
  }

  try {
    await requirePermission(
      user.id,
      parsed.data.organizationId,
      'human_reviews',
      'update',
      supabase,
    )
  } catch {
    return NextResponse.json(
      { success: false, error: 'You do not have permission to perform this action.' },
      { status: 403 },
    )
  }

  const { data: requestRow, error } = await supabase
    .from('verification_requests')
    .update({
      status: parsed.data.outcome,
      resolved_by: user.id,
      resolved_at: new Date().toISOString(),
      resolution_note: parsed.data.resolutionNote,
    })
    .eq('id', verificationRequestId)
    .eq('organization_id', parsed.data.organizationId)
    .select('id')
    .single()

  if (error || !requestRow) {
    return NextResponse.json(
      { success: false, error: 'Could not resolve the verification request.' },
      { status: 400 },
    )
  }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'candidate_match.verification_resolved',
      entityType: 'verification_requests',
      entityId: requestRow.id,
      metadata: { outcome: parsed.data.outcome, resolutionNote: parsed.data.resolutionNote },
    },
    supabase,
  )

  return NextResponse.json({
    success: true,
    data: { verificationRequestId, outcome: parsed.data.outcome },
  })
}
