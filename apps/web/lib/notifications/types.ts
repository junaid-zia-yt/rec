/**
 * Build Phase 12, Wave 4 — the notification system's shared types.
 *
 * `NotificationEventType`/`NotificationRecord`/`NotificationPreference` are
 * NOT redefined here: they already exist in `@rqi/types` (added by Wave 1
 * against `supabase/migrations/0032_integrations_jobs_notifications.sql`)
 * and are re-exported below so every file in this directory has one import
 * source, mirroring `lib/jobs/types.ts`'s own re-export pattern exactly.
 *
 * NAME COLLISION (Wave 1's own flag, repeated here so it is never
 * rediscovered by accident): `@rqi/types` ALSO exports an unrelated, LEGACY
 * Build Phase 1 demo `NotificationSchema`/`Notification`
 * (`packages/types/src/index.ts` ~line 493), which backs
 * `apps/web/lib/mock-data.ts`'s `DEMO_NOTIFICATIONS` — a hard-coded,
 * not-DB-aligned fixture the current `/notifications` page still renders
 * (Wave 5's job to replace, not this wave's). Nothing in this directory
 * ever imports that legacy `Notification`/`NotificationSchema` — every
 * import here is the real, DB-backed `NotificationRecord`/
 * `NotificationEventType`/`NotificationPreference` family, exactly as Wave
 * 1 named it specifically to avoid this collision.
 */
import type { NotificationEventType, NotificationPreference, NotificationRecord } from '@rqi/types'

export type { NotificationEventType, NotificationPreference, NotificationRecord }
export {
  NotificationEventType as NotificationEventTypeEnum,
  NotificationRecordSchema,
  NotificationPreferenceSchema,
} from '@rqi/types'

/** The brief's exact 8 notification events, as a plain runtime array (for iteration — e.g. building a preferences form) — mirrors `NotificationEventType.options` (the Zod enum's own array) so nothing here re-lists the 8 values a second time by hand. */
export const NOTIFICATION_EVENT_TYPES: readonly NotificationEventType[] = [
  'scorecard_awaiting_approval',
  'candidate_awaiting_review',
  'verification_requested',
  'outreach_awaiting_approval',
  'candidate_responded',
  'shortlist_awaiting_client_decision',
  'integration_failed',
  'poc_completed',
] as const
