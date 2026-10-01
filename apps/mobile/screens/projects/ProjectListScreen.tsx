import { useMemo, useState } from 'react'
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { Card, QueryStateView, ScreenContainer, StatusChip } from '@/components/ui'
import { useAuth } from '@/lib/auth/AuthProvider'
import { useQueryState } from '@/lib/data/useQueryState'
import { resolveActiveMembership } from '@/lib/data/org'
import { colors, radius, spacing, typeScale } from '@/theme/tokens'
import type { ProjectsStackParamList } from '@/navigation/types'

type Props = NativeStackScreenProps<ProjectsStackParamList, 'ProjectList'>

type ProjectStatus = string

interface ProjectRow {
  id: string
  roleTitle: string
  clientName: string
  vertical: string
  status: ProjectStatus
  isPoc: boolean
  archivedAt: string | null
  jobCount: number
  candidateCount: number
}

const STATUS_TONE: Record<string, 'passed' | 'pending' | 'failed' | 'warning'> = {
  sourcing: 'pending',
  shortlisting: 'pending',
  submitted: 'pending',
  active: 'passed',
  closed: 'passed',
  archived: 'failed',
}

const STATUS_FILTERS = ['all', 'sourcing', 'shortlisting', 'submitted', 'active', 'closed'] as const

/**
 * Project list — Build Phase 13 Wave 3 brief: name/client/status badge/
 * counts, tap → Project details, pull-to-refresh, empty/loading/permission-
 * denied states. Mirrors apps/web's /projects page (recruitment_projects,
 * scoped by the same RLS every role already gets on web) rather than
 * inventing a different query shape for mobile.
 */
