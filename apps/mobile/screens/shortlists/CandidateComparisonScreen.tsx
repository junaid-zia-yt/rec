import { ScrollView, StyleSheet, Text, View } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { Card, QueryStateView, ScreenContainer, StatusChip } from '@/components/ui'
import type { StatusColorKey } from '@/theme/tokens'
import { colors, spacing, typeScale } from '@/theme/tokens'
import type { ShortlistsStackParamList } from '@/navigation/types'
import { useActiveOrganization } from '@/lib/data/useActiveOrganization'
import { useQueryState } from '@/lib/data/useQueryState'
import { hasPermission } from '@rqi/types'

type Props = NativeStackScreenProps<ShortlistsStackParamList, 'CandidateComparison'>

interface ComparisonCandidate {
  candidateId: string
  candidateName: string
  eligibility: 'eligible' | 'ineligible' | 'pending_verification'
  overallScore: number | null
  evidenceCoveragePct: number
  dataCompletenessPct: number
  gatesPassed: number
  gatesTotal: number
  recruiterNote: string | null
}

const ELIGIBILITY_STATUS: Record<ComparisonCandidate['eligibility'], StatusColorKey> = {
  eligible: 'passed',
  ineligible: 'failed',
  pending_verification: 'pending',
}

function pct(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)}%`
}

/**
 * Side-by-side finalist comparison (docs/03-screen-inventory.md §3.3's
 * Verification Matrix — the one fully-specified screen: candidate name,
 * rank/score, gates passed/total, evidence %, strengths/risks). Read-only
 * this wave (no mutation route exists for "select/deselect finalist" or
 * "continue to shortlist" yet) — mobile stacks candidates vertically per
 * §3.3's own mobile note, rather than a desktop split-pane.
 */
export function CandidateComparisonScreen({ route }: Props) {
  const { candidateIds } = route.params
  const { organization } = useActiveOrganization()
  const organizationId = organization?.organizationId ?? null
  // docs/privacy-review.md §5 — recruiter_note (shortlist_candidates) is
  // internal-only and RLS cannot redact it at the column level; this
  // screen must apply the same canManageInternally-style gate the web
  // shortlist detail page and FinalShortlistScreen already do, rather than
  // fetching/rendering it for every role that can reach this screen.
  const includeInternalNotes = organization
    ? hasPermission(organization.role, 'shortlists', 'update')
    : false

  const query = useQueryState<ComparisonCandidate[]>(
    async (supabase) => {
      if (!organizationId) throw new Error('Resolving your organization…')
      if (candidateIds.length === 0) return []

      const { data: matches, error } = await supabase
        .from('candidate_role_matches')
        .select(
          'id, candidate_id, eligibility, overall_score, evidence_coverage_pct, data_completeness_pct, candidates(full_name)',
        )
        .in('candidate_id', candidateIds)
        .eq('organization_id', organizationId)
        .order('updated_at', { ascending: false })
      if (error) throw new Error(error.message)

      const latestByCandidate = new Map<string, Record<string, unknown>>()
      for (const m of matches ?? []) {
        const key = m.candidate_id as string
        if (!latestByCandidate.has(key)) latestByCandidate.set(key, m as Record<string, unknown>)
      }

      const picked = candidateIds
        .map((id) => latestByCandidate.get(id))
        .filter((m): m is Record<string, unknown> => Boolean(m))
      const matchIds = picked.map((m) => m.id as string)

      const [{ data: gates, error: gateError }, { data: notes }] = await Promise.all([
        matchIds.length > 0
          ? supabase
              .from('mandatory_gate_results')
              .select('candidate_role_match_id, state, override_result')
              .in('candidate_role_match_id', matchIds)
          : Promise.resolve({ data: [], error: null }),
        includeInternalNotes
          ? supabase
              .from('shortlist_candidates')
              .select('candidate_id, recruiter_note')
              .in('candidate_id', candidateIds)
              .order('added_at', { ascending: false })
          : Promise.resolve({ data: [], error: null }),
      ])
      if (gateError) throw new Error(gateError.message)

      const gateCounts = new Map<string, { passed: number; total: number }>()
      for (const g of gates ?? []) {
        const key = g.candidate_role_match_id as string
        const entry = gateCounts.get(key) ?? { passed: 0, total: 0 }
        entry.total += 1
        const effective =
          g.state === 'human_override'
            ? g.override_result
            : g.state === 'passed'
              ? 'pass'
              : g.state === 'failed'
                ? 'fail'
                : 'unknown'
        if (effective === 'pass') entry.passed += 1
        gateCounts.set(key, entry)
      }

      const noteByCandidate = new Map<string, string>()
      for (const n of notes ?? []) {
        const key = n.candidate_id as string
        if (!noteByCandidate.has(key) && n.recruiter_note)
          noteByCandidate.set(key, n.recruiter_note as string)
      }

      return picked.map((m) => {
        const counts = gateCounts.get(m.id as string) ?? { passed: 0, total: 0 }
        return {
          candidateId: m.candidate_id as string,
          candidateName: (m.candidates as { full_name?: string } | null)?.full_name ?? 'Candidate',
          eligibility: m.eligibility as ComparisonCandidate['eligibility'],
          overallScore: m.overall_score as number | null,
          evidenceCoveragePct: m.evidence_coverage_pct as number,
          dataCompletenessPct: m.data_completeness_pct as number,
          gatesPassed: counts.passed,
          gatesTotal: counts.total,
          recruiterNote: noteByCandidate.get(m.candidate_id as string) ?? null,
        }
      })
    },
    [organizationId, candidateIds.join(','), includeInternalNotes],
  )

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
                  ? 'Could not load these candidates'
                  : 'Nothing to compare'
          }
          description={
            query.status === 'offline'
              ? 'Try again when you have a connection.'
              : query.status === 'not_configured'
                ? 'This environment has no live Supabase project configured.'
                : query.status === 'error'
                  ? (query.error ?? undefined)
                  : 'No finalists were passed to this comparison.'
          }
          onRetry={query.refresh}
        />
      </ScreenContainer>
    )
  }

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {query.data!.map((c) => (
          <Card key={c.candidateId} style={styles.card}>
            <View style={styles.headerRow}>
              <Text style={styles.name}>{c.candidateName}</Text>
              <StatusChip
                status={ELIGIBILITY_STATUS[c.eligibility]}
                label={c.eligibility.replace(/_/g, ' ')}
              />
            </View>
            <View style={styles.metricGrid}>
              <Metric
                label="Match score"
                value={c.eligibility === 'eligible' ? pct(c.overallScore) : '—'}
              />
              <Metric label="Gates passed" value={`${c.gatesPassed}/${c.gatesTotal}`} />
              <Metric label="Evidence" value={pct(c.evidenceCoveragePct)} />
              <Metric label="Completeness" value={pct(c.dataCompletenessPct)} />
            </View>
            {c.recruiterNote && <Text style={styles.note}>{c.recruiterNote}</Text>}
          </Card>
        ))}
      </ScrollView>
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
  content: { paddingVertical: spacing.lg16, gap: spacing.md12 },
  card: { gap: spacing.sm8 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { ...typeScale.headlineSm, color: colors.tertiary },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg16 },
  metric: { minWidth: '40%' },
  metricLabel: { ...typeScale.labelMd, color: colors.textMuted },
  metricValue: { ...typeScale.headlineSm, color: colors.tertiary },
  note: { ...typeScale.bodySm, color: colors.textMuted },
})
