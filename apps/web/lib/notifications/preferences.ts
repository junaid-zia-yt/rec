import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { NotificationEventType, NotificationPreference } from '@rqi/types'
import { logAuditEvent } from '@/lib/audit/log'
import { NOTIFICATION_EVENT_TYPES } from './types'

/**
 * Build Phase 12, Wave 4 — small read/write helpers over
 * `notification_preferences` (0032), for Wave 5's server actions/UI to
 * build on. RLS (`notification_preferences_own_full`) already confines
 * every one of these to the CALLER's own session (`user_id = auth.uid()`)
 * — these helpers never take an arbitrary `userId` to read/write someone
 * else's preferences; `userId` here is always "the caller", never a
 * cross-user parameter, matching that RLS policy's own shape.
 */

function rowToPreference(row: Record<string, unknown>): NotificationPreference {
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    userId: row.user_id as string,
    eventType: row.event_type as NotificationEventType,
    inAppEnabled: row.in_app_enabled as boolean,
    emailEnabled: row.email_enabled as boolean,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

/** The documented default for an event type with no row yet (0032's own column defaults: `in_app_enabled` true, `email_enabled` false) — the single source of truth every reader (this module, `notification-dispatch.ts`, a future UI) should use rather than re-hardcoding `{ true, false }` ad hoc. */
export function defaultNotificationPreference(
  eventType: NotificationEventType,
): Pick<NotificationPreference, 'eventType' | 'inAppEnabled' | 'emailEnabled'> {
  return { eventType, inAppEnabled: true, emailEnabled: false }
}

/**
 * Loads every `notification_preferences` row for the caller in this org,
 * filled out to the full 8-event set via `defaultNotificationPreference`
 * for any event type with no row yet — so a caller (a preferences form)
 * never has to special-case "no row" itself.
 */
export async function getNotificationPreferences(
  organizationId: string,
  userId: string,
  supabase: SupabaseClient,
): Promise<
  Array<
    Pick<NotificationPreference, 'eventType' | 'inAppEnabled' | 'emailEnabled'> & {
      id: string | null
    }
  >
> {
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('id, event_type, in_app_enabled, email_enabled')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)

  if (error) {
    throw new Error(`getNotificationPreferences: could not load preferences: ${error.message}`)
  }

  const byEventType = new Map(
    (data ?? []).map((row) => [
      row.event_type as NotificationEventType,
      {
        id: row.id as string,
        eventType: row.event_type as NotificationEventType,
        inAppEnabled: row.in_app_enabled as boolean,
        emailEnabled: row.email_enabled as boolean,
      },
    ]),
  )

  return NOTIFICATION_EVENT_TYPES.map(
    (eventType) =>
      byEventType.get(eventType) ?? { id: null, ...defaultNotificationPreference(eventType) },
  )
}

/** Loads a single event type's preference for the caller, or the documented default if no row exists yet. */
export async function getNotificationPreference(
  organizationId: string,
  userId: string,
  eventType: NotificationEventType,
  supabase: SupabaseClient,
): Promise<Pick<NotificationPreference, 'eventType' | 'inAppEnabled' | 'emailEnabled'>> {
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('in_app_enabled, email_enabled')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .eq('event_type', eventType)
    .maybeSingle()

  if (error) {
    throw new Error(`getNotificationPreference: could not load preference: ${error.message}`)
  }
  if (!data) return defaultNotificationPreference(eventType)
  return {
    eventType,
    inAppEnabled: data.in_app_enabled as boolean,
    emailEnabled: data.email_enabled as boolean,
  }
}

export interface UpsertNotificationPreferenceParams {
  organizationId: string
  userId: string
  eventType: NotificationEventType
  inAppEnabled: boolean
  emailEnabled: boolean
  supabase: SupabaseClient
}

/**
 * Creates or updates the caller's own preference row for one event type
 * (the `unique (user_id, event_type)` constraint means at most one row can
 * ever exist for this pair). Looks the row up first, then inserts or
 * updates accordingly — the same explicit look-up-then-write shape
 * `enqueueJob` uses for its own idempotent insert, rather than relying on
 * `.upsert()`'s conflict-target syntax, so this stays exercisable against
 * this codebase's simple in-memory test fake
 * (`lib/copilot/orchestration/test-fake-supabase.ts`, which implements
 * `select`/`insert`/`update` but not `upsert`) without adding a new method
 * to a fake several other test suites already share. Writes a
 * `notification.preferences_updated` audit row, per this wave's brief
 * ("new `notification.*` AuditAction literals from wave 1").
 */
export async function upsertNotificationPreference(
  params: UpsertNotificationPreferenceParams,
): Promise<NotificationPreference> {
  const { data: existing, error: lookupError } = await params.supabase
    .from('notification_preferences')
    .select('id')
    .eq('organization_id', params.organizationId)
    .eq('user_id', params.userId)
    .eq('event_type', params.eventType)
    .maybeSingle()

  if (lookupError) {
    throw new Error(
      `upsertNotificationPreference: could not look up existing preference: ${lookupError.message}`,
    )
  }

  const writeResult = existing
    ? await params.supabase
        .from('notification_preferences')
        .update({ in_app_enabled: params.inAppEnabled, email_enabled: params.emailEnabled })
        .eq('id', existing.id as string)
        .select('*')
        .single()
    : await params.supabase
        .from('notification_preferences')
        .insert({
          organization_id: params.organizationId,
          user_id: params.userId,
          event_type: params.eventType,
          in_app_enabled: params.inAppEnabled,
          email_enabled: params.emailEnabled,
        })
        .select('*')
        .single()

  const { data, error } = writeResult
  if (error || !data) {
    throw new Error(
      `upsertNotificationPreference: could not save preference: ${error?.message ?? 'unknown error'}`,
    )
  }

  await logAuditEvent(
    {
      organizationId: params.organizationId,
      actorId: params.userId,
      action: 'notification.preferences_updated',
      entityType: 'notification_preferences',
      entityId: data.id as string,
      after: {
        eventType: params.eventType,
        inAppEnabled: params.inAppEnabled,
        emailEnabled: params.emailEnabled,
      },
    },
    params.supabase,
  )

  return rowToPreference(data)
}
