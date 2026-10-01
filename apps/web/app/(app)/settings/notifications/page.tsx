import { EmptyState, PageHeader } from '@rqi/ui'
import { Bell } from 'lucide-react'
import { supabaseConfigured } from '@/lib/env'
import { requireAuth, resolveActiveOrg } from '@/lib/auth/session'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { loadNotificationPreferencesForUser } from '@/lib/notifications/load'
import { NotificationPreferencesForm } from '@/components/domain/notifications/notification-preferences-form'

export const metadata = { title: 'Notification preferences' }

/** Build Phase 12, Wave 5 (Task D) — per-event in-app/email toggle settings, nested under Settings following the `/settings/team` precedent. */
export default async function NotificationPreferencesPage() {
  if (!supabaseConfigured) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Notification preferences"
          description="Choose which events notify you, and how."
        />
        <EmptyState
          icon={Bell}
          title="Not connected to a live database"
          description="Notification preferences require a configured Supabase project."
        />
      </div>
    )
  }

  const user = await requireAuth('/settings/notifications')
  const membership = await resolveActiveOrg(user.id)
  const supabase = await createServerSupabaseClient()
  const preferences = await loadNotificationPreferencesForUser(
    membership.organizationId,
    user.id,
    supabase!,
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Notification preferences"
        description="Choose which events notify you, and whether each also sends an email."
      />
      <NotificationPreferencesForm
        organizationId={membership.organizationId}
        preferences={preferences}
      />
    </div>
  )
}
