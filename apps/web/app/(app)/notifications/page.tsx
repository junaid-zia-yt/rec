import { EmptyState, PageHeader } from '@rqi/ui'
import { Bell } from 'lucide-react'
import { supabaseConfigured } from '@/lib/env'
import { requireAuth, resolveActiveOrg } from '@/lib/auth/session'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { loadNotifications } from '@/lib/notifications/load'
import {
  buildPermissionSafeDeepLink,
  EVENT_TYPE_RESOURCE_TYPE,
  type NotificationResourceType,
} from '@/lib/notifications/resource-link'
import {
  NotificationCenterList,
  type NotificationRowView,
} from '@/components/domain/notifications/notification-center-list'

export const metadata = { title: 'Notifications' }

/**
 * Notifications — Build Phase 12, Wave 5 (Task D). REWIRE, not a
 * redesign: Wave 4 flagged this exact page as already existing but still
 * rendering the legacy Build Phase 1 `DEMO_NOTIFICATIONS` fixture (a
 * different, non-DB-aligned `Notification` type — see
 * `packages/types/src/index.ts`'s own comment distinguishing it from this
 * phase's real `NotificationRecord`). This is a deliberate data-source fix
 * per "do not redesign the interface without explaining why": the list/row
 * layout below is unchanged from the legacy page, only its data now comes
 * from the real `notifications` table via `loadNotifications`, and each
 * row's link is resolved through `buildPermissionSafeDeepLink` — called
 * fresh, right here, on every request (never cached or stored) — exactly
 * as that module's own header note requires.
 */
export default async function NotificationsPage() {
  if (!supabaseConfigured) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Notifications"
          description="Recent workflow and client activity across your recruitment projects."
        />
        <EmptyState
          icon={Bell}
          title="Not connected to a live database"
          description="Notifications will appear here once this environment has a configured Supabase project."
        />
      </div>
    )
  }

  const user = await requireAuth('/notifications')
  const membership = await resolveActiveOrg(user.id)
  const supabase = await createServerSupabaseClient()

  const rows = await loadNotifications(user.id, supabase!)

  const withLinks: NotificationRowView[] = await Promise.all(
    rows.map(async (row) => {
      const resourceType =
        (row.resourceType as NotificationResourceType | null) ??
        EVENT_TYPE_RESOURCE_TYPE[row.eventType] ??
        null
      let path: string | null = null
      if (resourceType && row.resourceId) {
        const link = await buildPermissionSafeDeepLink({
          resourceType,
          resourceId: row.resourceId,
          viewerUserId: user.id,
          viewerRole: membership.role,
          organizationId: membership.organizationId,
          supabase: supabase!,
        })
        path = link.accessible ? link.path : null
      }
      return {
        id: row.id,
        eventType: row.eventType,
        title: row.title,
        body: row.body,
        readAt: row.readAt,
        createdAt: row.createdAt,
        path,
      }
    }),
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Notifications"
        description="Recent workflow and client activity across your recruitment projects."
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="No notifications"
          description="You're all caught up — nothing needs your attention right now."
        />
      ) : (
        <NotificationCenterList
          organizationId={membership.organizationId}
          notifications={withLinks}
        />
      )}
    </div>
  )
}
