import { useState } from 'react'
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import type { NotificationEventType } from '@rqi/types'
import { Card, QueryStateView, ScreenContainer } from '@/components/ui'
import { useAuth } from '@/lib/auth/AuthProvider'
import { useActiveOrganization } from '@/lib/data/useActiveOrganization'
import { useQueryState } from '@/lib/data/useQueryState'
import { ApiNetworkError, updateNotificationPreference } from '@/lib/api/client'
import {
  NOTIFICATION_EVENT_LABELS,
  NOTIFICATION_EVENT_TYPES,
} from '@/lib/notifications/eventLabels'
import { colors, spacing, typeScale } from '@/theme/tokens'

interface PreferenceRow {
  eventType: NotificationEventType
  inAppEnabled: boolean
  emailEnabled: boolean
}

/** A row not yet in `notification_preferences` reads as this default (own
 * `NotificationPreferenceSchema` header note: "a missing row is read by
 * application code as {inAppEnabled: true, emailEnabled: false}"). */
function defaultPreference(eventType: NotificationEventType): PreferenceRow {
  return { eventType, inAppEnabled: true, emailEnabled: false }
}

/**
 * Notification preferences (Build Phase 13, Wave 5) — the 8
 * `NotificationEventType` values, each with in-app/email toggles wired to
 * `PUT /api/mobile/notifications/preferences`. Reads existing rows
 * directly via RLS (own-user only), fills in the documented default for
 * any event type with no row yet, and updates optimistically per-toggle.
 */
export function NotificationPreferencesScreen() {
  const { user } = useAuth()
  const { organization } = useActiveOrganization()
  const organizationId = organization?.organizationId ?? null

  const query = useQueryState<Record<NotificationEventType, PreferenceRow>>(
    async (supabase) => {
      if (!user) throw new Error('Not signed in.')
      if (!organizationId) throw new Error('Resolving your organization…')
      const { data, error } = await supabase
        .from('notification_preferences')
        .select('event_type, in_app_enabled, email_enabled')
        .eq('user_id', user.id)
        .eq('organization_id', organizationId)
      if (error) throw new Error(error.message)

      const byType = new Map(
        (data ?? []).map((row) => [
          row.event_type as NotificationEventType,
          {
            eventType: row.event_type as NotificationEventType,
            inAppEnabled: row.in_app_enabled as boolean,
            emailEnabled: row.email_enabled as boolean,
          },
        ]),
      )
      const result = {} as Record<NotificationEventType, PreferenceRow>
      for (const eventType of NOTIFICATION_EVENT_TYPES) {
        result[eventType] = byType.get(eventType) ?? defaultPreference(eventType)
      }
      return result
    },
    [user?.id, organizationId],
    { isEmpty: () => false },
  )

  // Only ever set by `toggle()` below (a real optimistic edit), never
  // synced from `query.data` via an effect — `preferences` below simply
  // prefers this local override when one exists, and falls back to the
  // freshly-loaded query result otherwise. This avoids a same-tick
  // "mirror query state into local state" effect entirely.
  const [local, setLocal] = useState<Record<NotificationEventType, PreferenceRow> | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [banner, setBanner] = useState<string | null>(null)

  const preferences = local ?? query.data

  async function toggle(
    eventType: NotificationEventType,
    field: 'inAppEnabled' | 'emailEnabled',
    value: boolean,
  ) {
    if (!organizationId || !preferences) return
    setBanner(null)
    const previous = preferences[eventType]
    const next: PreferenceRow = { ...previous, [field]: value }
    setLocal({ ...preferences, [eventType]: next })
    setSavingKey(`${eventType}:${field}`)
    try {
      await updateNotificationPreference({
        organizationId,
        eventType,
        inAppEnabled: next.inAppEnabled,
        emailEnabled: next.emailEnabled,
      })
    } catch (err) {
      setLocal({ ...preferences, [eventType]: previous })
      setBanner(
        err instanceof ApiNetworkError
          ? "You're offline — try again when connected."
          : 'Could not save this preference.',
      )
    } finally {
      setSavingKey(null)
    }
  }

  if (query.status !== 'success' || !preferences) {
    return (
      <ScreenContainer>
        <QueryStateView
          kind={query.status as 'loading' | 'error' | 'not_configured' | 'offline'}
          title={
            query.status === 'offline'
              ? "You're offline"
              : query.status === 'not_configured'
                ? 'Not connected'
                : 'Could not load your preferences'
          }
          description={
            query.status === 'offline'
              ? 'Try again when you have a connection.'
              : query.status === 'not_configured'
                ? 'This environment has no live Supabase project configured.'
                : (query.error ?? undefined)
          }
          onRetry={query.refresh}
        />
      </ScreenContainer>
    )
  }

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {banner && <Text style={styles.banner}>{banner}</Text>}
        <View style={styles.headerLabels}>
          <Text style={styles.headerSpacer} />
          <Text style={styles.headerLabel}>In-app</Text>
          <Text style={styles.headerLabel}>Email</Text>
        </View>
        {NOTIFICATION_EVENT_TYPES.map((eventType) => {
          const row = preferences[eventType]
          return (
            <Card key={eventType} style={styles.row}>
              <Text style={styles.rowTitle}>{NOTIFICATION_EVENT_LABELS[eventType]}</Text>
              <View style={styles.switches}>
                <Switch
                  value={row.inAppEnabled}
                  onValueChange={(value) => toggle(eventType, 'inAppEnabled', value)}
                  disabled={savingKey !== null}
                  trackColor={{ true: colors.secondary, false: colors.outlinePerimeter }}
                  accessibilityLabel={`In-app notifications for ${NOTIFICATION_EVENT_LABELS[eventType]}`}
                />
                <Switch
                  value={row.emailEnabled}
                  onValueChange={(value) => toggle(eventType, 'emailEnabled', value)}
                  disabled={savingKey !== null}
                  trackColor={{ true: colors.secondary, false: colors.outlinePerimeter }}
                  accessibilityLabel={`Email notifications for ${NOTIFICATION_EVENT_LABELS[eventType]}`}
                />
              </View>
            </Card>
          )
        })}
      </ScrollView>
    </ScreenContainer>
  )
}

const styles = StyleSheet.create({
  content: { paddingVertical: spacing.lg16, gap: spacing.sm8, paddingBottom: spacing.xl24 },
  banner: {
    ...typeScale.bodySm,
    color: colors.errorText,
    backgroundColor: colors.errorBg,
    borderRadius: 6,
    paddingHorizontal: spacing.md12,
    paddingVertical: spacing.sm8,
  },
  headerLabels: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg16 },
  headerSpacer: { flex: 1 },
  headerLabel: { ...typeScale.labelMd, color: colors.textMuted, width: 56, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm8 },
  rowTitle: { ...typeScale.bodyMd, color: colors.tertiary, flex: 1 },
  switches: { flexDirection: 'row', gap: spacing.md12 },
})
