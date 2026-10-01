import { useRef, useState } from 'react'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
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
} from '@/components/ui'
import type { StatusColorKey } from '@/theme/tokens'
import { colors, spacing, typeScale } from '@/theme/tokens'
import type { PipelineStackParamList } from '@/navigation/types'
import { useActiveOrganization } from '@/lib/data/useActiveOrganization'
import { useQueryState } from '@/lib/data/useQueryState'
import { submitGateOverride, ApiResponseError } from '@/lib/api/client'
import { hasPermission } from '@rqi/types'

type Props = NativeStackScreenProps<PipelineStackParamList, 'CandidateEvaluation'>

interface MatchRow {
  id: string
  jobId: string
  jobTitle: string
  latestMatchingRunId: string
  eligibility: 'eligible' | 'ineligible' | 'pending_verification'
  overallScore: number | null
  evidenceCoveragePct: number
  dataCompletenessPct: number
  confidence: number | null
  reviewStatus: string
}

interface CandidateHead {
  candidateName: string
  matches: MatchRow[]
}

interface GateRow {
  id: string
  requirementId: string
  requirementName: string
  state: 'passed' | 'failed' | 'unknown' | 'requires_verification' | 'human_override'
  aiSuggestedResult: string | null
  aiSuggestionNote: string | null
  riskNotes: string[]
  overrideResult: string | null
  overrideReason: string | null
  overrideEvidenceNote: string | null
}

const GATE_STATE_STATUS: Record<GateRow['state'], StatusColorKey> = {
  passed: 'passed',
  failed: 'failed',
  unknown: 'pending',
  requires_verification: 'pending',
  human_override: 'warning',
}

