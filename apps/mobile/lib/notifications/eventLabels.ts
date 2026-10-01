import type { NotificationEventType } from '@rqi/types'

/**
 * Human-readable labels for the brief's exact 8 notification events
 * (`packages/types/src/index.ts`'s `NotificationEventType`). Shared by the
 * Notifications screen (event-type row label) and the Notification
 * preferences screen (per-event-type toggle row) so the copy never drifts
 * between the two. Static, non-sensitive copy — safe to hold in the
 * reference-data cache (lib/cache/referenceCache.ts) for an instant warm
 * start, and safe to ship inline here regardless since it never changes
 * per-user.
 */
export const NOTIFICATION_EVENT_LABELS: Record<NotificationEventType, string> = {
  scorecard_awaiting_approval: 'Scorecard awaiting approval',
  candidate_awaiting_review: 'Candidate awaiting review',
  verification_requested: 'Verification requested',
  outreach_awaiting_approval: 'Outreach awaiting approval',
  candidate_responded: 'Candidate responded',
  shortlist_awaiting_client_decision: 'Shortlist awaiting client decision',
  integration_failed: 'Integration failed',
  poc_completed: 'POC completed',
}

/** The closed list of event types, in the same fixed order the
 * Notification preferences screen renders them — kept here (not
 * re-derived from `Object.keys`, whose order is a JS implementation
 * detail for non-numeric keys, though stable in practice) so the order is
 * an explicit, intentional choice. */
export const NOTIFICATION_EVENT_TYPES: NotificationEventType[] = [
  'scorecard_awaiting_approval',
  'candidate_awaiting_review',
  'verification_requested',
  'outreach_awaiting_approval',
  'candidate_responded',
  'shortlist_awaiting_client_decision',
  'integration_failed',
  'poc_completed',
]

export function notificationEventLabel(eventType: string): string {
  return (
    (NOTIFICATION_EVENT_LABELS as Record<string, string>)[eventType] ?? eventType.replace(/_/g, ' ')
  )
}
