'use client'

import { Card, CardBody, SectionHeader, StatusBadge } from '@rqi/ui'
import {
  CAUSATION_DISCLAIMER,
  METRIC_REGISTRY,
  orderMetricsForDisplay,
  type MetricComparisonResult,
  type MetricKey,
} from '@/lib/poc/compare-benchmark'
import type { PocResultStatus } from '@rqi/types'

const STATUS_BADGE: Record<PocResultStatus, 'passed' | 'pending' | 'failed' | 'neutral'> = {
  computed: 'passed',
  pending: 'pending',
  not_available: 'neutral',
  not_measured: 'neutral',
}

const STATUS_LABEL: Record<PocResultStatus, string> = {
  computed: 'Computed',
  pending: 'Pending',
  not_available: 'Not available',
  not_measured: 'Not measured',
}

function formatValue(value: number, unit: string): string {
  if (unit === 'percent') return `${value}%`
  if (unit === 'hours') return `${value} hrs`
  return String(value)
}

function ResultCell({ result, unit }: { result: MetricComparisonResult['vendor']; unit: string }) {
  if (result.status === 'computed') {
    return (
      <div className="flex flex-col">
        <span className="font-display text-tertiary text-sm font-bold">
          {formatValue(result.value, unit)}
        </span>
        {result.excludedCount > 0 && (
          <span className="text-muted text-[11px]">{result.excludedCount} excluded</span>
        )}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-0.5" title={result.reason}>
      <StatusBadge status={STATUS_BADGE[result.status]}>{STATUS_LABEL[result.status]}</StatusBadge>
    </div>
  )
}

/** One role's metric-by-metric comparison table, in orderMetricsForDisplay's quality-primary-first order. `categoryFilter`, when given, narrows this to a subset (the Quality/Speed/Evidence drill-down screens reuse this same component). */
function ComparisonTable({
  metrics,
  categoryFilter,
  caption,
}: {
  metrics: MetricComparisonResult[]
  categoryFilter?: (key: MetricKey) => boolean
  /** [A11Y FIX] Programmatic table name so screen-reader users navigating by
   * table (this screen has four back-to-back tables — §4.18's flagged
   * "highest-risk screen for a11y") hear which comparison they're in,
   * not just "table". */
  caption: string
}) {
  const orderedKeys = orderMetricsForDisplay(metrics.map((m) => m.metricKey)).filter(
    (k) => !categoryFilter || categoryFilter(k),
  )
  const byKey = new Map(metrics.map((m) => [m.metricKey, m]))

  if (orderedKeys.length === 0) {
    return <p className="text-muted text-sm">No metrics in this category yet.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-outline-cell border-b text-xs">
            <th scope="col" className="text-muted px-2 py-2 font-semibold">
              Metric
            </th>
            <th scope="col" className="text-muted px-2 py-2 font-semibold">
              Vendor (this platform)
            </th>
            <th scope="col" className="text-muted px-2 py-2 font-semibold">
              Client baseline
            </th>
            <th scope="col" className="text-muted px-2 py-2 font-semibold">
              Difference
            </th>
          </tr>
        </thead>
        <tbody>
          {orderedKeys.map((key) => {
            const comparison = byKey.get(key)
            if (!comparison) return null
            const entry = METRIC_REGISTRY[key]
            return (
              <tr key={key} className="border-outline-cell border-b last:border-0">
                <td className="px-2 py-2">
                  <p className="text-tertiary text-sm font-medium">{entry.displayName}</p>
                  {entry.higherIsBetter !== null && (
                    <p className="text-muted text-[11px]">
                      {entry.higherIsBetter ? 'Higher is better' : 'Lower is better'}
                    </p>
                  )}
                </td>
                <td className="px-2 py-2">
                  <ResultCell result={comparison.vendor} unit={entry.unit} />
                </td>
                <td className="px-2 py-2">
                  <ResultCell result={comparison.client} unit={entry.unit} />
                </td>
                <td className="px-2 py-2">
                  {comparison.delta === null ? (
                    <span className="text-muted text-xs">—</span>
                  ) : (
                    <span
                      className={
                        comparison.delta === 0
                          ? 'text-muted text-sm'
                          : 'text-tertiary text-sm font-semibold'
                      }
                    >
                      {comparison.delta > 0 ? '+' : ''}
                      {formatValue(comparison.delta, entry.unit)}
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const QUALITY_CATEGORY_KEYS: MetricKey[] = [
  'mandatory_gate_pass_rate',
  'candidates_scoring_90_or_higher',
  'evidence_coverage',
]
const SPEED_CATEGORY_KEYS: MetricKey[] = [
  'time_to_first_qualified_candidate',
  'time_to_completed_shortlist',
  'recruiter_hours',
]
const EVIDENCE_CATEGORY_KEYS: MetricKey[] = ['evidence_coverage', 'unsupported_claims']

export interface PocRoleComparisonSection {
  roleId: string
  roleType: 'standard' | 'senior_or_difficult'
  roleLabel: string
  jobTitle: string
  metrics: MetricComparisonResult[]
}

/**
 * Comparison Report — Task C's main results screen, plus the Quality
 * result / Speed result / Evidence-quality result drill-downs (each is
 * this same table, category-filtered, so the three "drill-down" screens
 * the brief lists are sections of this one component rather than separate
 * routes — consistent with how the existing shortlist Verification Matrix
 * groups related views on one page). The mobile executive summary is the
 * `summary` block below, shown above the full tables at every viewport
 * (condensed by nature — 4 numbers — so no separate mobile-only route is
 * needed, matching how the rest of the app handles mobile via responsive
 * Tailwind classes rather than a parallel page). print:-prefixed classes
 * make this section export/print-ready (File > Print / Save as PDF) — no
 * PDF-generation library is wired up in this wave (none was already a
 * project dependency), so this is the "export-ready" interpretation used
 * here; a real PDF export is future work.
 */
export function PocComparisonReport({ sections }: { sections: PocRoleComparisonSection[] }) {
  return (
    <div className="flex flex-col gap-6 print:gap-4">
      <div className="flex items-center justify-between gap-2 print:hidden">
        <SectionHeader title="Comparison report" />
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-control border-outline-perimeter text-tertiary hover:bg-canvas border px-3 py-1.5 text-xs font-medium"
        >
          Print / export report
        </button>
      </div>

      <div className="rounded-card border-warning-border bg-warning-bg text-warning border p-3 text-xs">
        {CAUSATION_DISCLAIMER}
      </div>

      {sections.map((section) => {
        const primaryMetrics = section.metrics.filter((m) =>
          QUALITY_CATEGORY_KEYS.includes(m.metricKey),
        )
        return (
          <Card key={section.roleId} id={`role-${section.roleId}`}>
            <CardBody className="flex flex-col gap-4">
              <div>
                <p className="text-tertiary text-sm font-semibold">
                  {section.roleType === 'standard' ? 'Standard role' : 'Senior / difficult role'} —{' '}
                  {section.roleLabel}
                </p>
                <p className="text-muted text-xs">{section.jobTitle}</p>
              </div>

              {/* Mobile executive summary: the three candidate-quality-primary metrics, condensed. Visible at every width per the app's existing responsive convention. */}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {primaryMetrics.map((m) => {
                  const entry = METRIC_REGISTRY[m.metricKey]
                  return (
                    <div
                      key={m.metricKey}
                      className="rounded-control border-outline-perimeter border p-3"
                    >
                      <p className="text-muted text-[11px] font-semibold uppercase tracking-wide">
                        {entry.displayName}
                      </p>
                      <div className="mt-1 flex items-center justify-between">
                        <ResultCell result={m.vendor} unit={entry.unit} />
                        <span className="text-muted text-[10px]">vs</span>
                        <ResultCell result={m.client} unit={entry.unit} />
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="flex flex-col gap-2">
                <p className="text-tertiary text-xs font-semibold uppercase tracking-wide">
                  Quality result
                </p>
                <ComparisonTable
                  metrics={section.metrics}
                  categoryFilter={(k) => QUALITY_CATEGORY_KEYS.includes(k)}
                  caption={`Quality result comparison for ${section.roleLabel}`}
                />
              </div>
              <div className="flex flex-col gap-2">
                <p className="text-tertiary text-xs font-semibold uppercase tracking-wide">
                  Speed result
                </p>
                <ComparisonTable
                  metrics={section.metrics}
                  categoryFilter={(k) => SPEED_CATEGORY_KEYS.includes(k)}
                  caption={`Speed result comparison for ${section.roleLabel}`}
                />
              </div>
              <div className="flex flex-col gap-2">
                <p className="text-tertiary text-xs font-semibold uppercase tracking-wide">
                  Evidence-quality result
                </p>
                <ComparisonTable
                  metrics={section.metrics}
                  categoryFilter={(k) => EVIDENCE_CATEGORY_KEYS.includes(k)}
                  caption={`Evidence-quality result comparison for ${section.roleLabel}`}
                />
              </div>
              <div className="flex flex-col gap-2">
                <p className="text-tertiary text-xs font-semibold uppercase tracking-wide">
                  Full comparison
                </p>
                <ComparisonTable
                  metrics={section.metrics}
                  caption={`Full metric comparison for ${section.roleLabel}`}
                />
              </div>
            </CardBody>
          </Card>
        )
      })}
    </div>
  )
}
