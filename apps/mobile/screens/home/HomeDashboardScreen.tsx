import { useCallback } from 'react'
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { CompositeScreenProps } from '@react-navigation/native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs'
import { Card, ListItem, QueryStateView, ScreenContainer, StatusChip } from '@/components/ui'
import { useAuth } from '@/lib/auth/AuthProvider'
import { useQueryState } from '@/lib/data/useQueryState'
import { resolveActiveMembership } from '@/lib/data/org'
import { colors, spacing, typeScale } from '@/theme/tokens'
import type { HomeStackParamList, MainTabParamList } from '@/navigation/types'

type Props = CompositeScreenProps<
  NativeStackScreenProps<HomeStackParamList, 'HomeDashboard'>,
  BottomTabScreenProps<MainTabParamList>
>

interface DashboardSummary {
  openProjectsCount: number
  candidatesAwaitingReviewCount: number
  pendingApprovalsCount: number
  recentItems: RecentItem[]
}

interface RecentItem {
  key: string
  kind: 'quality_review' | 'scorecard_approval'
  title: string
  subtitle: string
  projectId: string | null
  scorecardId?: string
}

/**
 * Home dashboard — Build Phase 13 Wave 3 brief: summary cards + a short
 * navigable list of urgent items, pull-to-refresh. Mirrors apps/web's
 * dashboard (apps/web/app/(app)/dashboard/page.tsx) conceptually — active
 * roles, candidates needing attention, recent activity — but computed from
 * the live RLS-scoped tables directly (no demo fixtures on mobile) rather
 * than that page's `DEMO_*` layer.
 */
