import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { Card, QueryStateView, ScreenContainer, StatusChip } from '@/components/ui'
import { useAuth } from '@/lib/auth/AuthProvider'
import { useQueryState } from '@/lib/data/useQueryState'
import { resolveActiveMembership } from '@/lib/data/org'
import { colors, spacing, typeScale } from '@/theme/tokens'
import type { ProjectsStackParamList } from '@/navigation/types'
import { STAGE_BADGE, STAGE_LABELS } from '@/lib/pipeline/stages'

type Props = NativeStackScreenProps<ProjectsStackParamList, 'ProjectDetails'>

interface JobRow {
  id: string
  title: string
  status: string
  location: string
}

interface CandidateEntryRow {
  id: string
  candidateId: string
  fullName: string
  stage: string
}

interface ProjectDetail {
  id: string
  roleTitle: string
  clientName: string
  vertical: string
  status: string
  isPoc: boolean
  jobs: JobRow[]
  candidates: CandidateEntryRow[]
}

/**
 * Project details — Build Phase 13 Wave 3 brief: metadata, client info,
 * jobs (→ Job scorecard), candidates in pipeline for this project (→
 * Candidate pipeline filtered to this project). Mirrors apps/web's
 * /projects/[projectId] page's data shape (same recruitment_projects +
 * jobs query), with the web page's inline "candidate match card" section
 * replaced by a short list that hands off to the dedicated pipeline screen,
 * since a mobile card-per-candidate list is already that screen's job.
 */
