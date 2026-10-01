/**
 * `notification_dispatch` handler — Build Phase 12 Wave 2's one real (not
 * illustrative-stub) handler. Inserts one `notifications` row (0032) for
 * the payload's recipient, honoring that recipient's own
 * `notification_preferences.in_app_enabled` (defaulting to `true`/enabled
 * when no preference row exists yet, per 0032's own documented default).
 *
 * WHY THIS ONE, AND NOT THE OTHERS, THIS WAVE: `notifications` (0032) is
 * itself a Wave-1-delivered table with no dependency on any not-yet-built
 * domain feature — inserting into it is a complete, real, testable
 * operation today. `document_processing`/`ai_extraction`/
 * `candidate_evaluation`/`report_generation` all wrap EXISTING synchronous
 * pipelines (Phase 5/6/7/10) that this wave deliberately does NOT migrate
 * into job handlers — that migration (deciding whether/how each pipeline's
 * own server actions should enqueue a job instead of running inline, and
 * updating their callers) belongs to whichever wave owns that domain, not
 * to the generic engine wave, per this wave's brief ("DO NOT force-fit
 * fake handlers... just to have something there").
 *
 * EMAIL IS DELIBERATELY NOT SENT HERE: 0032's own migration comment
 * documents email as a SEPARATE preference (`email_enabled`, opt-in,
 * default false) and a separate delivery mechanism (Resend, via
 * `email_delivery` jobs / `lib/outreach/channels/email.ts`'s pattern) from
 * in-app notification rows. Wave 2 does not own the notification system's
 * design (Wave 4 does, per this wave's brief) — this handler intentionally
 * does the one unambiguous, schema-supported thing (write the in-app row)
 * and leaves "should this also enqueue/send an email_delivery job" as an
 * explicit decision for Wave 4 to make once it designs the actual
 * email-notification templates/content, rather than this wave guessing at
 * that content.
 */
import type { NotificationDispatchPayload } from '../job-payload-schemas'
import type { JobExecutionContext, JobHandler } from '../types'

export interface NotificationDispatchResult {
  notificationId: string | null
  /** True when a notifications row was actually inserted; false when the recipient's own in_app_enabled preference is off, in which case this is a deliberate no-op, not a failure. */
  dispatched: boolean
}

export const notificationDispatchHandler: JobHandler<
  NotificationDispatchPayload,
  NotificationDispatchResult
> = async (payload, context: JobExecutionContext) => {
  const supabase = context.supabase

  const { data: preference, error: preferenceError } = await supabase
    .from('notification_preferences')
    .select('in_app_enabled')
    .eq('user_id', payload.recipientUserId)
    .eq('event_type', payload.eventType)
    .maybeSingle()

  if (preferenceError) {
    throw new Error(
      `notificationDispatchHandler: could not load notification preference: ${preferenceError.message}`,
    )
  }

  // No row = the documented default (0032 migration comment): in-app on.
  const inAppEnabled = (preference?.in_app_enabled as boolean | undefined) ?? true
  if (!inAppEnabled) {
    return { notificationId: null, dispatched: false }
  }

  const { data: inserted, error: insertError } = await supabase
    .from('notifications')
    .insert({
      organization_id: context.organizationId,
      recipient_user_id: payload.recipientUserId,
      event_type: payload.eventType,
      title: payload.title,
      body: payload.body ?? null,
      resource_type: payload.resourceType ?? null,
      resource_id: payload.resourceId ?? null,
    })
    .select('id')
    .single()

  if (insertError || !inserted) {
    throw new Error(
      `notificationDispatchHandler: could not insert notification: ${insertError?.message ?? 'unknown error'}`,
    )
  }

  return { notificationId: inserted.id as string, dispatched: true }
}
