import { useCallback, useState } from 'react'
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import type { CompositeScreenProps } from '@react-navigation/native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs'
import { QueryStateView, ScreenContainer } from '@/components/ui'
import { useAuth } from '@/lib/auth/AuthProvider'
import { useActiveOrganization } from '@/lib/data/useActiveOrganization'
import { useQueryState } from '@/lib/data/useQueryState'
import { getSupabaseClient } from '@/lib/supabase/client'
import { ApiNetworkError, markAllNotificationsRead, markNotificationRead } from '@/lib/api/client'
import { notificationEventLabel } from '@/lib/notifications/eventLabels'
import { resolveNotificationDeepLink } from '@/lib/notifications/resolveDeepLink'
import { colors, spacing, typeScale } from '@/theme/tokens'
import type { HomeStackParamList, MainTabParamList } from '@/navigation/types'

type Props = CompositeScreenProps<
  NativeStackScreenProps<HomeStackParamList, 'Notifications'>,
  BottomTabScreenProps<MainTabParamList>
>

interface NotificationRow {
  id: string
  eventType: string
  title: string
  body: string | null
  resourceType: string | null
  resourceId: string | null
  readAt: string | null
  createdAt: string
}

/**
 * Notifications screen (Build Phase 13, Wave 5) — a direct RLS-scoped read
 * of the `notifications` table (same pattern every other screen in this
 * app uses; no new read route was built for this, per the task brief).
 * Tap-to-navigate resolves `resource_type`/`resource_id` to one of the 12
 * real screens already built (lib/notifications/resolveDeepLink.ts) and
 * falls back to a plain, unlinked row for anything unmapped — see that
 * module's header comment for why this never reimplements the web app's
 * heavier permission-safe-deep-link re-validation.
 */
