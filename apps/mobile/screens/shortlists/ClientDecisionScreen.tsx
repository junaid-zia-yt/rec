import { useRef, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import type { AppBottomSheetRef } from '@/components/ui/BottomSheet'
import {
  BottomSheet,
  Button,
  Card,
  FormField,
  Input,
  QueryStateView,
  ScreenContainer,
  StatusChip,
  StickyActionBar,
} from '@/components/ui'
import { colors, spacing, typeScale } from '@/theme/tokens'
import type { ShortlistsStackParamList } from '@/navigation/types'
import { useActiveOrganization } from '@/lib/data/useActiveOrganization'
import { useQueryState } from '@/lib/data/useQueryState'
import { submitShortlistClientDecision, ApiResponseError } from '@/lib/api/client'
import { hasPermission } from '@rqi/types'
import { loadShortlistDetail, type ShortlistDetail } from './shortlist-data'

type Props = NativeStackScreenProps<ShortlistsStackParamList, 'ClientDecision'>

type Decision = 'accept' | 'discuss' | 'reject'

function pct(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)}%`
}

export function ClientDecisionScreen({ route }: Props) {
  const { shortlistId } = route.params
  const { organization } = useActiveOrganization()
  const organizationId = organization?.organizationId ?? null
  // Only the 'approve' permission LEVEL grants this action — see
  // packages/types/src/permissions.ts's own comment: 'full' never grants
  // the 'approve' ACTION, so this deliberately checks 'approve', not
  // 'update' (mirrors the web route's own gate).
  const canDecide = organization ? hasPermission(organization.role, 'shortlists', 'approve') : false

  const query = useQueryState<ShortlistDetail | null>(
    async (supabase) => {
      if (!organizationId) throw new Error('Resolving your organization…')
      return loadShortlistDetail(supabase, organizationId, { shortlistId })
    },
    [organizationId, shortlistId],
    { isEmpty: (data) => data === null },
  )

  const [decision, setDecision] = useState<Decision | null>(null)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sheetRef = useRef<AppBottomSheetRef>(null)

  function openDecision(next: Decision) {
    setDecision(next)
    setNotes('')
    setError(null)
    sheetRef.current?.expand()
  }

  async function confirm() {
    if (!organizationId || !decision || !query.data) return
    if (decision !== 'accept' && notes.trim().length === 0) {
      setError('Notes are required when discussing or rejecting a shortlist.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await submitShortlistClientDecision(query.data.shortlistId, {
        organizationId,
        shortlistVersionId: query.data.shortlistVersionId,
        clientId: query.data.clientId,
        decision,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      })
      sheetRef.current?.close()
      query.refresh()
    } catch (err) {
      setError(
        err instanceof ApiResponseError
          ? String((err.body as { error?: string })?.error ?? err.message)
          : 'Could not record this decision.',
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
                  : 'This shortlist has not been sent to you yet.'
          }
          onRetry={query.refresh}
        />
      </ScreenContainer>
    )
  }

  const shortlist = query.data!
  const awaitingDecision = shortlist.status === 'sent_to_client'
  const alreadyDecided =
    shortlist.status === 'accepted' ||
    shortlist.status === 'discuss' ||
    shortlist.status === 'rejected'

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>{shortlist.jobTitle}</Text>
          <StatusChip
            status={
              shortlist.status === 'accepted'
                ? 'passed'
                : shortlist.status === 'rejected'
                  ? 'failed'
                  : 'pending'
            }
            label={shortlist.status.replace(/_/g, ' ')}
          />
        </View>

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
            </View>
          </Card>
        ))}

        {alreadyDecided && (
          <Text style={styles.emptyBody}>
            A decision has already been recorded for this shortlist.
          </Text>
        )}
        {!canDecide && awaitingDecision && (
          <Text style={styles.emptyBody}>You have read-only access to this shortlist.</Text>
        )}
      </ScrollView>

      {canDecide && awaitingDecision && (
        <StickyActionBar>
          <Button
            variant="destructive"
            onPress={() => openDecision('reject')}
            disabled={submitting}
          >
            Reject
          </Button>
          <Button variant="secondary" onPress={() => openDecision('discuss')} disabled={submitting}>
            Discuss
          </Button>
          <Button variant="verify" onPress={() => openDecision('accept')} disabled={submitting}>
            Accept
          </Button>
        </StickyActionBar>
      )}

      <BottomSheet ref={sheetRef} snapPoints={['45%']}>
        <View style={styles.sheetForm}>
          <Text style={styles.sheetTitle}>
            {decision === 'accept'
              ? 'Confirm acceptance'
              : decision === 'reject'
                ? 'Confirm rejection'
                : 'Confirm discussion request'}
          </Text>
          {decision !== 'accept' && (
            <FormField label="Notes (required)">
              <Input value={notes} onChangeText={setNotes} multiline placeholder="Why?" />
            </FormField>
          )}
          {error && <Text style={styles.errorText}>{error}</Text>}
          <Button
            variant={decision === 'reject' ? 'destructive' : 'primary'}
            onPress={confirm}
            loading={submitting}
            disabled={submitting}
          >
            Confirm
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
  card: { gap: spacing.sm8 },
  candidateHeader: { flexDirection: 'row', gap: spacing.sm8, alignItems: 'center' },
  rank: { ...typeScale.headlineSm, color: colors.secondary },
  candidateName: { ...typeScale.bodyMd, fontFamily: 'Geist_600SemiBold', color: colors.tertiary },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg16 },
  metric: { minWidth: '30%' },
  metricLabel: { ...typeScale.labelMd, color: colors.textMuted },
  metricValue: { ...typeScale.headlineSm, color: colors.tertiary },
  emptyBody: { ...typeScale.bodySm, color: colors.textMuted, textAlign: 'center' },
  sheetForm: { gap: spacing.md12 },
  sheetTitle: { ...typeScale.headlineMd, color: colors.tertiary },
  errorText: { ...typeScale.bodySm, color: colors.errorText },
})