export function ProjectListScreen({ navigation }: Props) {
  const { user } = useAuth()
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>('all')

  const { status, data, error, refreshing, refresh } = useQueryState<ProjectRow[]>(
    async (supabase) => {
      if (!user) throw new Error('Not signed in.')

      const membership = await resolveActiveMembership(supabase, user.id)
      if (!membership) throw new Error('No active organization membership found.')

      const { data: projects, error: projectsError } = await supabase
        .from('recruitment_projects')
        .select('id, role_title, vertical, status, is_poc, archived_at, created_at, clients(name)')
        .eq('organization_id', membership.organizationId)
        .order('created_at', { ascending: false })

      if (projectsError) throw new Error(projectsError.message)
      const rows = projects ?? []
      const projectIds = rows.map((row) => row.id)

      const [{ data: jobs, error: jobsError }, { data: entries, error: entriesError }] =
        await Promise.all([
          projectIds.length > 0
            ? supabase
                .from('jobs')
                .select('id, recruitment_project_id')
                .in('recruitment_project_id', projectIds)
            : Promise.resolve({
                data: [] as { id: string; recruitment_project_id: string }[],
                error: null,
              }),
          projectIds.length > 0
            ? supabase
                .from('candidate_project_entries')
                .select('id, recruitment_project_id')
                .in('recruitment_project_id', projectIds)
            : Promise.resolve({
                data: [] as { id: string; recruitment_project_id: string }[],
                error: null,
              }),
        ])

      if (jobsError) throw new Error(jobsError.message)
      if (entriesError) throw new Error(entriesError.message)

      const jobCountByProject = new Map<string, number>()
      for (const job of jobs ?? []) {
        jobCountByProject.set(
          job.recruitment_project_id,
          (jobCountByProject.get(job.recruitment_project_id) ?? 0) + 1,
        )
      }
      const candidateCountByProject = new Map<string, number>()
      for (const entry of entries ?? []) {
        candidateCountByProject.set(
          entry.recruitment_project_id,
          (candidateCountByProject.get(entry.recruitment_project_id) ?? 0) + 1,
        )
      }

      return rows.map((row) => ({
        id: row.id,
        roleTitle: row.role_title,
        clientName: (row.clients as unknown as { name: string } | null)?.name ?? 'Unknown client',
        vertical: row.vertical ?? '',
        status: row.status,
        isPoc: row.is_poc,
        archivedAt: row.archived_at,
        jobCount: jobCountByProject.get(row.id) ?? 0,
        candidateCount: candidateCountByProject.get(row.id) ?? 0,
      }))
    },
    [user?.id],
  )

  const filtered = useMemo(() => {
    if (!data) return []
    if (statusFilter === 'all') return data
    return data.filter((project) => project.status === statusFilter)
  }, [data, statusFilter])

  return (
    <ScreenContainer>
      <FlatList
        data={status === 'success' ? filtered : []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.secondary}
          />
        }
        ListHeaderComponent={
          status === 'success' || status === 'empty' ? (
            <View style={styles.filterRow}>
              {STATUS_FILTERS.map((option) => {
                const label = option === 'all' ? 'All' : option[0]!.toUpperCase() + option.slice(1)
                return (
                  <Pressable
                    key={option}
                    onPress={() => setStatusFilter(option)}
                    accessibilityRole="button"
                    accessibilityLabel={`Filter: ${label}`}
                    accessibilityState={{ selected: statusFilter === option }}
                    style={[styles.filterChip, statusFilter === option && styles.filterChipActive]}
                  >
                    <Text
                      style={[
                        styles.filterLabel,
                        statusFilter === option && styles.filterLabelActive,
                      ]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                )
              })}
            </View>
          ) : null
        }
        ListEmptyComponent={
          status === 'loading' ? (
            <QueryStateView kind="loading" title="Loading projects…" />
          ) : status === 'not_configured' ? (
            <QueryStateView
              kind="not_configured"
              title="Not connected"
              description="This app isn't connected to a workspace yet."
            />
          ) : status === 'offline' ? (
            <QueryStateView
              kind="offline"
              title="You're offline"
              description="Try again when you have a connection."
              onRetry={refresh}
            />
          ) : status === 'error' ? (
            <QueryStateView
              kind="error"
              title="Couldn't load projects"
              description={error ?? undefined}
              onRetry={refresh}
            />
          ) : status === 'empty' || filtered.length === 0 ? (
            <QueryStateView
              kind="empty"
              title={data && data.length > 0 ? 'No projects match this filter' : 'No projects yet'}
              description={
                data && data.length > 0
                  ? 'Try a different status filter.'
                  : 'Projects your organization is working will appear here.'
              }
            />
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => navigation.navigate('ProjectDetails', { projectId: item.id })}
            accessibilityRole="button"
            accessibilityLabel={`${item.roleTitle}, ${item.clientName}, ${item.isPoc ? 'POC' : item.status}, ${item.jobCount} job${item.jobCount === 1 ? '' : 's'}, ${item.candidateCount} candidate${item.candidateCount === 1 ? '' : 's'}`}
          >
            <Card style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardTitleColumn}>
                  <Text style={styles.roleTitle} numberOfLines={1}>
                    {item.roleTitle}
                  </Text>
                  <Text style={styles.clientLine} numberOfLines={1}>
                    {item.clientName}
                    {item.vertical ? ` · ${item.vertical}` : ''}
                  </Text>
                </View>
                <StatusChip
                  status={STATUS_TONE[item.status] ?? 'pending'}
                  label={item.isPoc ? 'POC' : item.status}
                />
              </View>
              <View style={styles.countsRow}>
                <Text style={styles.countText}>
                  {item.jobCount} job{item.jobCount === 1 ? '' : 's'}
                </Text>
                <Text style={styles.countDot}>·</Text>
                <Text style={styles.countText}>
                  {item.candidateCount} candidate{item.candidateCount === 1 ? '' : 's'}
                </Text>
              </View>
            </Card>
          </Pressable>
        )}
      />
    </ScreenContainer>
  )
}

const styles = StyleSheet.create({
  listContent: {
    paddingTop: spacing.lg16,
    paddingBottom: spacing.xl24,
    gap: spacing.md12,
    flexGrow: 1,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm8,
    marginBottom: spacing.md12,
  },
  filterChip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.outlinePerimeter,
    paddingHorizontal: spacing.md12,
    paddingVertical: spacing.xs4,
  },
  filterChipActive: {
    backgroundColor: colors.tertiary,
    borderColor: colors.tertiary,
  },
  filterLabel: {
    ...typeScale.labelMd,
    color: colors.tertiary,
    textTransform: 'none',
  },
  filterLabelActive: {
    color: colors.white,
  },
  card: {
    gap: spacing.sm8,
    marginBottom: spacing.md12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm8,
  },
  cardTitleColumn: {
    flex: 1,
    gap: 2,
  },
  roleTitle: {
    ...typeScale.headlineSm,
    color: colors.tertiary,
  },
  clientLine: {
    ...typeScale.bodySm,
    color: colors.textMuted,
  },
  countsRow: {
    flexDirection: 'row',
    gap: spacing.xs4,
  },
  countText: {
    ...typeScale.bodySm,
    color: colors.textMuted,
  },
  countDot: {
    ...typeScale.bodySm,
    color: colors.textMuted,
  },
})
