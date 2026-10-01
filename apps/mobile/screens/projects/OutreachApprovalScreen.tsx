import { useRef, useState } from 'react'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
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
import type { StatusColorKey } from '@/theme/tokens'
import { colors, spacing, typeScale } from '@/theme/tokens'
import type { ProjectsStackParamList } from '@/navigation/types'
import { useActiveOrganization } from '@/lib/data/useActiveOrganization'
import { useQueryState } from '@/lib/data/useQueryState'
import {
  approveOutreachMessage,
  ApiNetworkError,
  ApiResponseError,
  type OutreachApprovalRequest,
} from '@/lib/api/client'
import { useNetworkStatus } from '@/lib/network/networkStatus'
import { hasPermission } from '@rqi/types'

type Props = NativeStackScreenProps<ProjectsStackParamList, 'OutreachApproval'>

interface EvidenceRef {
  excerpt?: string
  sourceKind?: string
}

interface OutreachMessageRow {
  id: string
  candidateName: string
  channel: string
  status: string
  subject: string | null
  draftBody: string
  generatedBy: 'ai' | 'recruiter'
  editedByHuman: boolean
  personalizationEvidence: EvidenceRef[]
}

const STATUS_TONE: Record<string, StatusColorKey> = {
  drafted: 'pending',
  awaiting_approval: 'pending',
  approved: 'passed',
  rejected: 'failed',
}

type Decision = 'approved' | 'rejected' | 'changes_requested'

