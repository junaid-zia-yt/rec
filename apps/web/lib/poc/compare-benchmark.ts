import type {
  CandidateProjectEntry,
  CandidateResponse,
  CandidateRoleMatch,
  ClientDecisionRecord,
  OutreachMessage,
  PocBaseline,
  PocBenchmark,
  PocExclusion,
  PocMetricDataPoint,
  PocRole,
  ShortlistCandidate,
} from '@rqi/types'
import {
  calculateCandidateInterestRate,
  calculateCandidateResponseRate,
  calculateShortlistAcceptanceRate,
} from './calculate-engagement-metrics'
import {
  calculateCandidatesDiscovered,
  calculateCandidatesReviewed,
  calculateInterviewProgression,
  calculateOfferProgression,
} from './calculate-progression-metrics'
import {
  calculateCriticalErrors,
  calculateEvidenceCoverage,
  calculateMandatoryGatePassRate,
  calculateCandidatesScoring90OrHigher,
  calculateUnsupportedClaims,
} from './calculate-quality-metrics'
import {
  calculateRecruiterHours,
  calculateTimeToCompletedShortlist,
  calculateTimeToFirstQualifiedCandidate,
} from './calculate-speed-metrics'
import {
  CANDIDATE_QUALITY_PRIMARY_METRIC_KEYS,
  METRIC_KEYS,
  METRIC_REGISTRY,
  type MetricKey,
} from './metric-definitions'
import type { MetricCalculationResult } from './types'

/**
 * Orchestrates the full 15-metric x 2-side comparison for one poc_role
 * (this module handles one role at a time; a caller comparing both
 * benchmark roles calls compareRoleBenchmark once per role). No DB/network
 * I/O — every row this needs is loaded and passed in by the caller (wave
 * 3's server actions).
 *
 * This is what wave 3's persistence layer turns into poc_results rows
 * (one per role/metric/side) — this module does not write anything itself,
 * it only computes the values plus a derived (never persisted) delta.
 */

/** Everything about one poc_role this module needs to run every metric for both sides. Data-loading (which rows to fetch and how to scope them to this role) is entirely wave 3's responsibility — every field here is a plain, already-loaded array or object. */
export interface RoleBenchmarkData {
  role: Pick<PocRole, 'id' | 'roleType'>
  /** poc_baselines rows for this role's client_baseline participant (any correction chain state — resolveLatestBaseline is applied internally by the calculators that need it). */
  clientBaselines: PocBaseline[]
  /** poc_metrics rows already scoped to the VENDOR participant for this role. */
  vendorDataPoints: PocMetricDataPoint[]
  /** poc_metrics rows already scoped to the CLIENT participant for this role (manually-logged client-reported figures — see data-point-keys.ts). */
  clientDataPoints: PocMetricDataPoint[]
  /** poc_exclusions rows for this role (both sides; each calculator filters by `side` itself). */
  exclusions: PocExclusion[]
  /** Vendor-side candidate_role_matches for this role's job. */
  candidateRoleMatches: CandidateRoleMatch[]
  /** Vendor-side candidate_project_entries for this role's recruitment project. */
  candidateProjectEntries: CandidateProjectEntry[]
  /** Vendor-side shortlist_candidates for this role's linked shortlist (via poc_participants.shortlistId). */
  shortlistCandidates: ShortlistCandidate[]
  /** client_decisions against that same vendor-side shortlist. */
  vendorClientDecisions: ClientDecisionRecord[]
  /** outreach_messages for candidates on this role's vendor-side pipeline. */
  vendorOutreachMessages: OutreachMessage[]
  /** candidate_responses for the same. */
  vendorCandidateResponses: CandidateResponse[]
  /** Optional directly-observed vendor timestamps, when the caller has them (preferred over the poc_metrics manual-entry fallback — see calculate-speed-metrics.ts). */
  vendorFirstQualifiedObservedAt?: { timestamp: string; sourceRowId: string } | null
  vendorShortlistReadyObservedAt?: { timestamp: string; sourceRowId: string } | null
}

/** One metric's full computed comparison for a role: both sides' results plus a derived (not persisted) delta. */
export interface MetricComparisonResult {
  metricKey: MetricKey
  vendor: MetricCalculationResult
  client: MetricCalculationResult
  /**
   * Computed here for DISPLAY ONLY — NOT stored anywhere. supabase/
   * migrations/0030's poc_results table has no persisted delta variant of
   * `side` (only 'vendor' | 'client') by deliberate design (see that
   * migration's own header note); a wave-3 persistence layer must never
   * write this value into a poc_results row. `null` whenever either side
   * is not `status: 'computed'` — a delta against a Pending/Not Available/
   * Not Measured side would itself be a fabricated number, which is
   * exactly what this whole package exists to prevent.
   */
  delta: number | null
}

