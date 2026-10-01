import { memo, useCallback } from 'react'
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import type { ListRenderItemInfo } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { AvatarInitials, Card, QueryStateView, ScreenContainer, StatusChip } from '@/components/ui'
import { useAuth } from '@/lib/auth/AuthProvider'
import { useQueryState } from '@/lib/data/useQueryState'
import { resolveActiveMembership } from '@/lib/data/org'
import { colors, spacing, typeScale } from '@/theme/tokens'
import type { PipelineStackParamList } from '@/navigation/types'
import { STAGE_BADGE, STAGE_LABELS } from '@/lib/pipeline/stages'

type Props = NativeStackScreenProps<PipelineStackParamList, 'CandidatePipeline'>

interface MatchInfo {
  eligibility: 'eligible' | 'ineligible' | 'pending_verification'
  overallScore: number | null
}

interface CandidateCard {
  entryId: string
  candidateId: string
  fullName: string
  stage: string
  projectId: string
  projectName: string
  match: MatchInfo | null
}

const ELIGIBILITY_TONE = {
  eligible: 'passed',
  ineligible: 'failed',
  pending_verification: 'warning',
} as const

const ELIGIBILITY_LABEL = {
  eligible: 'Gates passed',
  ineligible: 'Gate failed',
  pending_verification: 'Unverified',
} as const

/**
 * Performance (Build Phase 14 Wave 4): extracted from an inline
 * `renderItem` arrow function and wrapped in `React.memo` so FlatList can
 * actually skip re-rendering a row whose own `item`/`showProjectName`
 * props haven't changed — an inline `renderItem` defined directly in JSX
 * gets a new function identity every parent render, which defeats this
 * regardless of memoization further down, the fix this wave's brief calls
 * out for FlatList screens generally. `onPress` takes the candidate id
 * rather than closing over `navigation` inside the row, so the row's own
 * props (and therefore memo) stay stable across re-renders of the screen.
 */
const CandidatePipelineRow = memo(function CandidatePipelineRow({
  item,
  showProjectName,
  onPress,
}: {
  item: CandidateCard
  showProjectName: boolean
  onPress: (candidateId: string) => void
}) {
  return (
    <Pressable
      onPress={() => onPress(item.candidateId)}
      accessibilityRole="button"
      accessibilityLabel={`${item.fullName}, ${STAGE_LABELS[item.stage] ?? item.stage}, ${
        item.match?.overallScore != null ? `${item.match.overallScore}% match` : 'score unverified'
      }`}
    >
      <Card style={styles.card}>
        <View style={styles.row}>
          <AvatarInitials name={item.fullName} />
          <View style={styles.textColumn}>
            <Text style={styles.name} numberOfLines={1}>
              {item.fullName}
            </Text>
            {showProjectName && (
              <Text style={styles.projectName} numberOfLines={1}>
                {item.projectName}
              </Text>
            )}
          </View>
          <StatusChip
            status={STAGE_BADGE[item.stage] ?? 'pending'}
            label={STAGE_LABELS[item.stage] ?? item.stage}
          />
        </View>
        <View style={styles.metaRow}>
          <StatusChip
            status={item.match ? ELIGIBILITY_TONE[item.match.eligibility] : 'warning'}
            label={item.match ? ELIGIBILITY_LABEL[item.match.eligibility] : 'Unverified'}
          />
          <Text style={styles.scoreText}>
            {item.match?.overallScore != null
              ? `${item.match.overallScore}% match`
              : 'Score unverified'}
          </Text>
        </View>
      </Card>
    </Pressable>
  )
})

/**
 * Candidate pipeline — Build Phase 13 Wave 3 brief: a card-per-candidate
 * list (never a compressed table on mobile), initials avatar (never a
 * photo), pipeline stage chip, mandatory-gate summary, overall match score
 * where one has actually been computed. Reads `candidate_project_entries`
 * for stage (same table apps/web's /candidates pipeline view reads) plus,
 * best-effort, `candidate_role_matches` for the eligibility/score columns —
 * a candidate with no match row yet shows "Unverified", never a fabricated
 * number (project rule: "missing candidate information must be marked as
 * unverified").
 */
