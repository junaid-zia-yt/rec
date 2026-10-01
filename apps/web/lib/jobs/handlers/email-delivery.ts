/**
 * `email_delivery` job handler — Build Phase 12, Wave 4. Fills the registry
 * slot Wave 2 deliberately left empty (`handlers/index.ts`'s own header
 * note lists `email_delivery` among the types with "NO entry").
 *
 * SCOPE OF THIS WAVE'S IMPLEMENTATION: only the NOTIFICATION branch
 * (`NotificationEmailDeliveryPayload`, `../job-payload-schemas.ts`) is
 * actually implemented here — this wave's job is the notification system,
 * not outreach. The ORIGINAL Build Phase 9 outreach-message branch
 * (`OutreachEmailDeliveryPayload`) predates this job engine entirely:
 * `lib/outreach/outreach-actions.ts` already calls
 * `getEmailChannelAdapter().send(...)` directly and synchronously today —
 * no wave has ever enqueued an `email_delivery` job for an outreach
 * message, so there is no existing behavior to preserve or migrate here.
 * This handler therefore throws a clear, typed error for that branch
 * rather than pretending to send (which would either silently duplicate a
 * send outreach-actions.ts already performed inline, or send with no
 * caller-supplied context this handler was never given) — an honest
 * `no_handler`-equivalent failure (retries with backoff, eventually
 * dead-letters) is the correct behavior for "this job type exists in the
 * schema but this particular payload shape has no real handler yet",
 * exactly like `handlers/index.ts`'s own documented convention for a
 * wholly-unregistered job type. A future wave that migrates outreach
 * sending onto the job engine should replace this stub with a real
 * implementation, not silently work around it.
 *
 * NOTIFICATION BRANCH: re-fetches the `notifications` row (never trusts a
 * payload-carried title/body a caller could have gone stale on — the DB
 * row, written moments earlier by `notification-dispatch-handler.ts`, is
 * the source of truth), builds the email via
 * `lib/notifications/email-template.ts`, resolves a permission-safe deep
 * link via `lib/notifications/resource-link.ts` (best-effort: a failure to
 * resolve one is not a reason to fail the whole email — see inline
 * comment), and sends it through the EXISTING Resend adapter
 * (`lib/outreach/channels/email.ts`'s `getEmailChannelAdapter()` — reused
 * directly, never a second send code path, per this wave's brief).
 *
 * HONEST AUDITABILITY WHEN RESEND ISN'T CONFIGURED: `getEmailChannelAdapter()`
 * itself already picks the clearly-labelled development/no-op adapter when
 * `resendConfigured` is false (`simulated: true`, no network call) — this
 * handler does not re-implement that branching, it just calls the
 * selector and lets it decide, then returns whatever it reports. This
 * means an `email_delivery` job (and its `job.completed` audit row) is
 * always created and recorded even when Resend is not configured, per this
 * wave's brief ("never silently skip creating the audit trail just
 * because email isn't configured").
 */
import type { NotificationEventType, Role } from '@rqi/types'
import { supabaseAdminConfigured } from '@/lib/env'
import { createAdminClient } from '@/lib/supabase/admin'
import { getEmailChannelAdapter } from '@/lib/outreach/channels/email'
import {
  buildNotificationEmail,
  NOTIFICATIONS_FROM_ADDRESS,
} from '@/lib/notifications/email-template'
import {
  buildPermissionSafeDeepLink,
  EVENT_TYPE_RESOURCE_TYPE,
} from '@/lib/notifications/resource-link'
import type { EmailDeliveryPayload } from '../job-payload-schemas'
import type { JobExecutionContext, JobHandler } from '../types'

export interface EmailDeliveryResult {
  status: 'sent' | 'failed' | 'not_configured'
  simulated: boolean
  provider: string
  providerMessageId: string | null
}

/**
 * A recipient's email address lives on Supabase's own `auth.users`, not on
 * `public.user_profiles` (0003's own comment: full_name/avatar_url only,
 * "1:1 with auth.users" — no email column) — and `auth.users` is not
 * queryable by an ordinary RLS-scoped client the way every other table in
 * this schema is, even for the CALLER's own row (that is why every
 * existing use of a user's own email in this codebase, e.g.
 * `decideScorecardApprovalAction`'s `user.email`, reads it off the already-
 * authenticated session object, never a table query). For an ARBITRARY
 * recipient (this handler needs the notified user's email, not the
 * caller's own), the only path is the Supabase Admin API's
 * `auth.admin.getUserById`, which requires the service-role client — the
 * same `createAdminClient()` `lib/auth/actions.ts` already uses for its
 * own auth.users-touching operations (account creation), reused here
 * rather than inventing a second privileged-client pattern. This is the
 * one place in the notification system that steps outside the caller's
 * own RLS-scoped session — narrowly, and only to resolve an email address,
 * never to read/write any other table.
 */
