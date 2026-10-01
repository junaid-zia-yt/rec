import { useRef, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import type { AppBottomSheetRef } from '@/components/ui/BottomSheet'
import {
  BottomSheet,
  Button,
  Card,
  QueryStateView,
  ScreenContainer,
  StatusChip,
  StickyActionBar,
} from '@/components/ui'
import { colors, spacing, typeScale } from '@/theme/tokens'
import type { ShortlistsStackParamList } from '@/navigation/types'
import { useActiveOrganization } from '@/lib/data/useActiveOrganization'
import { useQueryState } from '@/lib/data/useQueryState'
import { approveShortlistInternally, ApiResponseError } from '@/lib/api/client'
import { hasPermission } from '@rqi/types'
import { loadShortlistDetail, type ShortlistDetail } from './shortlist-data'

type Props = NativeStackScreenProps<ShortlistsStackParamList, 'FinalShortlist'>

function pct(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)}%`
}

export function FinalShortlistScreen({ route }: Props) {
  const { projectId, shortlistId } = route.params ?? {}
  const { organization } = useActiveOrganization()
  const organizationId = organization?.organizationId ?? null
  const canApproveInternally = organization
    ? hasPermission(organization.role, 'shortlists', 'update')
    : false

  const query = useQueryState<ShortlistDetail | null>(
    async (supabase) => {
      if (!organizationId) throw new Error('Resolving your organization…')
      // docs/privacy-review.md §5 — recruiter_note is internal-only; only
      // fetch/render it for a caller who could also act on it internally
      // (mirrors the web shortlist detail page's identical canManageInternally gate).
      return loadShortlistDetail(
        supabase,
        organizationId,
        { shortlistId, projectId },
        { includeInternalNotes: canApproveInternally },
      )
    },
    [organizationId, shortlistId, projectId, canApproveInternally],
    { isEmpty: (data) => data === null },
  )

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sheetRef = useRef<AppBottomSheetRef>(null)

  async function confirmApprove() {
    if (!organizationId || !query.data) return
    setSubmitting(true)
    setError(null)
    try {
      await approveShortlistInternally(query.data.shortlistId, {
        organizationId,
        shortlistVersionId: query.data.shortlistVersionId,
      })
      sheetRef.current?.close()
      query.refresh()
    } catch (err) {
      setError(
        err instanceof ApiResponseError
          ? String((err.body as { error?: string })?.error ?? err.message)
          : 'Could not record internal approval.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  if (query.status !== 'success') {
    return (
      <ScreenContainer>
        <QueryStateView
          kind={query.status as 'loading' | 'error' | 'empty' | 'not_configured' | 'offline'}
          title={
            query.status === 'offline'
              ? "You're offline"
              : query.status === 'not_configured'
                ? 'Not connected'
                : query.status === 'error'
                  ? 'Could not load this shortlist'
                  : 'No shortlist yet'
          }
          description={
            query.status === 'offline'
              ? 'Try again when you have a connection.'
              : query.status === 'not_configured'
                ? 'This environment has no live Supabase project configured.'
                : query.status === 'error'
                  ? (query.error ?? undefined)
                  : 'No finalist shortlist has been built for this project yet.'
          }
          onRetry={query.refresh}
        />
      </ScreenContainer>
    )
  }

  const shortlist = query.data!
  const canApproveNow = canApproveInternally && shortlist.status === 'pending_internal_approval'

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>{shortlist.jobTitle}</Text>
          <StatusChip
            status={
              shortlist.status === 'internally_approved' || shortlist.status === 'accepted'
                ? 'passed'
                : shortlist.status === 'rejected'
                  ? 'failed'
                  : 'pending'
            }
            label={shortlist.status.replace(/_/g, ' ')}
          />
        </View>
        <Text style={styles.clientName}>{shortlist.clientName}</Text>

        {shortlist.candidates.map((c) => (
          <Card key={c.shortlistCandidateId} style={styles.card}>
            <View style={styles.candidateHeader}>
              <Text style={styles.rank}>#{c.rank}</Text>
              <Text style={styles.candidateName}>{c.candidateName}</Text>
            </View>
            <View style={styles.metricGrid}>
              <Metric label="Match score" value={pct(c.overallScore)} />
              <Metric label="Gates passed" value={`${c.gatesPassed}/${c.gatesTotal}`} />
              <Metric label="Evidence" value={pct(c.evidenceCoveragePct)} />
              <Metric label="Completeness" value={pct(c.dataCompletenessPct)} />
            </View>
            {c.gatesFailed > 0 && <StatusChip status="failed" label="Failed mandatory gate" />}
            {c.recruiterNote && <Text style={styles.note}>{c.recruiterNote}</Text>}
          </Card>
        ))}
      </ScrollView>

      {canApproveNow && (
        <StickyActionBar>
          <Button variant="verify" onPress={() => sheetRef.current?.expand()} disabled={submitting}>
            Record internal approval
          </Button>
        </StickyActionBar>
      )}

      {shortlist.status === 'internally_approved' && (
        <StickyActionBar>
          <Text style={styles.awaitingNote}>
            Internally approved — awaiting an agency admin to send this to the client.
          </Text>
        </StickyActionBar>
      )}

      <BottomSheet ref={sheetRef} snapPoints={['35%']}>
        <View style={styles.sheetForm}>
          <Text style={styles.sheetTitle}>Confirm internal approval</Text>
          <Text style={styles.emptyBody}>
            This records the agency&rsquo;s internal sign-off on these {shortlist.candidates.length}{' '}
            finalist(s). Sending the shortlist to the client is a separate, later step.
          </Text>
          {error && <Text style={styles.errorText}>{error}</Text>}
          <Button
            variant="verify"
            onPress={confirmApprove}
            loading={submitting}
            disabled={submitting}
          >
            Confirm approval
          </Button>
        </View>
      </BottomSheet>
    </ScreenContainer>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  content: { paddingVertical: spacing.lg16, gap: spacing.md12, paddingBottom: spacing.xl24 * 3 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { ...typeScale.headlineLg, color: colors.tertiary },
  clientName: { ...typeScale.bodySm, color: colors.textMuted },
  card: { gap: spacing.sm8 },
  candidateHeader: { flexDirection: 'row', gap: spacing.sm8, alignItems: 'center' },
  rank: { ...typeScale.headlineSm, color: colors.secondary },
  candidateName: { ...typeScale.bodyMd, fontFamily: 'Geist_600SemiBold', color: colors.tertiary },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg16 },
  metric: { minWidth: '40%' },
  metricLabel: { ...typeScale.labelMd, color: colors.textMuted },
  metricValue: { ...typeScale.headlineSm, color: colors.tertiary },
  note: { ...typeScale.bodySm, color: colors.textMuted },
  awaitingNote: { ...typeScale.bodySm, color: colors.textMuted, textAlign: 'center', flex: 1 },
  sheetForm: { gap: spacing.md12 },
  sheetTitle: { ...typeScale.headlineMd, color: colors.tertiary },
  emptyBody: { ...typeScale.bodySm, color: colors.textMuted },
  errorText: { ...typeScale.bodySm, color: colors.errorText },
})
