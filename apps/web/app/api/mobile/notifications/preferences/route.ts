import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { NotificationEventType } from '@rqi/types'
import { authenticateMobileRequest } from '@/lib/auth/mobile-session'
import { requireOrgMembership } from '@/lib/auth/session'
import { upsertNotificationPreference } from '@/lib/notifications/preferences'

/**
 * PUT /api/mobile/notifications/preferences — Build Phase 13 Wave 1.
 *
 * Mirrors `updateNotificationPreferenceAction`
 * (apps/web/lib/notifications/notification-actions.ts) exactly — a thin
 * wrapper over `upsertNotificationPreference`, own-user only.
 *
 * Request body:
 * {
 *   organizationId: string (uuid)
 *   eventType: 'scorecard_awaiting_approval' | 'candidate_awaiting_review' |
 *     'verification_requested' | 'outreach_awaiting_approval' |
 *     'candidate_responded' | 'shortlist_awaiting_client_decision' |
 *     'integration_failed' | 'poc_completed'
 *   inAppEnabled: boolean
 *   emailEnabled: boolean
 * }
 *
 * Response:
 * { success: true, data: { eventType, inAppEnabled, emailEnabled } }
 * { success: false, error: string }
 */
const BodySchema = z.object({
  organizationId: z.string().uuid(),
  eventType: z.enum([
    'scorecard_awaiting_approval',
    'candidate_awaiting_review',
    'verification_requested',
    'outreach_awaiting_approval',
    'candidate_responded',
    'shortlist_awaiting_client_decision',
    'integration_failed',
    'poc_completed',
  ]),
  inAppEnabled: z.boolean(),
  emailEnabled: z.boolean(),
})

export async function PUT(request: Request) {
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

  try {
    await upsertNotificationPreference({
      organizationId: parsed.data.organizationId,
      userId: user.id,
      eventType: parsed.data.eventType as NotificationEventType,
      inAppEnabled: parsed.data.inAppEnabled,
      emailEnabled: parsed.data.emailEnabled,
      supabase,
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Could not update this preference.',
      },
      { status: 400 },
    )
  }

  return NextResponse.json({
    success: true,
    data: {
      eventType: parsed.data.eventType,
      inAppEnabled: parsed.data.inAppEnabled,
      emailEnabled: parsed.data.emailEnabled,
    },
  })
}
