import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { Card, QueryStateView, ScreenContainer, StatusChip } from '@/components/ui'
import { colors, spacing, typeScale } from '@/theme/tokens'
import type { ProjectsStackParamList } from '@/navigation/types'
import { useActiveOrganization } from '@/lib/data/useActiveOrganization'
import { useQueryState } from '@/lib/data/useQueryState'

type Props = NativeStackScreenProps<ProjectsStackParamList, 'EvidenceReview'>

interface EvidenceRow {
  id: string
  requirementId: string
  requirementName: string
  sourceKind: string
  excerpt: string
  location: string | null
  relevanceScore: number | null
  confidence: number | null
  isDirectStatement: boolean
}

/**
 * Read-only this wave (task brief: no mutation route was requested for
 * evidence review) — renders exactly what `requirement_evidence` stores,
 * never inventing an excerpt or a source the row doesn't have (Core
 * Principle #5, "AI must never invent candidate qualifications or
 * evidence" — extends to this UI never implying evidence exists beyond
 * what's persisted).
 */
export function EvidenceReviewScreen({ route }: Props) {
  const { candidateId, requirementId } = route.params
  const { organization } = useActiveOrganization()
  const organizationId = organization?.organizationId ?? null

  const query = useQueryState<EvidenceRow[]>(
    async (supabase) => {
      if (!organizationId) throw new Error('Resolving your organization…')
      let builder = supabase
        .from('requirement_evidence')
        .select(
          'id, requirement_id, source_kind, excerpt, location, relevance_score, confidence, is_direct_statement, job_requirements(name)',
        )
        .eq('candidate_id', candidateId)
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
      if (requirementId) builder = builder.eq('requirement_id', requirementId)
      const { data, error } = await builder
      if (error) throw new Error(error.message)
      return (data ?? []).map((row: Record<string, unknown>) => ({
        id: row.id as string,
        requirementId: row.requirement_id as string,
        requirementName: (row.job_requirements as { name?: string } | null)?.name ?? 'Requirement',
        sourceKind: row.source_kind as string,
        excerpt: row.excerpt as string,
        location: row.location as string | null,
        relevanceScore: row.relevance_score as number | null,
        confidence: row.confidence as number | null,
        isDirectStatement: row.is_direct_statement as boolean,
      }))
    },
    [organizationId, candidateId, requirementId],
  )

  return (
    <ScreenContainer>
      {query.status !== 'success' ? (
        <QueryStateView
          kind={query.status as 'loading' | 'error' | 'empty' | 'not_configured' | 'offline'}
          title={
            query.status === 'offline'
              ? "You're offline"
              : query.status === 'not_configured'
                ? 'Not connected'
                : query.status === 'error'
                  ? 'Could not load evidence'
                  : 'No evidence yet'
          }
          description={
            query.status === 'offline'
              ? 'Try again when you have a connection.'
              : query.status === 'not_configured'
                ? 'This environment has no live Supabase project configured.'
                : query.status === 'error'
                  ? (query.error ?? undefined)
                  : 'No evidence has been retrieved for this candidate yet.'
          }
          onRetry={query.refresh}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {query.data!.map((item) => (
            <Card key={item.id} style={styles.card}>
              <Text style={styles.requirement}>{item.requirementName}</Text>
              <Text style={styles.excerpt}>&ldquo;{item.excerpt}&rdquo;</Text>
              <View style={styles.metaRow}>
                <StatusChip status="pending" label={item.sourceKind.replace(/_/g, ' ')} />
                {!item.isDirectStatement && <StatusChip status="warning" label="Inferred" />}
              </View>
              <View style={styles.detailRow}>
                {item.location && <Text style={styles.detail}>{item.location}</Text>}
                {item.relevanceScore !== null && (
                  <Text style={styles.detail}>
                    Relevance {Math.round(item.relevanceScore * 100)}%
                  </Text>
                )}
                {item.confidence !== null && (
                  <Text style={styles.detail}>Confidence {Math.round(item.confidence * 100)}%</Text>
                )}
              </View>
            </Card>
          ))}
        </ScrollView>
      )}
    </ScreenContainer>
  )
}

const styles = StyleSheet.create({
  content: { paddingVertical: spacing.lg16, gap: spacing.md12 },
  card: { gap: spacing.sm8 },
  requirement: { ...typeScale.labelMd, color: colors.textMuted },
  excerpt: { ...typeScale.bodyMd, color: colors.tertiary, fontStyle: 'italic' },
  metaRow: { flexDirection: 'row', gap: spacing.sm8, flexWrap: 'wrap' },
  detailRow: { flexDirection: 'row', gap: spacing.md12, flexWrap: 'wrap' },
  detail: { ...typeScale.bodySm, color: colors.textMuted },
})
