import type { NotificationRecord } from '@rqi/types'
import { env } from '@/lib/env'

/**
 * Build Phase 12, Wave 4 — plain, honest email templates for the 8
 * notification events, built from an already-written `notifications` row
 * (`NotificationRecord`). No fancy HTML required by the brief ("plain and
 * clear is fine") — `bodyHtml` is a minimal, safe wrapper around the same
 * text, not a separate design pass.
 *
 * LINK-FRESHNESS TRADEOFF — READ BEFORE ASSUMING THIS IS THE SAME
 * GUARANTEE AS THE IN-APP CENTER (documented here, not just in the brief,
 * since it is easy to miss): email is composed at DISPATCH time (when the
 * `notification_dispatch` job runs and builds the follow-on `email_delivery`
 * job's payload), not at the moment the recipient actually opens the email
 * client days or weeks later. The link embedded below is therefore
 * inherently a SNAPSHOT of `buildPermissionSafeDeepLink`'s result at
 * dispatch time — it is NOT re-validated again at the instant of composing
 * this email, and it is certainly not re-validated at the instant the
 * recipient clicks it in their inbox.
 *
 * This is an ACCEPTED, DELIBERATE tradeoff, not an oversight, for one
 * reason: the destination page itself still re-checks the CURRENT viewer's
 * access when it loads (every route in this app already does this via
 * `requireAuth`/`resolveActiveOrg`/the page's own data-loading query, which
 * is itself RLS-scoped) — so a stale email link can at worst 404/
 * permission-deny at click time, exactly like any other stale bookmark to
 * a resource the viewer no longer has access to. It can NEVER become a
 * path to a resource the clicking user cannot currently access, because
 * the destination page's own auth check is what actually enforces that,
 * independent of how stale the link that got them there was. The
 * PERMISSION-SAFE guarantee `resource-link.ts` provides — re-validating
 * access and refusing to hand back a link at all when access has been
 * revoked — matters most for the IN-APP notification center specifically,
 * since that is a PERSISTENT, potentially long-lived LIST of links a user
 * might click much later, and Wave 5's UI is expected to call
 * `buildPermissionSafeDeepLink` fresh every time it renders that list, not
 * once. An email is a single, one-shot message with no such persistent
 * re-render moment to hook a fresh check into — composing it without a
 * link at all would just make the email less useful for no real security
 * gain, since the destination page's own auth is the actual backstop
 * either way.
 */

/**
 * No per-notification "from" identity concept exists for platform
 * notifications the way `outreach_messages.sender_account_identifier`
 * exists for a recruiter's own outreach (Phase 9) — these are system-
 * generated, not sent "as" any one user. `env.NOTIFICATIONS_FROM_EMAIL`
 * (added by this wave, optional, mirroring every other *_API_KEY's
 * optional/never-crash treatment in `lib/env.ts`) is the configured
 * sender; when unset, a clearly-labelled placeholder is used so a
 * misconfigured deployment fails obviously (a bounce/rejected send) rather
 * than silently claiming to be sent from nothing. Never claimed to work
 * until a real domain is configured and verified with Resend, per project
 * convention.
 */
export const NOTIFICATIONS_FROM_ADDRESS =
  env.NOTIFICATIONS_FROM_EMAIL || 'notifications@not-yet-configured.invalid'

export interface NotificationEmailContent {
  subject: string
  bodyText: string
  bodyHtml: string
}

const EVENT_LABEL: Record<NotificationRecord['eventType'], string> = {
  scorecard_awaiting_approval: 'Scorecard awaiting approval',
  candidate_awaiting_review: 'Candidate awaiting review',
  verification_requested: 'Verification requested',
  outreach_awaiting_approval: 'Outreach draft awaiting approval',
  candidate_responded: 'Candidate responded',
  shortlist_awaiting_client_decision: 'Shortlist awaiting your decision',
  integration_failed: 'Integration sync failed',
  poc_completed: 'POC benchmark completed',
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Builds one notification's email content. `deepLinkPath` is OPTIONAL and
 * supplied by the CALLER (the `notification_dispatch` handler, which is
 * the one place with a live Supabase session and the recipient's live
 * role/org already in hand to call `buildPermissionSafeDeepLink` itself —
 * this module stays pure/link-agnostic on purpose, taking the resolved
 * path as a plain string rather than importing `resource-link.ts` and
 * doing I/O of its own, so it stays trivially unit-testable with no
 * Supabase fake required). `null`/omitted means either the notification
 * has no resource (rare, per 0032's schema) or the deep-link check failed
 * at dispatch time (already-revoked access) — the email is still sent,
 * just without a link, rather than silently dropped.
 */
export function buildNotificationEmail(
  notification: Pick<NotificationRecord, 'eventType' | 'title' | 'body'>,
  deepLinkPath?: string | null,
): NotificationEmailContent {
  const label = EVENT_LABEL[notification.eventType]
  const subject = notification.title
  const bodyLine = notification.body ?? notification.title
  const appUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')
  const absoluteLink = deepLinkPath ? `${appUrl}${deepLinkPath}` : null

  const bodyTextLines = [
    bodyLine,
    '',
    `Event: ${label}`,
    absoluteLink ? `View: ${absoluteLink}` : null,
  ].filter((line): line is string => line !== null)

  const bodyHtmlParts = [
    `<p>${escapeHtml(bodyLine)}</p>`,
    `<p style="color:#6b7280;font-size:13px;">${escapeHtml(label)}</p>`,
    absoluteLink
      ? `<p><a href="${escapeHtml(absoluteLink)}">Open in Recruitment Quality Intelligence</a></p>`
      : '',
  ].filter(Boolean)

  return {
    subject,
    bodyText: bodyTextLines.join('\n'),
    bodyHtml: bodyHtmlParts.join('\n'),
  }
}
