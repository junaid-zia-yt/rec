import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateMobileRequest } from '@/lib/auth/mobile-session'
import { requirePermission } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit/log'
import { notifyVerificationRequested } from '@/lib/notifications/event-triggers'

/**
 * POST /api/mobile/verification-requests/[id]/open — Build Phase 13
 * Wave 1.
 *
 * Mirrors `openVerificationRequestAction`
 * (apps/web/lib/shortlists/verification-actions.ts). ADAPTATION: the web
 * action's `[id]` (`candidateRoleMatchId`, the record the verification
 * request is opened AGAINST) does not exist yet as a verification_requests
 * row at the time this is called — there is no existing verification
 * request id to key the route on. So, unlike every other `[id]` route in
 * this wave, `[id]` here is the `candidateRoleMatchId`, not a
 * verification_requests id (that id is only created by this call, and is
 * returned in the response). This is flagged explicitly since it departs
 * from the otherwise-consistent `[id] = the resource being acted on`
 * convention.
 *
 * Request body:
 * {
 *   organizationId: string (uuid)
 *   candidateId: string (uuid)
 *   requirementId?: string (uuid)
 *   note: string (1-1000 chars)
 * }
 *
 * Response:
 * { success: true, data: { verificationRequestId } }
 * { success: false, error: string }
 */
const BodySchema = z.object({
  organizationId: z.string().uuid(),
  candidateId: z.string().uuid(),
  requirementId: z.string().uuid().optional(),
  note: z.string().trim().min(1, 'A note is required to request verification.').max(1000),
})

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: candidateRoleMatchId } = await params
  if (!z.string().uuid().safeParse(candidateRoleMatchId).success) {
    return NextResponse.json(
      { success: false, error: 'Invalid candidate role match id.' },
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

  const { data: match } = await supabase
    .from('candidate_role_matches')
    .select('latest_matching_run_id')
    .eq('id', candidateRoleMatchId)
    .single()
  if (!match) {
    return NextResponse.json(
      { success: false, error: 'Could not find the match record for this request.' },
      { status: 404 },
    )
  }

  const { data: humanReview } = await supabase
    .from('human_reviews')
    .insert({
      organization_id: parsed.data.organizationId,
      candidate_role_match_id: candidateRoleMatchId,
      matching_run_id: match.latest_matching_run_id,
      reviewer_id: user.id,
      decision: 'requires_verification',
      reason: parsed.data.note,
    })
    .select('id')
    .single()

  const { data: request_, error } = await supabase
    .from('verification_requests')
    .insert({
      organization_id: parsed.data.organizationId,
      candidate_role_match_id: candidateRoleMatchId,
      human_review_id: humanReview?.id ?? null,
      requirement_id: parsed.data.requirementId ?? null,
      requested_by: user.id,
      request_note: parsed.data.note,
    })
    .select('id')
    .single()

  if (error || !request_) {
    return NextResponse.json(
      { success: false, error: 'Could not open the verification request.' },
      { status: 400 },
    )
  }

  await supabase
    .from('candidate_role_matches')
    .update({
      review_status: 'requires_verification',
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', candidateRoleMatchId)
    .eq('organization_id', parsed.data.organizationId)

  try {
    const [{ data: matchDetail }, { data: candidate }] = await Promise.all([
      supabase
        .from('candidate_role_matches')
        .select('recruitment_project_id')
        .eq('id', candidateRoleMatchId)
        .maybeSingle(),
      supabase
        .from('candidates')
        .select('full_name')
        .eq('id', parsed.data.candidateId)
        .maybeSingle(),
    ])
    if (matchDetail?.recruitment_project_id) {
      await notifyVerificationRequested({
        organizationId: parsed.data.organizationId,
        actorUserId: user.id,
        verificationRequestId: request_.id,
        recruitmentProjectId: matchDetail.recruitment_project_id as string,
        candidateName: (candidate?.full_name as string | undefined) ?? 'A candidate',
        supabase,
      })
    }
  } catch (notifyError) {
    console.error(
      '[mobile/verification] notifyVerificationRequested failed:',
      notifyError instanceof Error ? notifyError.message : notifyError,
    )
  }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'candidate_match.verification_requested',
      entityType: 'verification_requests',
      entityId: request_.id,
      metadata: { candidateRoleMatchId, note: parsed.data.note },
    },
    supabase,
  )

  return NextResponse.json({ success: true, data: { verificationRequestId: request_.id } })
}