export function ProjectDetailsScreen({ route, navigation }: Props) {
  const { projectId } = route.params
  const { user } = useAuth()

  const { status, data, error, refreshing, refresh } = useQueryState<ProjectDetail | null>(
    async (supabase) => {
      if (!user) throw new Error('Not signed in.')

      const membership = await resolveActiveMembership(supabase, user.id)
      if (!membership) throw new Error('No active organization membership found.')

      const { data: projectRow, error: projectError } = await supabase
        .from('recruitment_projects')
        .select('id, role_title, vertical, status, is_poc, clients(name)')
        .eq('id', projectId)
        .eq('organization_id', membership.organizationId)
        .maybeSingle()

      if (projectError) throw new Error(projectError.message)
      if (!projectRow) return null

      const [{ data: jobRows, error: jobsError }, { data: entryRows, error: entriesError }] =
        await Promise.all([
          supabase
            .from('jobs')
            .select('id, title, status, location')
            .eq('recruitment_project_id', projectId)
            .order('created_at', { ascending: false }),
          supabase
            .from('candidate_project_entries')
            .select('id, candidate_id, current_stage, candidates(full_name)')
            .eq('recruitment_project_id', projectId)
            .order('updated_at', { ascending: false })
            .limit(8),
        ])

      if (jobsError) throw new Error(jobsError.message)
      if (entriesError) throw new Error(entriesError.message)

      return {
        id: projectRow.id,
        roleTitle: projectRow.role_title,
        clientName:
          (projectRow.clients as unknown as { name: string } | null)?.name ?? 'Unknown client',
        vertical: projectRow.vertical ?? '',
        status: projectRow.status,
        isPoc: projectRow.is_poc,
        jobs: (jobRows ?? []).map((job) => ({
          id: job.id,
          title: job.title,
          status: job.status,
          location: job.location ?? 'Location TBD',
        })),
        candidates: (entryRows ?? []).map((entry) => ({
          id: entry.id,
          candidateId: entry.candidate_id,
          fullName:
            (entry.candidates as unknown as { full_name: string } | null)?.full_name ??
            'Unnamed candidate',
          stage: entry.current_stage,
        })),
      }
    },
    [projectId, user?.id],
    { isEmpty: (value) => value === null },
  )

  return (
    <ScreenContainer>
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
        {status === 'loading' && <QueryStateView kind="loading" title="Loading project…" />}
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
            title="Couldn't load this project"
            description={error ?? undefined}
            onRetry={refresh}
          />
        )}
        {status === 'empty' && (
          <QueryStateView
            kind="empty"
            title="Project not found"
            description="It may have been removed, or you may not have access to it."
          />
        )}

        {status === 'success' && data && (
          <>
            <View style={styles.header}>
              <Text style={styles.title}>{data.roleTitle}</Text>
              <Text style={styles.subtitle}>
                {data.clientName}
                {data.vertical ? ` · ${data.vertical}` : ''}
                {data.isPoc ? ' · Proof of concept' : ''}
              </Text>
              <StatusChip status="pending" label={data.status} />
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionHeading}>Jobs</Text>
              {data.jobs.length === 0 ? (
                <Card>
                  <Text style={styles.emptyText}>No jobs on this project yet.</Text>
                </Card>
              ) : (
                data.jobs.map((job) => (
                  <Pressable
                    key={job.id}
                    onPress={() => navigation.navigate('JobScorecard', { projectId: data.id })}
                    accessibilityRole="button"
                    accessibilityLabel={`${job.title}, ${job.location}, ${job.status}`}
                  >
                    <Card style={styles.rowCard}>
                      <View style={styles.cardTitleColumn}>
                        <Text style={styles.jobTitle}>{job.title}</Text>
                        <Text style={styles.jobSubtitle}>{job.location}</Text>
                      </View>
                      <StatusChip
                        status={job.status === 'open' ? 'passed' : 'pending'}
                        label={job.status}
                      />
                    </Card>
                  </Pressable>
                ))
              )}
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeading}>Candidate pipeline</Text>
                <Pressable
                  onPress={() =>
                    navigation.getParent()?.navigate('PipelineTab', {
                      screen: 'CandidatePipeline',
                      params: { projectId: data.id },
                    })
                  }
                  accessibilityRole="button"
                  accessibilityLabel="View all candidates in this project's pipeline"
                >
                  <Text style={styles.viewAll}>View all</Text>
                </Pressable>
              </View>
              {data.candidates.length === 0 ? (
                <Card>
                  <Text style={styles.emptyText}>
                    No candidates in this project&apos;s pipeline yet.
                  </Text>
                </Card>
              ) : (
                data.candidates.map((candidate) => (
                  <Pressable
                    key={candidate.id}
                    onPress={() =>
                      navigation.getParent()?.navigate('PipelineTab', {
                        screen: 'CandidatePipeline',
                        params: { projectId: data.id },
                      })
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`${candidate.fullName}, ${STAGE_LABELS[candidate.stage] ?? candidate.stage}`}
                  >
                    <Card style={styles.rowCard}>
                      <Text style={styles.jobTitle} numberOfLines={1}>
                        {candidate.fullName}
                      </Text>
                      <StatusChip
                        status={STAGE_BADGE[candidate.stage] ?? 'pending'}
                        label={STAGE_LABELS[candidate.stage] ?? candidate.stage}
                      />
                    </Card>
                  </Pressable>
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  )
}

const styles = StyleSheet.create({
  content: {
    paddingTop: spacing.lg16,
    paddingBottom: spacing.xl24,
    gap: spacing.xl24,
  },
  header: {
    gap: spacing.xs4,
  },
  title: {
    ...typeScale.headlineLg,
    color: colors.tertiary,
  },
  subtitle: {
    ...typeScale.bodySm,
    color: colors.textMuted,
    marginBottom: spacing.xs4,
  },
  section: {
    gap: spacing.sm8,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionHeading: {
    ...typeScale.headlineSm,
    color: colors.tertiary,
  },
  viewAll: {
    ...typeScale.bodySm,
    color: colors.secondary,
    fontFamily: 'Geist_500Medium',
  },
  rowCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm8,
    marginBottom: spacing.sm8,
  },
  cardTitleColumn: {
    flex: 1,
    gap: 2,
  },
  jobTitle: {
    ...typeScale.bodyMd,
    fontFamily: 'Geist_500Medium',
    color: colors.tertiary,
    flexShrink: 1,
  },
  jobSubtitle: {
    ...typeScale.bodySm,
    color: colors.textMuted,
  },
  emptyText: {
    ...typeScale.bodySm,
    color: colors.textMuted,
  },
})
