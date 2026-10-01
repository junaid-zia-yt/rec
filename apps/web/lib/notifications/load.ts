import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { NotificationEventType } from '@rqi/types'
import { getNotificationPreferences } from './preferences'
import type { NotificationPreference } from '@rqi/types'

/**
 * Build Phase 12, Wave 5 (Task C) — the current user's own `notifications`
 * read loader for the notification center. RLS
 * (`notifications_select_own`, 0032) already confines every read here to
 * `recipient_user_id = auth.uid()` — this loader never takes an arbitrary
 * `userId` parameter, only "the caller".
 *
 * Deep links are DELIBERATELY NOT resolved here — `buildPermissionSafeDeepLink`
 * (`lib/notifications/resource-link.ts`) must be called fresh at
 * render/click time by the UI layer itself, never precomputed or cached
 * (see that module's own header note); this loader returns the raw
 * `resourceType`/`resourceId` pair only.
 */

export interface NotificationListRow {
  id: string
  eventType: NotificationEventType
  title: string
  body: string | null
  resourceType: string | null
  resourceId: string | null
  readAt: string | null
  createdAt: string
}

/** Chronological (most-recent-first) — the notification center's own list ordering choice; unread state is rendered per-row rather than by resorting the list, so a just-read notification doesn't jump position mid-session. */
export async function loadNotifications(
  userId: string,
  supabase: SupabaseClient,
  limit = 50,
): Promise<NotificationListRow[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('id, event_type, title, body, resource_type, resource_id, read_at, created_at')
    .eq('recipient_user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    throw new Error(`loadNotifications: could not load notifications: ${error.message}`)
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    eventType: row.event_type as NotificationEventType,
    title: row.title as string,
    body: (row.body as string | null) ?? null,
    resourceType: (row.resource_type as string | null) ?? null,
    resourceId: (row.resource_id as string | null) ?? null,
    readAt: (row.read_at as string | null) ?? null,
    createdAt: row.created_at as string,
  }))
}

export interface NotificationCounts {
  unread: number
  total: number
}

export async function loadNotificationCounts(
  userId: string,
  supabase: SupabaseClient,
): Promise<NotificationCounts> {
  const [{ count: total, error: totalError }, { count: unread, error: unreadError }] =
    await Promise.all([
      supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_user_id', userId),
      supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_user_id', userId)
        .is('read_at', null),
    ])

  if (totalError || unreadError) {
    throw new Error(
      `loadNotificationCounts: could not load counts: ${(totalError ?? unreadError)?.message}`,
    )
  }

  return { unread: unread ?? 0, total: total ?? 0 }
}

/** Re-exported for the preferences settings screen — thin pass-through so page/component files import everything notification-related from this one loader module by convention (mirrors `lib/poc/load.ts` re-exporting `load-detail.ts` helpers). */
export async function loadNotificationPreferencesForUser(
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
  return getNotificationPreferences(organizationId, userId, supabase)
}
