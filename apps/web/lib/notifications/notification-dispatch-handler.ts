/**
 * Build Phase 12, Wave 4 — extends Wave 2's `notificationDispatchHandler`
 * (`lib/jobs/handlers/notification-dispatch.ts`) with the decision that
 * file's own header note explicitly left open: "Wave 4 must decide whether
 * `notification_dispatch` should also enqueue an `email_delivery` job when
 * `email_enabled` is true."
 *
 * DECISION: yes, via a FOLLOW-ON JOB, never an inline send from inside
 * this handler. Reasons:
 *   1. Keeps this job's own retry/idempotency bookkeeping simple — writing
 *      the in-app row and sending an email are two different failure
 *      domains (a transient DB hiccup vs. a Resend outage); coupling them
 *      into one handler means a Resend failure would retry the ALREADY-
 *      SUCCEEDED in-app insert too (this handler's own idempotency key on
 *      a re-run would just find the row it already wrote via
 *      `enqueueJob`'s own dedup, so it is not strictly unsafe, but it is
 *      unnecessary work and muddies what "this job failed" means).
 *   2. Mirrors this wave's own constraint ("never write directly to
 *      `notifications`... always go through `enqueueJob`") applied
 *      symmetrically to the email side: an email send is itself
 *      enqueued as its own auditable, retryable unit of work through the
 *      SAME job engine, not performed as a side effect buried inside
 *      another job's handler body.
 *
 * THIS FILE WRAPS, IT DOES NOT DUPLICATE: `notificationDispatchHandler`
 * (Wave 2) is called first, unmodified, for the actual in-app
 * `notifications` insert — this module never re-implements that insert or
 * the `in_app_enabled` preference check. It only adds the follow-on
 * `email_delivery` enqueue, gated on the SAME recipient's `email_enabled`
 * preference (0032: opt-in, default false) and on `resendConfigured`.
 *
 * `resendConfigured` GATING — READ THE BRIEF'S EXACT WORDING BEFORE
 * CHANGING THIS: "If `resendConfigured` is false, the email job should
 * still be created for auditability but the underlying send will honestly
 * report `simulated: true`... never silently skip creating the audit
 * trail just because email isn't configured." This handler therefore does
 * NOT gate the `email_delivery` enqueue on `resendConfigured` at all — only
 * on the recipient's own `email_enabled` preference. `getEmailChannelAdapter()`
 * (called later, inside `lib/jobs/handlers/email-delivery.ts`) is what
 * actually branches on `resendConfigured`, selecting the clearly-labelled
 * development/no-op adapter when it is false. This handler's own job is
 * only to decide WHETHER an email should be attempted at all (the
 * recipient's preference), never HOW it gets sent.
 *
 * Registered in `lib/jobs/handlers/index.ts` under `notification_dispatch`
 * in place of Wave 2's raw handler — see that file's own comment on why
 * that one-line substitution is the intended, documented extension point.
 */
import { notificationDispatchHandler as baseNotificationDispatchHandler } from '@/lib/jobs/handlers/notification-dispatch'
import { enqueueJob } from '@/lib/jobs/enqueue'
import type { NotificationDispatchPayload } from '@/lib/jobs/job-payload-schemas'
import type { JobExecutionContext, JobHandler } from '@/lib/jobs/types'
import { logAuditEvent } from '@/lib/audit/log'

export interface NotificationDispatchWithEmailResult {
  notificationId: string | null
  dispatched: boolean
  /** Whether an `email_delivery` job was also enqueued for this notification — `false` when the in-app row was suppressed (`in_app_enabled` off — see note below), when the recipient's `email_enabled` preference is off, or when no notification was written at all. */
  emailEnqueued: boolean
}

export const notificationDispatchWithEmailHandler: JobHandler<
  NotificationDispatchPayload,
  NotificationDispatchWithEmailResult