export interface RoleComparisonResult {
  roleId: string
  metrics: MetricComparisonResult[]
}

function computeDelta(
  vendor: MetricCalculationResult,
  client: MetricCalculationResult,
): number | null {
  if (vendor.status !== 'computed' || client.status !== 'computed') return null
  return Math.round((vendor.value - client.value) * 1000) / 1000
}

/** Dispatches to the correct calculator for one metric key + side, using the role's already-loaded data. This is the single place that maps METRIC_KEYS to the individual calculate-*.ts functions — see metric-definitions.ts's `calculator` field for the documentation-only mirror of this mapping. */
function runCalculator(
  metricKey: MetricKey,
  side: 'vendor' | 'client',
  data: RoleBenchmarkData,
  benchmarkStartTime: string | null,
): MetricCalculationResult {
  switch (metricKey) {
    case 'time_to_first_qualified_candidate':
      return calculateTimeToFirstQualifiedCandidate({
        side,
        benchmarkStartTime,
        baselines: data.clientBaselines,
        vendorObservedAt: data.vendorFirstQualifiedObservedAt ?? null,
        dataPoints: side === 'vendor' ? data.vendorDataPoints : data.clientDataPoints,
      })
    case 'time_to_completed_shortlist':
      return calculateTimeToCompletedShortlist({
        side,
        benchmarkStartTime,
        baselines: data.clientBaselines,
        vendorShortlistReadyAt: data.vendorShortlistReadyObservedAt ?? null,
        dataPoints: side === 'vendor' ? data.vendorDataPoints : data.clientDataPoints,
      })
    case 'recruiter_hours':
      return calculateRecruiterHours({
        side,
        baselines: data.clientBaselines,
        dataPoints: side === 'vendor' ? data.vendorDataPoints : data.clientDataPoints,
      })
    case 'candidates_discovered':
      return calculateCandidatesDiscovered({
        side,
        baselines: data.clientBaselines,
        candidateProjectEntries: data.candidateProjectEntries,
        exclusions: data.exclusions,
      })
    case 'candidates_reviewed':
      return calculateCandidatesReviewed({
        side,
        baselines: data.clientBaselines,
        candidateRoleMatches: data.candidateRoleMatches,
        exclusions: data.exclusions,
      })
    case 'interview_progression':
      return calculateInterviewProgression({
        side,
        dataPoints: side === 'vendor' ? data.vendorDataPoints : data.clientDataPoints,
      })
    case 'offer_progression':
      return calculateOfferProgression({ side })
    case 'mandatory_gate_pass_rate':
      return calculateMandatoryGatePassRate({
        side,
        candidateRoleMatches: data.candidateRoleMatches,
        exclusions: data.exclusions,
        clientReportedDataPoints: data.clientDataPoints,
      })
    case 'candidates_scoring_90_or_higher':
      return calculateCandidatesScoring90OrHigher({
        side,
        candidateRoleMatches: data.candidateRoleMatches,
        exclusions: data.exclusions,
        clientReportedDataPoints: data.clientDataPoints,
      })
    case 'evidence_coverage':
      return calculateEvidenceCoverage({
        side,
        candidateRoleMatches: data.candidateRoleMatches,
        shortlistCandidates: data.shortlistCandidates,
        exclusions: data.exclusions,
      })
    case 'critical_errors':
      return calculateCriticalErrors({
        side,
        dataPoints: side === 'vendor' ? data.vendorDataPoints : data.clientDataPoints,
      })
    case 'unsupported_claims':
      return calculateUnsupportedClaims({
        side,
        dataPoints: side === 'vendor' ? data.vendorDataPoints : data.clientDataPoints,
      })
    case 'shortlist_acceptance_rate':
      return calculateShortlistAcceptanceRate({
        side,
        vendorClientDecisions: data.vendorClientDecisions,
        clientReportedDataPoints: data.clientDataPoints,
      })
    case 'candidate_response_rate':
      return calculateCandidateResponseRate({
        side,
        vendorOutreachMessages: data.vendorOutreachMessages,
        vendorCandidateResponses: data.vendorCandidateResponses,
        clientReportedDataPoints: data.clientDataPoints,
      })
    case 'candidate_interest_rate':
      return calculateCandidateInterestRate({
        side,
        vendorCandidateResponses: data.vendorCandidateResponses,
        clientReportedDataPoints: data.clientDataPoints,
      })
    default: {
      const exhaustive: never = metricKey
      throw new Error(`compare-benchmark: no calculator wired for metric key ${String(exhaustive)}`)
    }
  }
}

