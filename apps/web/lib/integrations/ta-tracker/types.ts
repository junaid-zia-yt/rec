/**
 * TA Tracker — shared types across all three connection modes (Build Phase
 * 12 Wave 3). Read docs/11-integration-plan.md §11.2 and
 * docs/18-blocking-questions.md Q-P2-03 before touching anything in this
 * directory: there is NO documentation, NO API, and NO credentials for TA
 * Tracker, and the project instructions explicitly forbid inventing one
 * ("Do not invent a TA Tracker API"). `supabase/migrations/0032_
 * integrations_jobs_notifications.sql`'s
 * `integration_connections_ta_tracker_api_mode_honesty` CHECK makes it
 * structurally impossible for a `provider = 'ta_tracker' AND mode = 'api'`
 * row to ever reach `status = 'connected'` at the database layer — every
 * file in this directory mirrors that same honesty at the application
 * layer:
 *
 *   - `api-mode.ts`  — STUB ONLY. Cannot be made to report success.
 *   - `csv-mode.ts`  — REAL. Generic file-format capability; needs no
 *     vendor-specific knowledge, so it CAN legitimately work.
 *   - `manual-exchange-mode.ts` — REAL. A documented manual handoff
 *     workflow; needs no vendor-specific knowledge either.
 *
 * `IntegrationConnectionMode`/`IntegrationConnectionStatus` are Wave 1's
 * own `@rqi/types` enums — re-exported here only for convenience, never
 * redefined.
 */
import type { IntegrationConnectionMode, IntegrationConnectionStatus } from '@rqi/types'

export type { IntegrationConnectionMode, IntegrationConnectionStatus }

/**
 * The canonical, platform-owned candidate/job field names every TA Tracker
 * CSV mode (import and export) maps to or from. This is NOT a TA Tracker
 * vendor format — it is this platform's own documented schema, which a
 * recruiter's TA Tracker admin can map their own export/import against
 * manually. Keeping this list in one place is what lets `csv-mode.ts`'s
 * import and export stay symmetric.
 */
export const TA_TRACKER_CANDIDATE_CSV_COLUMNS = [
  'full_name',
  'email',
  'phone',
  'current_title',
  'years_experience',
  'source',
  'linkedin_url',
  'notes',
] as const
export type TaTrackerCandidateCsvColumn = (typeof TA_TRACKER_CANDIDATE_CSV_COLUMNS)[number]

export const TA_TRACKER_JOB_CSV_COLUMNS = [
  'job_title',
  'department',
  'location',
  'employment_type',
  'status',
  'target_start_date',
] as const
export type TaTrackerJobCsvColumn = (typeof TA_TRACKER_JOB_CSV_COLUMNS)[number]
