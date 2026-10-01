import 'server-only'
import { z } from 'zod'
import { assertResourceOwnership } from '../resource-ownership'
import {
  CAUSATION_DISCLAIMER,
  describeComparisonCaveat,
  METRIC_REGISTRY,
  orderMetricsForDisplay,
  type MetricKey,
} from '@/lib/poc/compare-benchmark'
import {
  type CopilotToolContext,
  type CopilotToolHandlerResult,
  CopilotToolInputError,
} from './shared'

/**
 * Build Phase 11, Wave 2 — explain_poc_metrics.
 *
 * Reads ALREADY-COMPUTED `poc_results` rows (written by wave 3's
 * poc-actions.ts recordPocResultsAction, not recomputed here — this tool
 * has no candidate/outreach/matching data-loading of its own to do, unlike
 * the other tools, because the comparison arithmetic already ran and was
 * persisted by the existing POC workflow). `CAUSATION_DISCLAIMER` /
 * `describeComparisonCaveat` are re-used VERBATIM from
 * apps/web/lib/poc/compare-benchmark.ts per the task brief — this tool's
 * output always carries the disclaimer text alongside any metric
 * comparison, so wave 3's response-construction code cannot narrate a POC
 * comparison without it.
 */

export const ExplainPocMetricsInputSchema = z.object({
  pocBenchmarkId: z.string().uuid(),
  /** Optional: narrow to one role (standard / senior_or_difficult). Omitted = every role on the benchmark. */
  pocRoleId: z.string().uuid().nullable().optional(),
})
export type ExplainPocMetricsInput = z.infer<typeof ExplainPocMetricsInputSchema>

const MetricResultSchema = z.object({
  metricKey: z.string(),
  displayName: z.string(),
  unit: z.string(),
  vendor: z.object({ status: z.string(), value: z.number().nullable() }),
  client: z.object({ status: z.string(), value: z.number().nullable() }),
  delta: z.number().nullable(),
  caveat: z.string(),
})

const RoleMetricsSchema = z.object({
  pocRoleId: z.string(),
  roleType: z.string(),
  metrics: z.array(MetricResultSchema),
})

export const ExplainPocMetricsOutputSchema = z.object({
  pocBenchmarkId: z.string(),
  benchmarkStatus: z.string(),
  roles: z.array(RoleMetricsSchema),
  causationDisclaimer: z.string(),
})
export type ExplainPocMetricsOutput = z.infer<typeof ExplainPocMetricsOutputSchema>

export async function explainPocMetrics(
  ctx: CopilotToolContext,
  input: ExplainPocMetricsInput,
): Promise<CopilotToolHandlerResult<ExplainPocMetricsOutput>> {
  const { supabase, organizationId, userId, role } = ctx

  const ownership = await assertResourceOwnership(supabase, {
    organizationId,
    userId,
    role,
    resourceType: 'poc_benchmark',
    resourceId: input.pocBenchmarkId,
  })

  const { data: benchmark } = await supabase
    .from('poc_benchmarks')
    .select('id, status')
    .eq('id', input.pocBenchmarkId)
    .eq('organization_id', organizationId)
    .maybeSingle()
  if (!benchmark) throw new CopilotToolInputError(`poc benchmark ${input.pocBenchmarkId} not found`)

  let rolesQuery = supabase
    .from('poc_roles')
    .select('id, role_type')
    .eq('poc_benchmark_id', input.pocBenchmarkId)
  if (input.pocRoleId) rolesQuery = rolesQuery.eq('id', input.pocRoleId)
  const { data: pocRoles } = await rolesQuery

  const roleRows = pocRoles ?? []
  if (roleRows.length === 0) {
    return {
      output: {
        pocBenchmarkId: benchmark.id,
        benchmarkStatus: benchmark.status,
        roles: [],
        causationDisclaimer: CAUSATION_DISCLAIMER,
      },
      citations: [],
      ownership: [ownership],
    }
  }

  const roleIds = roleRows.map((r) => r.id as string)
  const { data: resultRows } = await supabase
    .from('poc_results')
    .select('id, poc_role_id, metric_definition_id, side, status, value')
    .in('poc_role_id', roleIds)

  const { data: metricDefs } = await supabase
    .from('metric_definitions')
    .select('id, metric_key')
    .in('id', [...new Set((resultRows ?? []).map((r) => r.metric_definition_id as string))])
  const metricKeyByDefId = new Map(
    (metricDefs ?? []).map((d) => [d.id as string, d.metric_key as string]),
  )

  const citations: { kind: 'poc_result'; id: string; excerpt: string | null }[] = []

  const roles = roleRows.map((roleRow) => {
    const roleResults = (resultRows ?? []).filter((r) => r.poc_role_id === roleRow.id)

    const byMetricKey = new Map<
      string,
      { vendor?: (typeof roleResults)[number]; client?: (typeof roleResults)[number] }
    >()
    for (const r of roleResults) {
      const key = metricKeyByDefId.get(r.metric_definition_id as string)
      if (!key) continue
      const bucket = byMetricKey.get(key) ?? {}
      if (r.side === 'vendor') bucket.vendor = r
      else bucket.client = r
      byMetricKey.set(key, bucket)
      citations.push({
        kind: 'poc_result',
        id: r.id as string,
        excerpt: `${key} (${r.side}): ${r.status}${r.value !== null ? ` = ${r.value}` : ''}`,
      })
    }

    const metricKeys = orderMetricsForDisplay([...byMetricKey.keys()] as MetricKey[])

    const metrics = metricKeys.map((metricKey) => {
      const def = METRIC_REGISTRY[metricKey]
      const bucket = byMetricKey.get(metricKey) ?? {}
      const vendor = {
        status: bucket.vendor?.status ?? 'pending',
        value: (bucket.vendor?.value as number | null) ?? null,
      }
      const client = {
        status: bucket.client?.status ?? 'pending',
        value: (bucket.client?.value as number | null) ?? null,
      }
      const delta =
        vendor.status === 'computed' && client.status === 'computed'
          ? Math.round((vendor.value! - client.value!) * 1000) / 1000
          : null

      return {
        metricKey,
        displayName: def.displayName,
        unit: def.unit,
        vendor,
        client,
        delta,
        caveat: describeComparisonCaveat(def.displayName),
      }
    })

    return { pocRoleId: roleRow.id as string, roleType: roleRow.role_type as string, metrics }
  })

  return {
    output: {
      pocBenchmarkId: benchmark.id,
      benchmarkStatus: benchmark.status,
      roles,
      causationDisclaimer: CAUSATION_DISCLAIMER,
    },
    citations,
    ownership: [ownership],
  }
}
