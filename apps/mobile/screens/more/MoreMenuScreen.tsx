import { useEffect, useState } from 'react'
import { Alert, StyleSheet, Text, View } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { AvatarInitials, Button, Card, ListItem, ScreenContainer } from '@/components/ui'
import { useAuth } from '@/lib/auth/AuthProvider'
import { useQueryState } from '@/lib/data/useQueryState'
import {
  cacheMemberships,
  readCachedMemberships,
  type CachedMembership,
} from '@/lib/cache/referenceCache'
import { colors, spacing, typeScale } from '@/theme/tokens'
import type { MoreStackParamList } from '@/navigation/types'

type Props = NativeStackScreenProps<MoreStackParamList, 'MoreMenu'>

const ROLE_LABELS: Record<string, string> = {
  platform_admin: 'Platform admin',
  agency_admin: 'Agency admin',
  recruiter: 'Recruiter',
  client_decision_maker: 'Client decision maker',
  read_only_reviewer: 'Read-only reviewer',
}

/**
 * More / Settings menu (Build Phase 13, Wave 5). Shows the signed-in
 * user's identity, active organization + role, a link into notification
 * preferences, and Sign out.
 *
 * ORG/ROLE WARM START: the live read below (organization name + role,
 * joined from `organization_memberships`/`organizations`) is a direct
 * RLS-scoped Supabase read like every other screen, but this is also the
 * one screen this wave layers the reference-data cache on top of
 * (lib/cache/referenceCache.ts) — on mount it paints instantly from
 * whatever was cached on a previous successful load (clearly labeled
 * "may be out of date"), then swaps to the live result the moment it
 * resolves (or stays on the cached copy, unlabeled stale, if the live
 * read is still in flight — the label only shows before the live result
 * lands). Name/role are low-stakes to show briefly stale; nothing else on
 * this screen is cached.
 */
export function MoreMenuScreen({ navigation }: Props) {
  const { user, signOut } = useAuth()
  const [cached, setCached] = useState<CachedMembership | null>(null)
  const [cacheChecked, setCacheChecked] = useState(false)

  useEffect(() => {
    let cancelled = false
    readCachedMemberships().then((result) => {
      if (!cancelled) {
        setCached(result?.memberships[0] ?? null)
        setCacheChecked(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const query = useQueryState<CachedMembership | null>(
    async (supabase) => {
      if (!user) return null
      const { data, error } = await supabase
        .from('organization_memberships')
        .select('organization_id, role, status, is_default, organizations(name)')
        .eq('user_id', user.id)
        .eq('status', 'active')
      if (error) throw new Error(error.message)
      if (!data || data.length === 0) return null
      const active = (data.find((row) => row.is_default) ?? data[0]) as unknown as {
        organization_id: string
        role: string
        organizations: { name: string | null } | { name: string | null }[] | null
      }
      const orgRow = Array.isArray(active.organizations)
        ? active.organizations[0]
        : active.organizations
      const membership: CachedMembership = {
        organizationId: active.organization_id,
        organizationName: orgRow?.name ?? null,
        role: active.role,
      }
      void cacheMemberships([membership])
      return membership
    },
    [user?.id],
    { isEmpty: () => false },
  )

  const live = query.status === 'success' ? query.data : null
  const display = live ?? cached
  const showingStaleLabel = !live && Boolean(cached) && cacheChecked

  function handleSignOut() {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ])
  }

  return (
    <ScreenContainer scroll>
      <View style={styles.content}>
        <Card style={styles.profileCard}>
          <AvatarInitials name={user?.email ?? 'User'} size={48} />
          <View style={styles.profileText}>
            <Text style={styles.email} numberOfLines={1}>
              {user?.email ?? 'Not signed in'}
            </Text>
            {display ? (
              <Text style={styles.orgLine} numberOfLines={1}>
                {(display.organizationName ?? 'Your organization') +
                  ' · ' +
                  (ROLE_LABELS[display.role] ?? display.role)}
              </Text>
            ) : query.status === 'loading' ? (
              <Text style={styles.orgLine}>Loading organization…</Text>
            ) : (
              <Text style={styles.orgLine}>No active organization</Text>
            )}
            {showingStaleLabel && <Text style={styles.staleLabel}>May be out of date</Text>}
          </View>
        </Card>

        <Card style={styles.menuCard}>
          <ListItem
            title="Notification preferences"
            subtitle="Choose what you're notified about, and how"
            onPress={() => navigation.navigate('NotificationPreferences')}
          />
        </Card>

        <Button variant="destructive" onPress={handleSignOut}>
          Sign out
        </Button>
      </View>
    </ScreenContainer>
  )
}

const styles = StyleSheet.create({
  content: { paddingVertical: spacing.lg16, gap: spacing.lg16 },
  profileCard: { flexDirection: 'row', gap: spacing.md12, alignItems: 'center' },
  profileText: { flex: 1, gap: 2 },
  email: { ...typeScale.bodyMd, fontFamily: 'Geist_600SemiBold', color: colors.tertiary },
  orgLine: { ...typeScale.bodySm, color: colors.textMuted },
  staleLabel: { ...typeScale.labelMd, color: colors.warningText },
  menuCard: { padding: 0, paddingHorizontal: spacing.lg16 },
})
