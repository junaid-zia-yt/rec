'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { supabaseConfigured } from '@/lib/env'
import { logAuditEvent } from '@/lib/audit/log'
import { GENERIC_AUTH_ERROR_MESSAGE } from '@/lib/auth/errors'
import { requireOrgMembership } from '@/lib/auth/session'
import { upsertNotificationPreference } from './preferences'
import type { ActionResult } from '@/lib/auth/actions'
import type { NotificationEventType } from '@rqi/types'

/**
 * Build Phase 12, Wave 5 (Task B) — notification-center write actions.
 * `notifications` RLS (0032) is own-recipient-only and read_at-only
 * mutation (`notifications_update_own_read_at` + the
 * `notifications_read_only_mutation` trigger, which raises if anything but
 * `read_at`, from null, is ever changed) — every write below only ever
 * sets `read_at`, never anything else, matching that constraint exactly.
 * The `notifications` resource's app-layer `'full'` grant
 * (`packages/types/src/permissions.ts`, every role but `platform_admin`)
 * is therefore never actually exercised as "arbitrary write access" here —
 * it can only ever mean "mark my own notification(s) read", which is all
 * the DB permits regardless of the matrix's literal 'full' label.
 */

const MarkReadSchema = z.object({
  organizationId: z.string().uuid(),
  notificationId: z.string().uuid(),
})

export async function markNotificationReadAction(formData: FormData): Promise<ActionResult> {
  const parsed = MarkReadSchema.safeParse({
    organizationId: formData.get('organizationId'),
    notificationId: formData.get('notificationId'),
  })
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  // requireOrgMembership only — RLS itself is what actually confines this
  // update to the caller's OWN notification row (recipient_user_id =
  // auth.uid()); this call just establishes the caller is a real member of
  // the org the notification belongs to before attempting the write.
  await requireOrgMembership(user.id, parsed.data.organizationId)

  const { data: updated, error } = await supabase!
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', parsed.data.notificationId)
    .eq('recipient_user_id', user.id)
    .is('read_at', null)
    .select('id')
    .maybeSingle()

  if (error) return { success: false, message: 'Could not mark this notification read.' }
  // Already read (or not this user's) — not an error; idempotent no-op.
  if (!updated) {
    revalidatePath('/notifications')
    return { success: true, message: 'Notification already read.' }
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

  revalidatePath('/notifications')
  return { success: true, message: 'Marked read.' }
}

const MarkAllReadSchema = z.object({
  organizationId: z.string().uuid(),
})

/** Marks every currently-unread notification for the caller read, one row at a time (there is no bulk-update path around `notifications_read_only_mutation`'s per-row trigger, and this keeps the same, already-correct single-row update this module's `markNotificationReadAction` uses). Best-effort per row — one failed row does not abort the rest. */
export async function markAllNotificationsReadAction(formData: FormData): Promise<ActionResult> {
  const parsed = MarkAllReadSchema.safeParse({ organizationId: formData.get('organizationId') })
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requireOrgMembership(user.id, parsed.data.organizationId)

  const { data: unread, error: lookupError } = await supabase!
    .from('notifications')
    .select('id')
    .eq('recipient_user_id', user.id)
    .eq('organization_id', parsed.data.organizationId)
    .is('read_at', null)

  if (lookupError) return { success: false, message: 'Could not load your unread notifications.' }
  if (!unread || unread.length === 0) return { success: true, message: 'Nothing to mark read.' }

  const nowIso = new Date().toISOString()
  let markedCount = 0
  for (const row of unread) {
    const { error } = await supabase!
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

  revalidatePath('/notifications')
  return {
    success: true,
    message: `Marked ${markedCount} notification${markedCount === 1 ? '' : 's'} read.`,
  }
}

const UpdatePreferenceSchema = z.object({
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
  inAppEnabled: z.coerce.boolean(),
  emailEnabled: z.coerce.boolean(),
})

/** Thin wrapper over Wave 4's `upsertNotificationPreference` — own-user only (that helper's own RLS-mirroring design; `userId` here is always the caller, never a parameter someone else could supply). */
export async function updateNotificationPreferenceAction(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = UpdatePreferenceSchema.safeParse({
    organizationId: formData.get('organizationId'),
    eventType: formData.get('eventType'),
    inAppEnabled: formData.get('inAppEnabled') ?? 'false',
    emailEnabled: formData.get('emailEnabled') ?? 'false',
  })
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requireOrgMembership(user.id, parsed.data.organizationId)

  try {
    await upsertNotificationPreference({
      organizationId: parsed.data.organizationId,
      userId: user.id,
      eventType: parsed.data.eventType as NotificationEventType,
      inAppEnabled: parsed.data.inAppEnabled,
      emailEnabled: parsed.data.emailEnabled,
      supabase: supabase!,
    })
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Could not update this preference.',
    }
  }

  revalidatePath('/settings/notifications')
  return { success: true, message: 'Preference updated.' }
}
