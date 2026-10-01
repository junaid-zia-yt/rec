import type { MetricDefinitionCategory, MetricUnit } from '@rqi/types'

/**
 * TypeScript mirror of the `metric_definitions` DB catalog seeded by
 * supabase/migrations/0030_poc_benchmarks.sql (version 1, all 15 rows).
 * This is the brief's "define calculation logic centrally... version
 * metric definitions" requirement, read by wave 3's report UI to render
 * metric names/units/framing without re-deriving them, and by
 * compare-benchmark.ts to know which calculator function to run for each
 * metric key.
 *
 * VERSIONING DISCIPLINE (read before ever touching this file after this
 * wave): `version` here MUST always equal the `version` of the
 * corresponding seeded `metric_definitions` row a poc_results row was
 * computed against. The DB row is immutable once referenced by any
 * poc_results row (enforce_metric_definition_immutability trigger) — a
 * revision to a metric's *calculation logic* (not its display copy) is
 * NEVER a mutation of the calculator function in place while `version`
 * here stays 1. Instead:
 *   1. Write a NEW calculator function (or a clearly version-suffixed
 *      variant) implementing the revised logic.
 *   2. Add a new migration inserting a new `metric_definitions` row with
 *      the SAME `metric_key`, `version: 2` (never editing/deleting the
 *      version-1 row).
 *   3. Bump this registry entry's `version` to 2 and point `calculator` at
 *      the new function.
 *   4. Existing `poc_results` rows computed under version 1 remain valid
 *      and interpretable — they keep citing version 1's (now-frozen)
 *      definition and calculation.
 * Skipping this discipline (e.g. silently changing a calculator's formula
 * while leaving `version: 1` here) breaks the auditability guarantee the
 * whole metric_definitions/poc_results versioning design exists for.
 */

export const METRIC_KEYS = [
  'time_to_first_qualified_candidate',
  'time_to_completed_shortlist',
  'candidates_discovered',
  'candidates_reviewed',
  'mandatory_gate_pass_rate',
  'candidates_scoring_90_or_higher',
  'evidence_coverage',
  'shortlist_acceptance_rate',
  'candidate_response_rate',
  'candidate_interest_rate',
  'interview_progression',
  'offer_progression',
  'recruiter_hours',
  'critical_errors',
  'unsupported_claims',
] as const

export type MetricKey = (typeof METRIC_KEYS)[number]

export interface MetricRegistryEntry {
  metricKey: MetricKey
  /** Must match the `version` of the currently-active seeded metric_definitions row for this metricKey — see this file's module comment. */
  version: number
  displayName: string
  unit: MetricUnit
  category: MetricDefinitionCategory
  /**
   * Framing for the report UI: whether a larger number is the better
   * outcome for the vendor. `null` for metrics where "better" is not a
   * simple direction (offer_progression currently, since it can never be
   * computed at all — see calculate-progression-metrics.ts).
   */
  higherIsBetter: boolean | null
  /** Which module + exported function computes this metric. Documentation only (functions differ in shape across families, so this is not a callable pointer) — see compare-benchmark.ts for the actual dispatch. */
  calculator: { module: string; functionName: string }
}