export function OutreachApprovalScreen({ route }: Props) {
  const { candidateId } = route.params
  const { organization } = useActiveOrganization()
  const organizationId = organization?.organizationId ?? null
  const canDecide = organization ? hasPermission(organization.role, 'outreach', 'update') : false
  const { online } = useNetworkStatus()

  const query = useQueryState<OutreachMessageRow | null>(
    async (supabase) => {
      if (!organizationId) throw new Error('Resolving your organization…')
      const [{ data: candidate }, { data: message, error }] = await Promise.all([
        supabase.from('candidates').select('full_name').eq('id', candidateId).maybeSingle(),
        supabase
          .from('outreach_messages')
          .select(
            'id, channel, status, subject, draft_body, generated_by, edited_by_human, personalization_evidence',
          )
          .eq('candidate_id', candidateId)
          .eq('organization_id', organizationId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])
      if (error) throw new Error(error.message)
      if (!message) return null
      return {
        id: message.id as string,
        candidateName: candidate?.full_name ?? 'Candidate',
        channel: message.channel as string,
        status: message.status as string,
        subject: message.subject as string | null,
        draftBody: message.draft_body as string,
        generatedBy: message.generated_by as 'ai' | 'recruiter',
        editedByHuman: message.edited_by_human as boolean,
        personalizationEvidence: (message.personalization_evidence as EvidenceRef[] | null) ?? [],
      }
    },
    [organizationId, candidateId],
    { isEmpty: (data) => data === null },
  )

  const [decision, setDecision] = useState<Decision | null>(null)
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sheetRef = useRef<AppBottomSheetRef>(null)

  function openDecision(next: Decision) {
    setDecision(next)
    setReason('')
    setError(null)
    sheetRef.current?.expand()
  }

  async function confirm() {
    if (!organizationId || !decision || !query.data) return
    if (decision !== 'approved' && reason.trim().length === 0) {
      setError('A reason is required when rejecting or requesting changes.')
      return
    }
    // Approval/rejection is a high-impact, non-reversible-feeling decision
    // with no offline conflict-resolution design (the brief's "safe
    // offline behavior" constraint) — fail clean with a clear message
    // rather than attempting a doomed request or silently queuing it.
    if (!online) {
      setError("You're offline — try again when connected.")
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const body: OutreachApprovalRequest = {
        organizationId,
        decision,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      }
      await approveOutreachMessage(query.data.id, body)
      sheetRef.current?.close()
      query.refresh()
    } catch (err) {
      if (err instanceof ApiNetworkError) {
        setError("You're offline — try again when connected.")
      } else if (err instanceof ApiResponseError) {
        setError(String((err.body as { error?: string })?.error ?? err.message))
      } else {
        setError('Could not record this decision.')
      }
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
                  ? 'Could not load this message'
                  : 'No draft yet'
          }
          description={
            query.status === 'offline'
              ? 'Try again when you have a connection.'
              : query.status === 'not_configured'
                ? 'This environment has no live Supabase project configured.'
                : query.status === 'error'
                  ? (query.error ?? undefined)
                  : 'No outreach message has been drafted for this candidate yet.'
          }
          onRetry={query.refresh}
        />
      </ScreenContainer>
    )
  }

  const message = query.data!
  const awaitingApproval = message.status === 'awaiting_approval'

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <Text style={styles.name}>{message.candidateName}</Text>
          <StatusChip
            status={STATUS_TONE[message.status] ?? 'pending'}
            label={message.status.replace(/_/g, ' ')}
          />
        </View>

        <Card style={styles.card}>
          <View style={styles.aiRow}>
            <StatusChip
              status="warning"
              label={message.generatedBy === 'ai' ? 'AI-drafted' : 'Recruiter-drafted'}
            />
            {message.editedByHuman && <StatusChip status="pending" label="Edited" />}
          </View>
          <Text style={styles.channel}>{message.channel.toUpperCase()}</Text>
          {message.subject && <Text style={styles.subject}>Subject: {message.subject}</Text>}
          <Text style={styles.body}>{message.draftBody}</Text>
        </Card>

        <Text style={styles.sectionTitle}>Evidence used for personalization</Text>
        {message.personalizationEvidence.length > 0 ? (
          <Card style={styles.card}>
            {message.personalizationEvidence.map((ref, i) => (
              <Text key={i} style={styles.evidenceItem}>
                • {ref.excerpt ?? JSON.stringify(ref)}
              </Text>
            ))}
          </Card>
        ) : (
          <Text style={styles.emptyBody}>No evidence citations were recorded for this draft.</Text>
        )}
      </ScrollView>

      {canDecide && awaitingApproval && (
        <StickyActionBar>
          <Button
            variant="destructive"
            onPress={() => openDecision('rejected')}
            disabled={submitting}
          >
            Reject
          </Button>
          <Button
            variant="secondary"
            onPress={() => openDecision('changes_requested')}
            disabled={submitting}
          >
            Request changes
          </Button>
          <Button variant="verify" onPress={() => openDecision('approved')} disabled={submitting}>
            Approve
          </Button>
        </StickyActionBar>
      )}

      <BottomSheet ref={sheetRef} snapPoints={['45%']}>
        <View style={styles.sheetForm}>
          <Text style={styles.sheetTitle}>
            {decision === 'approved'
              ? 'Confirm approval'
              : decision === 'rejected'
                ? 'Confirm rejection'
                : 'Confirm change request'}
          </Text>
          {decision !== 'approved' && (
            <FormField label="Reason (required)">
              <Input value={reason} onChangeText={setReason} multiline placeholder="Why?" />
            </FormField>
          )}
          {error && <Text style={styles.errorText}>{error}</Text>}
          <Button
            variant={decision === 'rejected' ? 'destructive' : 'primary'}
            onPress={confirm}
            loading={submitting}
            disabled={submitting || (decision !== 'approved' && reason.trim().length === 0)}
          >
            Confirm
          </Button>
        </View>
      </BottomSheet>
    </ScreenContainer>
  )
}

const styles = StyleSheet.create({
  content: { paddingVertical: spacing.lg16, gap: spacing.md12, paddingBottom: spacing.xl24 * 3 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { ...typeScale.headlineLg, color: colors.tertiary },
  card: { gap: spacing.sm8 },
  aiRow: { flexDirection: 'row', gap: spacing.sm8 },
  channel: { ...typeScale.labelMd, color: colors.textMuted },
  subject: { ...typeScale.bodyMd, color: colors.tertiary, fontFamily: 'Geist_600SemiBold' },
  body: { ...typeScale.bodyMd, color: colors.tertiary },
  sectionTitle: { ...typeScale.headlineSm, color: colors.tertiary },
  evidenceItem: { ...typeScale.bodySm, color: colors.textMuted },
  emptyBody: { ...typeScale.bodySm, color: colors.textMuted },
  sheetForm: { gap: spacing.md12 },
  sheetTitle: { ...typeScale.headlineMd, color: colors.tertiary },
  errorText: { ...typeScale.bodySm, color: colors.errorText },
})
