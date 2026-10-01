import { ScrollView, StyleSheet, Text, View } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { Card, QueryStateView, ScreenContainer, StatusChip } from '@/components/ui'
import { colors, spacing, typeScale } from '@/theme/tokens'
import type { ShortlistsStackParamList } from '@/navigation/types'
import { useActiveOrganization } from '@/lib/data/useActiveOrganization'
import { useQueryState } from '@/lib/data/useQueryState'

type Props = NativeStackScreenProps<ShortlistsStackParamList, 'PocComparison'>

/**
 * Same correlation-vs-causation guardrail apps/web/lib/poc/compare-
 * benchmark.ts's CAUSATION_DISCLAIMER enforces there (that module is
 * server-only and can't be imported into the RN bundle, so the copy is
 * reproduced verbatim here — any wording change to the source constant
 * must be mirrored here too).
 */
const CAUSATION_DISCLAIMER =
  'This comparison shows two processes run under agreed, shared conditions (same JD, same start time, same search boundaries) — it shows correlation between the process used and the outcome observed, not a proven cause. Treat it as evidence to inform the go/no-go decision, not as a guaranteed prediction of future results.'

interface MetricRow {
  metricDefinitionId: string
  metricName: string
  roleLabel: string
  vendorStatus: string
  vendorValue: number | null
  vendorUnit: string | null
  clientStatus: string
  clientValue: number | null
}

interface PocDetail {
  benchmarkId: string
  benchmarkName: string
  clientName: string
  metrics: MetricRow[]
}

function formatValue(status: string, value: number | null, unit: string | null): string {
  if (status !== 'computed' || value === null) return status.replace(/_/g, ' ')
  if (unit === 'percent') return `${value}%`
  if (unit === 'hours') return `${value}h`
  return `${value}`
}

export function PocComparisonScreen({ route }: Props) {
  const { pocId } = route.params ?? {}
  const { organization } = useActiveOrganization()
  const organizationId = organization?.organizationId ?? null

  const query = useQueryState<PocDetail | null>(
    async (supabase) => {
      if (!organizationId) throw new Error('Resolving your organization…')

      let benchmarkQuery = supabase
        .from('poc_benchmarks')
        .select('id, name, clients(name)')
        .eq('organization_id', organizationId)
      if (pocId) benchmarkQuery = benchmarkQuery.eq('id', pocId)
      const { data: benchmarks, error: benchmarkError } = await benchmarkQuery
        .order('updated_at', { ascending: false })
        .limit(1)
      if (benchmarkError) throw new Error(benchmarkError.message)
      const benchmark = benchmarks?.[0] as Record<string, unknown> | undefined
      if (!benchmark) return null

      const { data: results, error: resultsError } = await supabase
        .from('poc_results')
        .select(
          'metric_definition_id, side, status, value, value_unit, poc_roles(label, role_type), metric_definitions(name)',
        )
        .eq('poc_benchmark_id', benchmark.id as string)
        .eq('organization_id', organizationId)
      if (resultsError) throw new Error(resultsError.message)

      const byKey = new Map<
        string,
        {
          metricName: string
          roleLabel: string
          vendor?: Record<string, unknown>
          client?: Record<string, unknown>
        }
      >()
      for (const row of results ?? []) {
        const role = row.poc_roles as { label?: string | null; role_type?: string } | null
        const roleLabel =
          role?.label ??
          (role?.role_type === 'senior_or_difficult' ? 'Senior / difficult role' : 'Standard role')
        const metricName = (row.metric_definitions as { name?: string } | null)?.name ?? 'Metric'
        const key = `${row.metric_definition_id}:${roleLabel}`
        const entry = byKey.get(key) ?? { metricName, roleLabel }
        if (row.side === 'vendor') entry.vendor = row as Record<string, unknown>
        else entry.client = row as Record<string, unknown>
        byKey.set(key, entry)
      }

      const metrics: MetricRow[] = Array.from(byKey.entries()).map(([key, entry]) => ({
        metricDefinitionId: key,
        metricName: entry.metricName,
        roleLabel: entry.roleLabel,
        vendorStatus: (entry.vendor?.status as string) ?? 'pending',
        vendorValue: (entry.vendor?.value as number | null) ?? null,
        vendorUnit: (entry.vendor?.value_unit as string | null) ?? null,
        clientStatus: (entry.client?.status as string) ?? 'pending',
        clientValue: (entry.client?.value as number | null) ?? null,
      }))

      return {
        benchmarkId: benchmark.id as string,
        benchmarkName: benchmark.name as string,
        clientName: (benchmark.clients as { name?: string } | null)?.name ?? 'Client',
        metrics,
      }
    },
    [organizationId, pocId],
    { isEmpty: (data) => data === null },
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
                  ? 'Could not load this comparison'
                  : 'No POC benchmark yet'
          }
          description={
            query.status === 'offline'
              ? 'Try again when you have a connection.'
              : query.status === 'not_configured'
                ? 'This environment has no live Supabase project configured.'
                : query.status === 'error'
                  ? (query.error ?? undefined)
                  : 'No proof-of-concept benchmark has been recorded yet.'
          }
          onRetry={query.refresh}
        />
      </ScreenContainer>
    )
  }

  const detail = query.data!

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>{detail.benchmarkName}</Text>
        <Text style={styles.subtitle}>
          {detail.clientName} · vendor-assisted vs. client baseline
        </Text>

        <Card style={styles.disclaimerCard}>
          <StatusChip status="warning" label="Correlation, not causation" />
          <Text style={styles.disclaimer}>{CAUSATION_DISCLAIMER}</Text>
        </Card>

        {detail.metrics.map((m) => (
          <Card key={m.metricDefinitionId} style={styles.card}>
            <Text style={styles.metricName}>{m.metricName}</Text>
            <Text style={styles.roleLabel}>{m.roleLabel}</Text>
            <View style={styles.compareRow}>
              <View style={styles.compareCol}>
                <Text style={styles.compareLabel}>Vendor-assisted</Text>
                <Text style={styles.compareValue}>
                  {formatValue(m.vendorStatus, m.vendorValue, m.vendorUnit)}
                </Text>
              </View>
              <View style={styles.compareCol}>
                <Text style={styles.compareLabel}>Client baseline</Text>
                <Text style={styles.compareValue}>
                  {formatValue(m.clientStatus, m.clientValue, m.vendorUnit)}
                </Text>
              </View>
            </View>
          </Card>
        ))}
      </ScrollView>
    </ScreenContainer>
  )
}

const styles = StyleSheet.create({
  content: { paddingVertical: spacing.lg16, gap: spacing.md12 },
  title: { ...typeScale.headlineLg, color: colors.tertiary },
  subtitle: { ...typeScale.bodySm, color: colors.textMuted },
  disclaimerCard: {
    gap: spacing.sm8,
    backgroundColor: colors.warningBg,
    borderColor: colors.warningBorder,
  },
  disclaimer: { ...typeScale.bodySm, color: colors.warningText },
  card: { gap: spacing.xs4 },
  metricName: { ...typeScale.bodyMd, fontFamily: 'Geist_600SemiBold', color: colors.tertiary },
  roleLabel: { ...typeScale.labelMd, color: colors.textMuted, marginBottom: spacing.sm8 },
  compareRow: { flexDirection: 'row', gap: spacing.lg16 },
  compareCol: { flex: 1 },
  compareLabel: { ...typeScale.labelMd, color: colors.textMuted },
  compareValue: { ...typeScale.headlineSm, color: colors.tertiary },
})