/** Runs every one of the 15 registered metrics for both sides of one role. Pure — the caller persists the result (wave 3), this function only computes it. */
export function compareRoleBenchmark(params: {
  benchmark: Pick<PocBenchmark, 'startTime'>
  role: RoleBenchmarkData
}): RoleComparisonResult {
  const { benchmark, role } = params

  const metrics = METRIC_KEYS.map((metricKey): MetricComparisonResult => {
    const vendor = runCalculator(metricKey, 'vendor', role, benchmark.startTime)
    const client = runCalculator(metricKey, 'client', role, benchmark.startTime)
    return {
      metricKey,
      vendor,
      client,
      delta: computeDelta(vendor, client),
    }
  })

  return { roleId: role.role.id, metrics }
}

/** Runs compareRoleBenchmark across every role passed in — the whole-benchmark comparison (both the standard and senior_or_difficult poc_roles). */
export function compareBenchmark(params: {
  benchmark: Pick<PocBenchmark, 'startTime'>
  roles: RoleBenchmarkData[]
}): RoleComparisonResult[] {
  return params.roles.map((role) => compareRoleBenchmark({ benchmark: params.benchmark, role }))
}

// ---------------------------------------------------------------------------
// Correlation-vs-causation guardrail (brief §ANALYTICS RULES: "avoid
// presenting correlation as causation"). This is a presentation/UI-copy
// concern — nothing in this module or the DB schema can enforce it
// structurally (supabase/migrations/0030's own header note says as much).
// Flagged here, loudly, so wave 3's report UI does not silently drop it:
// EVERY screen that renders a MetricComparisonResult (in particular its
// `delta`) MUST surface CAUSATION_DISCLAIMER or the output of
// describeComparisonCaveat near that comparison, not just once somewhere
// else on the page.
// ---------------------------------------------------------------------------

export const CAUSATION_DISCLAIMER =
  'This comparison shows two processes run under agreed, shared conditions (same JD, same start time, same search boundaries) — it shows correlation between the process used and the outcome observed, not a proven cause. Treat it as evidence to inform the go/no-go decision, not as a guaranteed prediction of future results.'

/** Same guardrail as CAUSATION_DISCLAIMER, phrased to reference a specific metric — use this when a UI renders one metric's delta in isolation (e.g. a single stat tile) rather than a full comparison table, where the more generic constant reads more naturally once. */
export function describeComparisonCaveat(metricDisplayName: string): string {
  return `The difference shown for "${metricDisplayName}" reflects two processes run side by side under agreed conditions — it is not proof that one process caused the other's result, only that it was observed alongside it.`
}

// ---------------------------------------------------------------------------
// Candidate-quality-primary display ordering (brief: "keep candidate-
// quality results primary"). Pure display-ordering concern; wave 3's UI
// should use this instead of re-deriving its own priority order.
// ---------------------------------------------------------------------------

/**
 * Sorts a list of metric keys so the three candidate-quality metrics
 * (mandatory_gate_pass_rate, candidates_scoring_90_or_higher,
 * evidence_coverage — CANDIDATE_QUALITY_PRIMARY_METRIC_KEYS in
 * metric-definitions.ts) come first, in their METRIC_KEYS catalog order,
 * followed by every other metric present in the input, also in catalog
 * order. Unknown keys not in METRIC_KEYS are dropped (never silently
 * reordered to the front/back in some undefined way) — callers should
 * only ever pass keys already validated against the registry.
 */
export function orderMetricsForDisplay(metricKeys: MetricKey[]): MetricKey[] {
  const present = new Set(metricKeys)
  const inCatalogOrder = METRIC_KEYS.filter((key) => present.has(key))
  const primary = inCatalogOrder.filter((key) => CANDIDATE_QUALITY_PRIMARY_METRIC_KEYS.has(key))
  const rest = inCatalogOrder.filter((key) => !CANDIDATE_QUALITY_PRIMARY_METRIC_KEYS.has(key))
  return [...primary, ...rest]
}

// Re-exported for convenience so wave 3 can import the registry alongside
// this module's orchestration/comparison exports from one place.
export {
  METRIC_REGISTRY,
  METRIC_KEYS,
  CANDIDATE_QUALITY_PRIMARY_METRIC_KEYS,
} from './metric-definitions'
export type { MetricKey } from './metric-definitions'