export function CandidatePipelineScreen({ route, navigation }: Props) {
  const projectId = route.params?.projectId
  const { user } = useAuth()

  const { status, data, error, refreshing, refresh } = useQueryState<CandidateCard[]>(
    async (supabase) => {
      if (!user) throw new Error('Not signed in.')

      const membership = await resolveActiveMembership(supabase, user.id)
      if (!membership) throw new Error('No active organization membership found.')

      let entryQuery = supabase
        .from('candidate_project_entries')
        .select(
          'id, candidate_id, recruitment_project_id, current_stage, candidates(full_name), recruitment_projects(role_title)',
        )
        .eq('organization_id', membership.organizationId)
        .order('updated_at', { ascending: false })

      if (projectId) {
        // Performance (Build Phase 14 Wave 4): this branch had no `.limit()`
        // at all — a single project's pipeline could fetch an unbounded
        // number of candidate_project_entries rows. Same safety-cap
        // convention as the "no projectId" branch below and the web
        // candidates list loader (apps/web/app/(app)/candidates/page.tsx).
        entryQuery = entryQuery.eq('recruitment_project_id', projectId).limit(500)
      } else {
        entryQuery = entryQuery.limit(50)
      }

      const { data: entries, error: entriesError } = await entryQuery
      if (entriesError) throw new Error(entriesError.message)

      const rows = entries ?? []
      const projectIds = Array.from(new Set(rows.map((row) => row.recruitment_project_id)))

      const { data: matches, error: matchesError } = await (projectIds.length > 0
        ? supabase
            .from('candidate_role_matches')
            .select('candidate_id, recruitment_project_id, eligibility, overall_score')
            .eq('organization_id', membership.organizationId)
            .in('recruitment_project_id', projectIds)
        : Promise.resolve({
            data: [] as {
              candidate_id: string
              recruitment_project_id: string
              eligibility: MatchInfo['eligibility']
              overall_score: number | null
            }[],
            error: null,
          }))

      if (matchesError) throw new Error(matchesError.message)

      const matchByKey = new Map<string, MatchInfo>()
      for (const match of matches ?? []) {
        matchByKey.set(`${match.candidate_id}:${match.recruitment_project_id}`, {
          eligibility: match.eligibility,
          overallScore: match.overall_score === null ? null : Number(match.overall_score),
        })
      }

      return rows.map((row) => ({
        entryId: row.id,
        candidateId: row.candidate_id,
        fullName:
          (row.candidates as unknown as { full_name: string } | null)?.full_name ??
          'Unnamed candidate',
        stage: row.current_stage,
        projectId: row.recruitment_project_id,
        projectName:
          (row.recruitment_projects as unknown as { role_title: string } | null)?.role_title ??
          'Unknown project',
        match: matchByKey.get(`${row.candidate_id}:${row.recruitment_project_id}`) ?? null,
      }))
    },
    [projectId, user?.id],
  )

  const handleCandidatePress = useCallback(
    (candidateId: string) => {
      navigation.navigate('CandidateEvaluation', { candidateId })
    },
    [navigation],
  )

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<CandidateCard>) => (
      <CandidatePipelineRow
        item={item}
        showProjectName={!projectId}
        onPress={handleCandidatePress}
      />
    ),
    [projectId, handleCandidatePress],
  )

  return (
    <ScreenContainer>
      <FlatList
        data={status === 'success' ? (data ?? []) : []}
        keyExtractor={(item) => item.entryId}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.secondary}
          />
        }
        ListEmptyComponent={
          status === 'loading' ? (
            <QueryStateView kind="loading" title="Loading pipeline…" />
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
              title="Couldn't load the pipeline"
              description={error ?? undefined}
              onRetry={refresh}
            />
          ) : status === 'empty' ? (
            <QueryStateView
              kind="empty"
              title="No candidates in this pipeline yet"
              description="Candidates sourced for this project will appear here."
            />
          ) : null
        }
        renderItem={renderItem}
      />
    </ScreenContainer>
  )
}

const styles = StyleSheet.create({
  listContent: {
    paddingTop: spacing.lg16,
    paddingBottom: spacing.xl24,
    flexGrow: 1,
  },
  card: {
    gap: spacing.sm8,
    marginBottom: spacing.md12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md12,
  },
  textColumn: {
    flex: 1,
    gap: 2,
  },
  name: {
    ...typeScale.bodyMd,
    fontFamily: 'Geist_500Medium',
    color: colors.tertiary,
  },
  projectName: {
    ...typeScale.bodySm,
    color: colors.textMuted,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  scoreText: {
    ...typeScale.bodySm,
    color: colors.textMuted,
  },
})