export function NotificationsScreen({ navigation }: Props) {
  const { user } = useAuth()
  const { organization } = useActiveOrganization()
  const organizationId = organization?.organizationId ?? null

  const query = useQueryState<NotificationRow[]>(
    async (supabase) => {
      if (!user) throw new Error('Not signed in.')
      if (!organizationId) throw new Error('Resolving your organization…')
      const { data, error } = await supabase
        .from('notifications')
        .select('id, event_type, title, body, resource_type, resource_id, read_at, created_at')
        .eq('recipient_user_id', user.id)
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw new Error(error.message)
      return (data ?? []).map((row) => ({
        id: row.id as string,
        eventType: row.event_type as string,
        title: row.title as string,
        body: row.body as string | null,
        resourceType: row.resource_type as string | null,
        resourceId: row.resource_id as string | null,
        readAt: row.read_at as string | null,
        createdAt: row.created_at as string,
      }))
    },
    [user?.id, organizationId],
  )

  // Optimistic local overlay: a notification id lands here the instant the
  // user taps it, before the `/notifications/[id]/read` call resolves, so
  // the row's unread styling clears immediately. `query.refresh()` (called
  // after the call settles either way) replaces this with the server's own
  // state once it lands, so this never drifts permanently from the truth.
  const [locallyRead, setLocallyRead] = useState<Set<string>>(new Set())
  const [banner, setBanner] = useState<string | null>(null)
  const [markingAll, setMarkingAll] = useState(false)
  const [navigatingId, setNavigatingId] = useState<string | null>(null)

  const rows = query.data ?? []
  const unreadCount = rows.filter((row) => !row.readAt && !locallyRead.has(row.id)).length

  const markOneRead = useCallback(
    async (row: NotificationRow) => {
      if (!organizationId || row.readAt || locallyRead.has(row.id)) return
      setLocallyRead((prev) => new Set(prev).add(row.id))
      try {
        await markNotificationRead(row.id, organizationId)
      } catch (err) {
        // Revert the optimistic mark and surface a clear reason — but
        // never block navigation on this; reading a notification and
        // marking it read are two different concerns, and a failed
        // "mark read" is low-stakes enough to just show a banner rather
        // than stopping the tap outright.
        setLocallyRead((prev) => {
          const next = new Set(prev)
          next.delete(row.id)
          return next
        })
        if (err instanceof ApiNetworkError) {
          setBanner("You're offline — the read status couldn't be saved. Try again when connected.")
        } else {
          setBanner('Could not mark this notification as read.')
        }
      }
    },
    [organizationId, locallyRead],
  )

  const handlePress = useCallback(
    async (row: NotificationRow) => {
      setBanner(null)
      void markOneRead(row)

      const supabase = getSupabaseClient()
      if (!supabase || !row.resourceType || !row.resourceId) return

      setNavigatingId(row.id)
      const target = await resolveNotificationDeepLink(supabase, row.resourceType, row.resourceId)
      setNavigatingId(null)

      if (!target) {
        setBanner('This item is no longer available or has no linked screen yet.')
        return
      }
      navigation
        .getParent()
        ?.navigate(target.tab, { screen: target.screen, params: target.params } as never)
    },
    [markOneRead, navigation],
  )

  async function handleMarkAllRead() {
    if (!organizationId || unreadCount === 0) return
    setBanner(null)
    setMarkingAll(true)
    setLocallyRead(new Set(rows.map((row) => row.id)))
    try {
      await markAllNotificationsRead(organizationId)
      query.refresh()
    } catch (err) {
      setLocallyRead(new Set())
      if (err instanceof ApiNetworkError) {
        setBanner("You're offline — try again when connected.")
      } else {
        setBanner('Could not mark all notifications as read.')
      }
    } finally {
      setMarkingAll(false)
    }
  }

  if (query.status !== 'success' && query.status !== 'empty') {
    return (
      <ScreenContainer>
        <QueryStateView
          kind={query.status as 'loading' | 'error' | 'not_configured' | 'offline'}
          title={
            query.status === 'offline'
              ? "You're offline"
              : query.status === 'not_configured'
                ? 'Not connected'
                : 'Could not load notifications'
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
      <View style={styles.headerRow}>
        <Text style={styles.count}>
          {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
        </Text>
        {unreadCount > 0 && (
          <Pressable onPress={handleMarkAllRead} disabled={markingAll} accessibilityRole="button">
            <Text style={styles.markAll}>{markingAll ? 'Marking…' : 'Mark all read'}</Text>
          </Pressable>
        )}
      </View>

      {banner && <Text style={styles.banner}>{banner}</Text>}

      <FlatList
        data={rows}
        keyExtractor={(row) => row.id}
        refreshControl={
          <RefreshControl
            refreshing={query.refreshing}
            onRefresh={query.refresh}
            tintColor={colors.secondary}
          />
        }
        ItemSeparatorComponent={() => <View style={styles.divider} />}
        ListEmptyComponent={<Text style={styles.emptyText}>You have no notifications yet.</Text>}
        renderItem={({ item }) => {
          const isUnread = !item.readAt && !locallyRead.has(item.id)
          const hasLink = Boolean(item.resourceType && item.resourceId)
          return (
            <Pressable
              accessibilityRole="button"
              onPress={() => handlePress(item)}
              disabled={navigatingId === item.id}
              style={styles.row}
            >
              <View style={[styles.unreadDot, { opacity: isUnread ? 1 : 0 }]} />
              <View style={styles.rowText}>
                <Text style={[styles.eventLabel, isUnread && styles.eventLabelUnread]}>
                  {notificationEventLabel(item.eventType)}
                </Text>
                <Text style={styles.title} numberOfLines={2}>
                  {item.title}
                </Text>
                {item.body ? (
                  <Text style={styles.body} numberOfLines={2}>
                    {item.body}
                  </Text>
                ) : null}
                {!hasLink && <Text style={styles.noLink}>No linked screen for this item</Text>}
              </View>
            </Pressable>
          )
        }}
      />
    </ScreenContainer>
  )
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md12,
  },
  count: { ...typeScale.bodySm, color: colors.textMuted },
  markAll: { ...typeScale.labelMd, color: colors.secondary },
  banner: {
    ...typeScale.bodySm,
    color: colors.errorText,
    backgroundColor: colors.errorBg,
    borderRadius: 6,
    paddingHorizontal: spacing.md12,
    paddingVertical: spacing.sm8,
    marginBottom: spacing.sm8,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm8,
    paddingVertical: spacing.md12,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.secondary,
    marginTop: 6,
  },
  rowText: { flex: 1, gap: 2 },
  eventLabel: { ...typeScale.labelMd, color: colors.textMuted },
  eventLabelUnread: { color: colors.secondary },
  title: { ...typeScale.bodyMd, fontFamily: 'Geist_600SemiBold', color: colors.tertiary },
  body: { ...typeScale.bodySm, color: colors.textMuted },
  noLink: { ...typeScale.labelMd, color: colors.textMuted, marginTop: 2 },
  divider: { height: 1, backgroundColor: colors.outlineCell },
  emptyText: {
    ...typeScale.bodySm,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.xl24,
  },
})