export const METRIC_REGISTRY: Readonly<Record<MetricKey, MetricRegistryEntry>> = {
  time_to_first_qualified_candidate: {
    metricKey: 'time_to_first_qualified_candidate',
    version: 1,
    displayName: 'Time to First Qualified Candidate',
    unit: 'hours',
    category: 'speed',
    higherIsBetter: false,
    calculator: {
      module: 'calculate-speed-metrics',
      functionName: 'calculateTimeToFirstQualifiedCandidate',
    },
  },
  time_to_completed_shortlist: {
    metricKey: 'time_to_completed_shortlist',
    version: 1,
    displayName: 'Time to Completed Shortlist',
    unit: 'hours',
    category: 'speed',
    higherIsBetter: false,
    calculator: {
      module: 'calculate-speed-metrics',
      functionName: 'calculateTimeToCompletedShortlist',
    },
  },
  candidates_discovered: {
    metricKey: 'candidates_discovered',
    version: 1,
    displayName: 'Candidates Discovered',
    unit: 'count',
    category: 'progression',
    // Neither direction is intrinsically "better" for a raw discovery
    // count on its own (breadth vs. focus is a strategy choice, not a
    // quality signal by itself) — UI framing should pair this with
    // quality metrics rather than treat a bigger number as a win.
    higherIsBetter: null,
    calculator: {
      module: 'calculate-progression-metrics',
      functionName: 'calculateCandidatesDiscovered',
    },
  },
  candidates_reviewed: {
    metricKey: 'candidates_reviewed',
    version: 1,
    displayName: 'Candidates Reviewed',
    unit: 'count',
    category: 'progression',
    higherIsBetter: null,
    calculator: {
      module: 'calculate-progression-metrics',
      functionName: 'calculateCandidatesReviewed',
    },
  },
  mandatory_gate_pass_rate: {
    metricKey: 'mandatory_gate_pass_rate',
    version: 1,
    displayName: 'Mandatory-Gate Pass Rate',
    unit: 'percent',
    category: 'quality',
    higherIsBetter: true,
    calculator: {
      module: 'calculate-quality-metrics',
      functionName: 'calculateMandatoryGatePassRate',
    },
  },
  candidates_scoring_90_or_higher: {
    metricKey: 'candidates_scoring_90_or_higher',
    version: 1,
    displayName: 'Candidates Scoring 90% or Higher',
    unit: 'count',
    category: 'quality',
    higherIsBetter: true,
    calculator: {
      module: 'calculate-quality-metrics',
      functionName: 'calculateCandidatesScoring90OrHigher',
    },
  },
  evidence_coverage: {
    metricKey: 'evidence_coverage',
    version: 1,
    displayName: 'Evidence Coverage',
    unit: 'percent',
    category: 'evidence',
    higherIsBetter: true,
    calculator: { module: 'calculate-quality-metrics', functionName: 'calculateEvidenceCoverage' },
  },
  shortlist_acceptance_rate: {
    metricKey: 'shortlist_acceptance_rate',
    version: 1,
    displayName: 'Shortlist Acceptance Rate',
    unit: 'percent',
    category: 'human_acceptance',
    higherIsBetter: true,
    calculator: {
      module: 'calculate-engagement-metrics',
      functionName: 'calculateShortlistAcceptanceRate',
    },
  },
  candidate_response_rate: {
    metricKey: 'candidate_response_rate',
    version: 1,
    displayName: 'Candidate Response Rate',
    unit: 'percent',
    category: 'candidate_response',
    higherIsBetter: true,
    calculator: {
      module: 'calculate-engagement-metrics',
      functionName: 'calculateCandidateResponseRate',
    },
  },
  candidate_interest_rate: {
    metricKey: 'candidate_interest_rate',
    version: 1,
    displayName: 'Candidate Interest Rate',
    unit: 'percent',
    category: 'candidate_response',
    higherIsBetter: true,
    calculator: {
      module: 'calculate-engagement-metrics',
      functionName: 'calculateCandidateInterestRate',
    },
  },
  interview_progression: {
    metricKey: 'interview_progression',
    version: 1,
    displayName: 'Interview Progression',
    unit: 'percent',
    category: 'progression',
    higherIsBetter: true,
    calculator: {
      module: 'calculate-progression-metrics',
      functionName: 'calculateInterviewProgression',
    },
  },
  offer_progression: {
    metricKey: 'offer_progression',
    version: 1,
    displayName: 'Offer Progression (where available)',
    unit: 'percent',
    category: 'progression',
    // Always not_available as of this wave — see
    // calculate-progression-metrics.ts's calculateOfferProgression for why
    // a "better direction" is moot while no data source exists at all.
    higherIsBetter: null,
    calculator: {
      module: 'calculate-progression-metrics',
      functionName: 'calculateOfferProgression',
    },
  },
  recruiter_hours: {
    metricKey: 'recruiter_hours',
    version: 1,
    displayName: 'Recruiter Hours',
    unit: 'hours',
    category: 'effort',
    higherIsBetter: false,
    calculator: { module: 'calculate-speed-metrics', functionName: 'calculateRecruiterHours' },
  },
  critical_errors: {
    metricKey: 'critical_errors',
    version: 1,
    displayName: 'Critical Errors',
    unit: 'count',
    category: 'errors',
    higherIsBetter: false,
    calculator: { module: 'calculate-quality-metrics', functionName: 'calculateCriticalErrors' },
  },
  unsupported_claims: {
    metricKey: 'unsupported_claims',
    version: 1,
    displayName: 'Unsupported Claims',
    unit: 'count',
    category: 'evidence',
    higherIsBetter: false,
    calculator: { module: 'calculate-quality-metrics', functionName: 'calculateUnsupportedClaims' },
  },
}

/**
 * The three metrics the brief singles out as "candidate-quality primary"
 * (mandatory_gate_pass_rate, candidates_scoring_90_or_higher,
 * evidence_coverage) — used by orderMetricsForDisplay in
 * compare-benchmark.ts, exported separately here since it is itself a
 * piece of the central, versioned metric catalog, not a UI-layer opinion.
 */
export const CANDIDATE_QUALITY_PRIMARY_METRIC_KEYS: ReadonlySet<MetricKey> = new Set([
  'mandatory_gate_pass_rate',
  'candidates_scoring_90_or_higher',
  'evidence_coverage',
])