async function loadRecipientEmail(userId: string): Promise<string | null> {
  if (!supabaseAdminConfigured) return null
  const admin = createAdminClient()
  const { data, error } = await admin.auth.admin.getUserById(userId)
  if (error || !data.user) return null
  return data.user.email ?? null
}

/**
 * The recipient's CURRENT, live role in this org — read directly off
 * `context.supabase` (the SAME client the executor itself is running
 * under, per `lib/jobs/types.ts`'s `JobExecutionContext` contract: "a
 * handler must never construct its own Supabase client"). Deliberately
 * NOT `lib/auth/session.ts`'s `requireOrgMembership`, which internally
 * calls `createServerSupabaseClient()` — a fresh, cookie/request-scoped
 * client with no meaning inside a background job execution (there is no
 * inbound HTTP request here to read a session cookie from).
 */
async function loadRecipientRole(
  context: JobExecutionContext,
  userId: string,
): Promise<Role | null> {
  const { data } = await context.supabase
    .from('organization_memberships')
    .select('role')
    .eq('organization_id', context.organizationId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle()
  return (data?.role as Role | undefined) ?? null
}

export const emailDeliveryHandler: JobHandler<EmailDeliveryPayload, EmailDeliveryResult> = async (
  payload,
  context: JobExecutionContext,
) => {
  if ('outreachMessageId' in payload) {
    throw new Error(
      "emailDeliveryHandler: the outreach-message email_delivery branch is not implemented (Build Phase 9 sends outreach messages inline via outreach-actions.ts, never through this job type today) — see this handler file's own header note.",
    )
  }

  const { notificationId, recipientUserId, eventType } = payload

  const { data: notification, error: notificationError } = await context.supabase
    .from('notifications')
    .select('event_type, title, body, resource_type, resource_id')
    .eq('id', notificationId)
    .maybeSingle()

  if (notificationError || !notification) {
    throw new Error(
      `emailDeliveryHandler: could not load notification ${notificationId}: ${notificationError?.message ?? 'not found'}`,
    )
  }

  const recipientEmail = await loadRecipientEmail(recipientUserId)
  if (!recipientEmail) {
    throw new Error(
      `emailDeliveryHandler: could not resolve an email address for recipient ${recipientUserId}`,
    )
  }

  // Deep-link resolution here is a best-effort, DISPATCH-TIME snapshot —
  // see email-template.ts's own header note on why this is an accepted
  // tradeoff for email specifically. A failure to resolve one (recipient's
  // access already revoked, or their live role could not be determined)
  // must not fail the whole email send — the notification's own text is
  // still useful without a link.
  let deepLinkPath: string | null = null
  const resourceType = notification.resource_type ? EVENT_TYPE_RESOURCE_TYPE[eventType] : null
  if (resourceType && notification.resource_id) {
    try {
      const viewerRole = await loadRecipientRole(context, recipientUserId)
      if (viewerRole) {
        const result = await buildPermissionSafeDeepLink({
          resourceType,
          resourceId: notification.resource_id as string,
          viewerUserId: recipientUserId,
          viewerRole,
          organizationId: context.organizationId,
          supabase: context.supabase,
        })
        deepLinkPath = result.accessible ? result.path : null
      }
    } catch {
      deepLinkPath = null
    }
  }

  const email = buildNotificationEmail(
    {
      eventType: notification.event_type as NotificationEventType,
      title: notification.title as string,
      body: notification.body as string | null,
    },
    deepLinkPath,
  )

  const adapter = getEmailChannelAdapter()
  const result = await adapter.send({
    id: notificationId,
    organizationId: context.organizationId,
    channel: 'email',
    subject: email.subject,
    body: email.bodyText,
    idempotencyKey: `notification:${notificationId}:${payload.attemptNumber}`,
    senderUserId: null,
    senderAccountIdentifier: NOTIFICATIONS_FROM_ADDRESS,
    recipientAddress: recipientEmail,
    recipientDisplayName: null,
  })

  if (result.status === 'sent') {
    return {
      status: 'sent',
      simulated: result.simulated,
      provider: result.provider,
      providerMessageId: result.providerMessageId,
    }
  }
  if (result.status === 'not_configured') {
    return {
      status: 'not_configured',
      simulated: true,
      provider: result.provider,
      providerMessageId: null,
    }
  }
  // 'failed' — thrown so the executor's normal retry/dead-letter
  // bookkeeping applies, exactly like every other handler in this
  // directory (handlers must let real failures propagate, never swallow
  // them — lib/jobs/types.ts's own JobHandler contract comment).
  throw new Error(
    `emailDeliveryHandler: send failed via ${result.provider}: ${result.errorMessage}`,
  )
}