export function HomeDashboardScreen({ navigation }: Props) {
  const { user } = useAuth()

  const { status, data, error, refreshing, refresh } = useQueryState<DashboardSummary>(
    async (supabase) => {
      if (!user) throw new Error('Not signed in.')

      const membership = await resolveActiveMembership(supabase, user.id)
      if (!membership) throw new Error('No active organization membership found.')

      const [
        { data: projects, error: projectsError },
        { data: reviewEntries, error: reviewError },
        { data: pendingVersions, error: versionsError },
      ] = await Promise.all([
        supabase
          .from('recruitment_projects')
          .select('id, archived_at')
          .eq('organization_id', membership.organizationId)
          .is('archived_at', null),
        supabase
          .from('candidate_project_entries')
          .select('id, current_stage, candidates(full_name), recruitment_projects(id, role_title)')
          .eq('organization_id', membership.organizationId)
          .eq('current_stage', 'quality_review')
          .order('updated_at', { ascending: false })
          .limit(5),
        supabase
          .from('scorecard_versions')
          .select(
            'id, created_at, scorecards(job_id, jobs(id, title, recruitment_project_id, recruitment_projects(role_title)))',
          )
          .eq('organization_id', membership.organizationId)
          .eq('status', 'pending_approval')
          .order('created_at', { ascending: false })
          .limit(5),
      ])

      const firstError = projectsError ?? reviewError ?? versionsError
      if (firstError) throw new Error(firstError.message)

      const reviewItems: RecentItem[] = (reviewEntries ?? []).map((entry) => {
        const candidate = entry.candidates as unknown as { full_name: string } | null
        const project = entry.recruitment_projects as unknown as {
          id: string
          role_title: string
        } | null
        return {
          key: `review-${entry.id}`,
          kind: 'quality_review',
          title: candidate?.full_name ?? 'Unnamed candidate',
          subtitle: project
            ? `Awaiting quality review · ${project.role_title}`
            : 'Awaiting quality review',
          projectId: project?.id ?? null,
        }
      })

      const approvalItems: RecentItem[] = (pendingVersions ?? []).map((version) => {
        const scorecard = version.scorecards as unknown as {
          job_id: string
          jobs: {
            id: string
            title: string
            recruitment_project_id: string
            recruitment_projects: { role_title: string } | null
          } | null
        } | null
        const job = scorecard?.jobs ?? null
        return {
          key: `approval-${version.id}`,
          kind: 'scorecard_approval',
          title: job?.title ?? 'Scorecard',
          subtitle: job?.recruitment_projects
            ? `Pending scorecard approval · ${job.recruitment_projects.role_title}`
            : 'Pending scorecard approval',
          projectId: job?.recruitment_project_id ?? null,
        }
      })

      const summary: DashboardSummary = {
        openProjectsCount: projects?.length ?? 0,
        candidatesAwaitingReviewCount: reviewItems.length,
        pendingApprovalsCount: approvalItems.length,
        recentItems: [...approvalItems, ...reviewItems],
      }

      return summary
    },
    [user?.id],
    { isEmpty: () => false },
  )

  const goToProject = useCallback(
    (projectId: string | null) => {
      if (!projectId) return
      navigation
        .getParent()
        ?.navigate('ProjectsTab', { screen: 'ProjectDetails', params: { projectId } })
    },
    [navigation],
  )

  return (
    <ScreenContainer scroll>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.secondary}
          />
        }
      >
        {status === 'loading' && <QueryStateView kind="loading" title="Loading dashboard…" />}
        {status === 'not_configured' && (
          <QueryStateView
            kind="not_configured"
            title="Not connected"
            description="This app isn't connected to a workspace yet."
          />
        )}
        {status === 'offline' && (
          <QueryStateView
            kind="offline"
            title="You're offline"
            description="Try again when you have a connection."
            onRetry={refresh}
          />
        )}
        {status === 'error' && (
          <QueryStateView
            kind="error"
            title="Couldn't load your dashboard"
            description={error ?? undefined}
            onRetry={refresh}
          />
        )}
        {(status === 'success' || status === 'empty') && data && (
          <>
            <View style={styles.metricsRow}>
              <MetricCard label="Open projects" value={data.openProjectsCount} tone="primary" />
              <MetricCard
                label="Awaiting review"
                value={data.candidatesAwaitingReviewCount}
                tone="warning"
              />
              <MetricCard
                label="Pending approvals"
                value={data.pendingApprovalsCount}
                tone="warning"
              />
            </View>

            <Text style={styles.sectionHeading}>Needs your attention</Text>
            {data.recentItems.length === 0 ? (
              <Card>
                <Text style={styles.emptyText}>Nothing needs attention right now.</Text>
              </Card>
            ) : (
              <Card style={styles.listCard}>
                {data.recentItems.map((item, index) => (
                  <View key={item.key}>
                    <ListItem
                      title={item.title}
                      subtitle={item.subtitle}
                      trailing={
                        <StatusChip
                          status="pending"
                          label={item.kind === 'quality_review' ? 'Review' : 'Approval'}
                        />
                      }
                      onPress={item.projectId ? () => goToProject(item.projectId) : undefined}
                    />
                    {index < data.recentItems.length - 1 && <View style={styles.divider} />}
                  </View>
                ))}
              </Card>
            )}
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  )
}

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'primary' | 'warning'
}) {
  return (
    <Card style={styles.metricCard}>
      <Text
        style={[
          styles.metricValue,
          { color: tone === 'primary' ? colors.primary : colors.warningText },
        ]}
      >
        {value}
      </Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </Card>
  )
}

const styles = StyleSheet.create({
  content: {
    paddingTop: spacing.lg16,
    paddingBottom: spacing.xl24,
    gap: spacing.lg16,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: spacing.md12,
  },
  metricCard: {
    flex: 1,
    gap: spacing.xs4,
  },
  metricValue: {
    ...typeScale.metricDisplay,
  },
  metricLabel: {
    ...typeScale.bodySm,
    color: colors.textMuted,
  },
  sectionHeading: {
    ...typeScale.headlineSm,
    color: colors.tertiary,
  },
  listCard: {
    padding: 0,
    paddingHorizontal: spacing.lg16,
  },
  divider: {
    height: 1,
    backgroundColor: colors.outlineCell,
  },
  emptyText: {
    ...typeScale.bodySm,
    color: colors.textMuted,
  },
})