> = async (payload, context: JobExecutionContext) => {
  const base = await baseNotificationDispatchHandler(payload, context)

  // Whichever session is actually RUNNING this job — the same
  // `context.supabase.auth.getUser()` lookup `lib/jobs/executor.ts` itself
  // uses for its own `job.started`/`job.completed` audit rows, reused here
  // (a) as the `notification.created` audit row's actor (never the
  // notification's RECIPIENT, who did not cause this write) and (b) as the
  // `email_delivery` follow-on job's `enqueueJob({ userId })` — that
  // job's own `job.enqueued` audit row needs a real actor too, and the
  // running session is the honest one, not the person about to receive
  // the email.
  let actorId: string | null = null
  try {
    const { data: authData } = await context.supabase.auth.getUser()
    actorId = authData?.user?.id ?? null
  } catch {
    // No live/mocked auth session available (e.g. a unit test's minimal
    // fake client) — falls through to the recipient-as-fallback below,
    // same as a genuinely anonymous/service execution would need to.
    actorId = null
  }

  if (base.notificationId && actorId) {
    // `notification.created` — one of the three `notification.*`
    // AuditAction literals Wave 1 reserved for this wave. Never logged if
    // the actor lookup comes back empty (executor.ts's own convention: an
    // audit-log failure/absence here must not fail the job).
    await logAuditEvent(
      {
        organizationId: context.organizationId,
        actorId,
        action: 'notification.created',
        entityType: 'notifications',
        entityId: base.notificationId,
        metadata: { eventType: payload.eventType, recipientUserId: payload.recipientUserId },
      },
      context.supabase,
    )
  }

  // Wave 2's own handler returns `dispatched: false` (no row inserted, no
  // error) when the recipient's `in_app_enabled` preference is off — a
  // recipient who has turned off IN-APP notifications for this event type
  // has said nothing about email either way, so this wrapper still checks
  // `email_enabled` independently below even when `dispatched` is false.
  // The one thing it truly cannot do without an in-app row is build an
  // `email_delivery` payload that needs a real `notificationId` to
  // re-fetch title/body from at send time (this handler's own dispatch-
  // time snapshot design — see `email-template.ts`) — so no notification
  // row at all (`base.notificationId === null`) means no email either,
  // regardless of the email preference, since there would be nothing for
  // the email handler to load.
  if (!base.notificationId) {
    return { ...base, emailEnqueued: false }
  }

  const { data: preference, error: preferenceError } = await context.supabase
    .from('notification_preferences')
    .select('email_enabled')
    .eq('user_id', payload.recipientUserId)
    .eq('event_type', payload.eventType)
    .maybeSingle()

  if (preferenceError) {
    throw new Error(
      `notificationDispatchWithEmailHandler: could not load email preference: ${preferenceError.message}`,
    )
  }

  // 0032's own documented default for a missing row: email OFF (opt-in,
  // not opt-out) — unlike in_app_enabled, which defaults ON.
  const emailEnabled = (preference?.email_enabled as boolean | undefined) ?? false
  if (!emailEnabled) {
    return { ...base, emailEnqueued: false }
  }

  await enqueueJob({
    organizationId: context.organizationId,
    jobType: 'email_delivery',
    payload: {
      notificationId: base.notificationId,
      recipientUserId: payload.recipientUserId,
      eventType: payload.eventType,
      attemptNumber: 1,
    },
    // Deterministic per (notification, attempt) — a retried
    // notification_dispatch run (e.g. after a transient failure between
    // the in-app insert and this point) must not enqueue a second email
    // job for the SAME already-created notification.
    idempotencyKey: `notification-email:${base.notificationId}:1`,
    correlationId: context.correlationId,
    supabase: context.supabase,
    // Prefer the running session's own user (see this function's header
    // note); fall back to the recipient only when that cannot be
    // determined at all, so `enqueueJob`'s required `userId` always has a
    // real value to attribute the `job.enqueued` audit row to.
    userId: actorId ?? payload.recipientUserId,
  })

  return { ...base, emailEnqueued: true }
}