function pct(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)}%`
}

export function CandidateEvaluationScreen({ route }: Props) {
  const { candidateId } = route.params
  const { organization } = useActiveOrganization()
  const organizationId = organization?.organizationId ?? null
  const canReview = organization
    ? hasPermission(organization.role, 'human_reviews', 'update')
    : false

  const headQuery = useQueryState<CandidateHead>(
    async (supabase) => {
      if (!organizationId) throw new Error('Resolving your organization…')
      const [{ data: candidate }, { data: matches, error: matchError }] = await Promise.all([
        supabase
          .from('candidates')
          .select('full_name')
          .eq('id', candidateId)
          .eq('organization_id', organizationId)
          .maybeSingle(),
        supabase
          .from('candidate_role_matches')
          .select(
            'id, job_id, latest_matching_run_id, eligibility, overall_score, evidence_coverage_pct, data_completeness_pct, confidence, review_status, jobs(title)',
          )
          .eq('candidate_id', candidateId)
          .eq('organization_id', organizationId)
          .order('updated_at', { ascending: false }),
      ])
      if (matchError) throw new Error(matchError.message)
      return {
        candidateName: candidate?.full_name ?? 'Candidate',
        matches: (matches ?? []).map((m: Record<string, unknown>) => ({
          id: m.id as string,
          jobId: m.job_id as string,
          jobTitle: (m.jobs as { title?: string } | null)?.title ?? 'Role',
          latestMatchingRunId: m.latest_matching_run_id as string,
          eligibility: m.eligibility as MatchRow['eligibility'],
          overallScore: m.overall_score as number | null,
          evidenceCoveragePct: m.evidence_coverage_pct as number,
          dataCompletenessPct: m.data_completeness_pct as number,
          confidence: m.confidence as number | null,
          reviewStatus: m.review_status as string,
        })),
      }
    },
    [organizationId, candidateId],
    { isEmpty: (data) => data.matches.length === 0 },
  )

  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null)
  const matches = headQuery.data?.matches ?? []
  const activeMatchId = selectedMatchId ?? matches[0]?.id ?? null
  const activeMatch = matches.find((m) => m.id === activeMatchId) ?? null

  const gatesQuery = useQueryState<GateRow[]>(
    async (supabase) => {
      if (!activeMatch) return []
      const { data, error } = await supabase
        .from('mandatory_gate_results')
        .select(
          'id, requirement_id, requirement_name, state, ai_suggested_result, ai_suggestion_note, risk_notes, override_result, override_reason, override_evidence_note',
        )
        .eq('candidate_role_match_id', activeMatch.id)
        .eq('matching_run_id', activeMatch.latestMatchingRunId)
      if (error) throw new Error(error.message)
      return (data ?? []).map((g: Record<string, unknown>) => ({
        id: g.id as string,
        requirementId: g.requirement_id as string,
        requirementName: g.requirement_name as string,
        state: g.state as GateRow['state'],
        aiSuggestedResult: g.ai_suggested_result as string | null,
        aiSuggestionNote: g.ai_suggestion_note as string | null,
        riskNotes: (g.risk_notes as string[] | null) ?? [],
        overrideResult: g.override_result as string | null,
        overrideReason: g.override_reason as string | null,
        overrideEvidenceNote: g.override_evidence_note as string | null,
      }))
    },
    [activeMatch?.id],
  )

  const [overrideGate, setOverrideGate] = useState<GateRow | null>(null)
  const sheetRef = useRef<AppBottomSheetRef>(null)

  function openOverride(gate: GateRow) {
    setOverrideGate(gate)
    sheetRef.current?.expand()
  }

  if (headQuery.status !== 'success') {
    return (
      <ScreenContainer>
        <QueryStateView
          kind={headQuery.status as 'loading' | 'error' | 'empty' | 'not_configured' | 'offline'}
          title={
            headQuery.status === 'offline'
              ? "You're offline"
              : headQuery.status === 'not_configured'
                ? 'Not connected'
                : headQuery.status === 'error'
                  ? 'Could not load this candidate'
                  : 'Not evaluated yet'
          }
          description={
            headQuery.status === 'offline'
              ? 'Try again when you have a connection.'
              : headQuery.status === 'not_configured'
                ? 'This environment has no live Supabase project configured.'
                : headQuery.status === 'error'
                  ? (headQuery.error ?? undefined)
                  : headQuery.status === 'empty'
                    ? 'No matching evaluation has run for this candidate yet.'
                    : undefined
          }
          onRetry={headQuery.refresh}
        />
      </ScreenContainer>
    )
  }

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.name}>{headQuery.data?.candidateName}</Text>

        {matches.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.jobPicker}>
            {matches.map((m) => (
              <Pressable
                key={m.id}
                onPress={() => setSelectedMatchId(m.id)}
                accessibilityRole="button"
                accessibilityLabel={`Show evaluation for ${m.jobTitle}`}
                accessibilityState={{ selected: m.id === activeMatchId }}
                style={[styles.jobChip, m.id === activeMatchId && styles.jobChipActive]}
              >
                <Text
                  style={[styles.jobChipLabel, m.id === activeMatchId && styles.jobChipLabelActive]}
                >
                  {m.jobTitle}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        {activeMatch && (
          <Card style={styles.summaryCard}>
            <View style={styles.badgeRow}>
              <StatusChip
                status={ELIGIBILITY_STATUS[activeMatch.eligibility]}
                label={activeMatch.eligibility.replace(/_/g, ' ')}
              />
              <StatusChip
                status={REVIEW_STATUS[activeMatch.reviewStatus] ?? 'pending'}
                label={activeMatch.reviewStatus.replace(/_/g, ' ')}
              />
            </View>
            <View style={styles.metricGrid}>
              <Metric
                label="Overall score"
                value={activeMatch.eligibility === 'eligible' ? pct(activeMatch.overallScore) : '—'}
              />
              <Metric label="Evidence coverage" value={pct(activeMatch.evidenceCoveragePct)} />
              <Metric label="Data completeness" value={pct(activeMatch.dataCompletenessPct)} />
              <Metric
                label="Confidence"
                value={
                  activeMatch.confidence === null
                    ? '—'
                    : `${Math.round(activeMatch.confidence * 100)}%`
                }
              />
            </View>
            {activeMatch.eligibility !== 'eligible' && (
              <Text style={styles.suppressedNote}>
                Score suppressed — a mandatory gate has not passed.
              </Text>
            )}
          </Card>
        )}

        <Text style={styles.sectionTitle}>Mandatory gates</Text>
        {gatesQuery.status === 'loading' ? (
          <ActivityIndicator color={colors.secondary} />
        ) : gatesQuery.data && gatesQuery.data.length > 0 ? (
          <Card style={styles.gatesCard}>
            {gatesQuery.data.map((gate, i) => (
              <View key={gate.id} style={[styles.gateRow, i > 0 && styles.gateRowDivider]}>
                <View style={styles.gateHeader}>
                  <Text style={styles.gateName}>{gate.requirementName}</Text>
                  <StatusChip
                    status={GATE_STATE_STATUS[gate.state]}
                    label={gate.state.replace(/_/g, ' ')}
                  />
                </View>
                {gate.state === 'unknown' && (
                  <Text style={styles.gateNote}>
                    Missing information — no evidence found. Never treated as a pass.
                  </Text>
                )}
                {gate.aiSuggestionNote && (
                  <View style={styles.aiRow}>
                    <StatusChip status="warning" label="AI-suggested" />
                    <Text style={styles.gateNote}>{gate.aiSuggestionNote}</Text>
                  </View>
                )}
                {gate.riskNotes.map((note, ri) => (
                  <Text key={ri} style={styles.riskNote}>
                    ⚠ {note}
                  </Text>
                ))}
                {gate.state === 'human_override' && (
                  <Text style={styles.gateNote}>
                    Overridden to {gate.overrideResult}: {gate.overrideReason} (evidence:{' '}
                    {gate.overrideEvidenceNote})
                  </Text>
                )}
                {canReview && gate.state !== 'human_override' && (
                  <Button variant="secondary" onPress={() => openOverride(gate)}>
                    Override
                  </Button>
                )}
              </View>
            ))}
          </Card>
        ) : (
          <Text style={styles.emptyBody}>No mandatory gates recorded for this evaluation.</Text>
        )}
      </ScrollView>

      <BottomSheet ref={sheetRef} snapPoints={['55%', '85%']}>
        {overrideGate && organizationId && activeMatch && (
          <OverrideForm
            organizationId={organizationId}
            candidateId={candidateId}
            candidateRoleMatchId={activeMatch.id}
            gate={overrideGate}
            onDone={() => {
              sheetRef.current?.close()
              gatesQuery.refresh()
              headQuery.refresh()
            }}
          />
        )}
      </BottomSheet>
    </ScreenContainer>
  )
}

const ELIGIBILITY_STATUS: Record<MatchRow['eligibility'], StatusColorKey> = {
  eligible: 'passed',
  ineligible: 'failed',
  pending_verification: 'pending',
}

const REVIEW_STATUS: Record<string, StatusColorKey> = {
  pending: 'pending',
  approved_for_outreach: 'passed',
  rejected: 'failed',
  requires_verification: 'pending',
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  )
}

function OverrideForm({
  organizationId,
  candidateId,
  candidateRoleMatchId,
  gate,
  onDone,
}: {
  organizationId: string
  candidateId: string
  candidateRoleMatchId: string
  gate: GateRow
  onDone: () => void
}) {
  const [result, setResult] = useState<'pass' | 'fail'>('pass')
  const [reason, setReason] = useState('')
  const [evidenceNote, setEvidenceNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const valid =
    reason.trim().length > 0 &&
    reason.trim().length <= 2000 &&
    evidenceNote.trim().length > 0 &&
    evidenceNote.trim().length <= 2000

  async function submit() {
    setError(null)
    setSubmitting(true)
    try {
      await submitGateOverride({
        organizationId,
        candidateId,
        candidateRoleMatchId,
        gateResultId: gate.id,
        overrideResult: result,
        reason: reason.trim(),
        evidenceNote: evidenceNote.trim(),
      })
      onDone()
    } catch (err) {
      setError(
        err instanceof ApiResponseError
          ? String((err.body as { error?: string })?.error ?? err.message)
          : 'Could not record the override.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <View style={styles.sheetForm}>
      <Text style={styles.sheetTitle}>Override: {gate.requirementName}</Text>
      <Text style={styles.emptyBody}>
        A human override requires an authorized role, a reason and supporting evidence — every field
        is recorded to the audit trail.
      </Text>

      <View style={styles.resultToggle}>
        <Button
          variant={result === 'pass' ? 'verify' : 'secondary'}
          onPress={() => setResult('pass')}
        >
          Pass
        </Button>
        <Button
          variant={result === 'fail' ? 'destructive' : 'secondary'}
          onPress={() => setResult('fail')}
        >
          Fail
        </Button>
      </View>

      <FormField label="Reason (required)">
        <Input
          value={reason}
          onChangeText={setReason}
          multiline
          placeholder="Why override the deterministic result?"
        />
      </FormField>
      <FormField label="Supporting evidence (required)">
        <Input
          value={evidenceNote}
          onChangeText={setEvidenceNote}
          multiline
          placeholder="What evidence supports this override?"
        />
      </FormField>

      {error && <Text style={styles.errorText}>{error}</Text>}

      <Button
        variant="primary"
        onPress={submit}
        loading={submitting}
        disabled={!valid || submitting}
      >
        Record override
      </Button>
    </View>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm8 },
  scrollContent: {
    paddingVertical: spacing.lg16,
    gap: spacing.md12,
    paddingBottom: spacing.xl24 * 2,
  },
  name: { ...typeScale.headlineLg, color: colors.tertiary },
  emptyTitle: { ...typeScale.headlineMd, color: colors.tertiary, textAlign: 'center' },
  emptyBody: { ...typeScale.bodySm, color: colors.textMuted, textAlign: 'center' },
  jobPicker: { flexGrow: 0 },
  jobChip: {
    paddingHorizontal: spacing.md12,
    paddingVertical: spacing.sm8,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: colors.outlinePerimeter,
    marginRight: spacing.sm8,
  },
  jobChipActive: { backgroundColor: colors.secondary, borderColor: colors.secondary },
  jobChipLabel: { ...typeScale.bodySm, color: colors.tertiary },
  jobChipLabelActive: { color: colors.white },
  summaryCard: { gap: spacing.md12 },
  badgeRow: { flexDirection: 'row', gap: spacing.sm8, flexWrap: 'wrap' },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg16 },
  metric: { minWidth: '40%' },
  metricLabel: { ...typeScale.labelMd, color: colors.textMuted },
  metricValue: { ...typeScale.headlineMd, color: colors.tertiary },
  suppressedNote: { ...typeScale.bodySm, color: colors.warningText },
  sectionTitle: { ...typeScale.headlineSm, color: colors.tertiary, marginTop: spacing.sm8 },
  gatesCard: { padding: 0 },
  gateRow: { padding: spacing.lg16, gap: spacing.sm8 },
  gateRowDivider: { borderTopWidth: 1, borderTopColor: colors.outlineCell },
  gateHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm8,
  },
  gateName: { ...typeScale.bodyMd, color: colors.tertiary, flex: 1 },
  gateNote: { ...typeScale.bodySm, color: colors.textMuted, flex: 1 },
  aiRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm8 },
  riskNote: { ...typeScale.bodySm, color: colors.warningText },
  sheetForm: { gap: spacing.md12 },
  sheetTitle: { ...typeScale.headlineMd, color: colors.tertiary },
  resultToggle: { flexDirection: 'row', gap: spacing.sm8 },
  errorText: { ...typeScale.bodySm, color: colors.errorText },
})
