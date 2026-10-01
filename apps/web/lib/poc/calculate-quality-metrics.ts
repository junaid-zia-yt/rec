import type {
  CandidateRoleMatch,
  PocExclusion,
  PocMetricDataPoint,
  PocResultSide,
  ShortlistCandidate,
} from '@rqi/types'
import { DATA_POINT_KEYS } from './data-point-keys'
import { resolveActiveExclusions } from './resolve-inputs'
import type { MetricCalculationResult } from './types'

/**
 * Quality/evidence/errors-family calculators (docs/14-poc-specification.md
 * §14.9 "quality metrics", §14.15 "failure criteria"). No DB/network I/O.
 *
 * EXCLUSION RULE for every function in this file: these ARE the "quality-
 * differentiation comparison" §14.6 refers to, so ANY active exclusion for
 * a side (regardless of `stillCountsTowardSpeed`) removes that candidate
 * from the calculation — contrast with calculate-progression-metrics.ts's
 * candidates_discovered/candidates_reviewed, which keep
 * `stillCountsTowardSpeed: true` exclusions (see that file's module
 * comment for the full reasoning both files share).
 */

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round((value + Number.EPSILON) * factor) / factor
}

function activeExclusionsForSide(exclusions: PocExclusion[], side: PocResultSide): PocExclusion[] {
  return resolveActiveExclusions(exclusions).filter(
    (row) => row.side === side || row.side === 'both',
  )
}

function excludeMatches(
  matches: CandidateRoleMatch[],
  exclusions: PocExclusion[],
  side: PocResultSide,
) {
  const active = activeExclusionsForSide(exclusions, side)
  const excludedCandidateIds = new Set(
    active.map((row) => row.candidateId).filter((id): id is string => id !== null),
  )
  return {
    kept: matches.filter((match) => !excludedCandidateIds.has(match.candidateId)),
    excludedCount: active.length,
  }
}

/**
 * Mandatory-Gate Pass Rate (quality, percent, both sides).
 *
 * - vendor: share of REVIEWED candidateRoleMatches (`reviewStatus !==
 *   'pending'`, matching calculate-progression-metrics.ts's
 *   candidates_reviewed definition, so the two metrics' denominators stay
 *   consistent) whose `eligibility === 'eligible'` — i.e. passed every
 *   mandatory gate (docs/08-candidate-scoring.md §8.3's `gate_pass` rule,
 *   already computed deterministically upstream by
 *   apps/web/lib/matching/gates.ts).
 * - client: this is structurally vendor-only per the migration's own
 *   calculation_notes ("Client side reported as not_available unless the
 *   client tracks an equivalent pass/fail decision explicitly") — read
 *   from a manually-logged poc_metrics data point
 *   (DATA_POINT_KEYS.CLIENT_MANDATORY_GATE_PASS_RATE) when present, else
 *   `not_available` (no poc_baselines column exists for this — the
 *   client's own process is not expected to make an equivalent pass/fail
 *   decision explicit, so absence here is a structural fact, not a gap in
 *   data collection).
 */
export function calculateMandatoryGatePassRate(params: {
  side: PocResultSide
  candidateRoleMatches: CandidateRoleMatch[]
  exclusions: PocExclusion[]
  clientReportedDataPoints: PocMetricDataPoint[]
}): MetricCalculationResult {
  if (params.side === 'client') {
    const dataPoint = params.clientReportedDataPoints.find(
      (row) => row.dataPointKey === DATA_POINT_KEYS.CLIENT_MANDATORY_GATE_PASS_RATE,
    )
    if (!dataPoint || dataPoint.valueNumeric === null) {
      return {
        status: 'not_available',
        reason:
          "The client's manual process does not expose an equivalent mandatory-gate pass/fail decision by default.",
      }
    }
    return {
      status: 'computed',
      value: round(dataPoint.valueNumeric, 2),
      unit: 'percent',
      inputsUsed: [dataPoint.id],
      excludedCount: 0,
    }
  }

  const reviewed = params.candidateRoleMatches.filter((match) => match.reviewStatus !== 'pending')
  const { kept, excludedCount } = excludeMatches(reviewed, params.exclusions, 'vendor')

  if (kept.length === 0) {
    return {
      status: 'pending',
      reason: 'No vendor-side candidates for this role have completed human review yet.',
    }
  }

  const passed = kept.filter((match) => match.eligibility === 'eligible')
  return {
    status: 'computed',
    value: round((passed.length / kept.length) * 100, 2),
    unit: 'percent',
    inputsUsed: kept.map((match) => match.id),
    excludedCount,
  }
}

/**
 * Candidates Scoring 90% or Higher (quality, count, both sides) — the
 * POC's agreed ranking-consideration cutoff (docs/14-poc-specification.md
 * §14.14 point 3).
 *
 * - vendor: count of ELIGIBLE candidateRoleMatches with `overallScore >=
 *   90` (overallScore is guaranteed non-null whenever eligibility is
 *   'eligible' — enforced at the DB layer, see CandidateRoleMatchSchema's
 *   own comment).
 * - client: read-only from a manually-logged poc_metrics data point
 *   (DATA_POINT_KEYS.CLIENT_CANDIDATES_SCORING_90_OR_HIGHER); `not_available`
 *   when absent, since Dave's proprietary scoring methodology is not
 *   integrated with this platform (docs/14-poc-specification.md §14.9's
 *   "match-score correlation, not identical numbers" caveat).
 */
export function calculateCandidatesScoring90OrHigher(params: {
  side: PocResultSide
  candidateRoleMatches: CandidateRoleMatch[]
  exclusions: PocExclusion[]
  clientReportedDataPoints: PocMetricDataPoint[]
}): MetricCalculationResult {
  if (params.side === 'client') {
    const dataPoint = params.clientReportedDataPoints.find(
      (row) => row.dataPointKey === DATA_POINT_KEYS.CLIENT_CANDIDATES_SCORING_90_OR_HIGHER,
    )
    if (!dataPoint || dataPoint.valueNumeric === null) {
      return {
        status: 'not_available',
        reason:
          "Dave's own scoring methodology is not integrated with this platform and has not reported a comparable figure for this role.",
      }
    }
    return {
      status: 'computed',
      value: dataPoint.valueNumeric,
      unit: 'count',
      inputsUsed: [dataPoint.id],
      excludedCount: 0,
    }
  }

  const eligible = params.candidateRoleMatches.filter((match) => match.eligibility === 'eligible')
  const { kept, excludedCount } = excludeMatches(eligible, params.exclusions, 'vendor')

  if (params.candidateRoleMatches.length === 0) {
    return {
      status: 'pending',
      reason: 'No vendor-side candidates have been scored for this role yet.',
    }
  }

  const highScorers = kept.filter((match) => (match.overallScore ?? 0) >= 90)
  return {
    status: 'computed',
    value: highScorers.length,
    unit: 'count',
    inputsUsed: highScorers.map((match) => match.id),
    excludedCount,
  }
}

/**
 * Evidence Coverage (evidence, percent, both sides) — docs/14-poc-
 * specification.md §14.11/§14.14 point 10: "reported separately from the
 * overall match score — never blended into one number".
 *
 * - vendor: average of `evidenceCoveragePct` across this role's
 *   SHORTLISTED candidates specifically (the metric definition's own
 *   wording: "a shortlisted candidate's claims" — not every scored
 *   candidate), each already computed deterministically by
 *   apps/web/lib/matching/scoring.ts's `computeEvidenceCoveragePct`.
 * - client: ALWAYS `not_available` — deliberately not wired to any
 *   poc_metrics fallback, unlike the other client-side "quality" metrics
 *   in this file. This is a structural default per the migration's own
 *   calculation_notes ("the client's manual process is not expected to
 *   produce a structured evidence trail... never fabricated to make the
 *   comparison look symmetric") and per Core Principle #5 (missing
 *   candidate information must be marked unverified, never invented) — a
 *   client-reported "evidence coverage" number without this platform's
 *   citation infrastructure behind it would misrepresent what the figure
 *   means, so this function does not offer a manual-entry escape hatch the
 *   way mandatory_gate_pass_rate/candidates_scoring_90 do.
 */
export function calculateEvidenceCoverage(params: {
  side: PocResultSide
  candidateRoleMatches: CandidateRoleMatch[]
  shortlistCandidates: ShortlistCandidate[]
  exclusions: PocExclusion[]
}): MetricCalculationResult {
  if (params.side === 'client') {
    return {
      status: 'not_available',
      reason:
        "The client's manual process does not produce a structured, cited evidence trail — this figure is never fabricated to make the comparison look symmetric.",
    }
  }

  const matchById = new Map(params.candidateRoleMatches.map((match) => [match.id, match]))
  const shortlistedMatches = params.shortlistCandidates
    .map((sc) => matchById.get(sc.candidateRoleMatchId))
    .filter((match): match is CandidateRoleMatch => match !== undefined)

  const { kept, excludedCount } = excludeMatches(shortlistedMatches, params.exclusions, 'vendor')

  if (kept.length === 0) {
    return {
      status: 'pending',
      reason: 'No vendor-side candidates have been shortlisted for this role yet.',
    }
  }

  const average = kept.reduce((sum, match) => sum + match.evidenceCoveragePct, 0) / kept.length
  return {
    status: 'computed',
    value: round(average, 2),
    unit: 'percent',
    inputsUsed: kept.map((match) => match.id),
    excludedCount,
  }
}

/**
 * Critical Errors (errors, count, both sides) — docs/14-poc-specification.
 * md §14.15's failure criteria (e.g. "a shortlisted candidate with a
 * failed mandatory gate reaches Dave's review").
 *
 * Always human-logged, never an automatic AI judgment (brief §AI SAFETY
 * RULES). Sums every LIVE poc_metrics entry under
 * DATA_POINT_KEYS.CRITICAL_ERRORS_COUNT for this participant — additive,
 * like recruiter_hours, since each entry represents one incident logged as
 * it's found, not a single replaceable running total.
 *
 * Returns 'pending' (not a fabricated 0) when nothing has been logged —
 * absence of a logged error is not proof none occurred until a human has
 * actually reviewed for this.
 */
export function calculateCriticalErrors(params: {
  side: PocResultSide
  dataPoints: PocMetricDataPoint[]
}): MetricCalculationResult {
  const entries = params.dataPoints.filter(
    (row) => row.dataPointKey === DATA_POINT_KEYS.CRITICAL_ERRORS_COUNT,
  )
  const supersededIds = new Set(
    entries.map((row) => row.supersedesMetricId).filter((id): id is string => id !== null),
  )
  const live = entries.filter((row) => !supersededIds.has(row.id) && row.valueNumeric !== null)

  if (live.length === 0) {
    return {
      status: 'pending',
      reason: `No human reviewer has logged a critical-errors check for the ${params.side} side of this role yet.`,
    }
  }

  const total = live.reduce((sum, row) => sum + (row.valueNumeric as number), 0)
  return {
    status: 'computed',
    value: total,
    unit: 'count',
    inputsUsed: live.map((row) => row.id),
    excludedCount: 0,
  }
}

/**
 * Unsupported Claims (evidence, count, both sides) — docs/14-poc-
 * specification.md §14.15's failure criteria; core rule: "AI must never
 * invent candidate evidence". Structural target on the vendor side is
 * zero, but this function still requires a human reviewer's confirmation
 * (a logged poc_metrics entry under DATA_POINT_KEYS.UNSUPPORTED_CLAIMS_
 * COUNT) rather than assuming zero — an unreviewed pool is not the same as
 * a verified-clean one, and this module never fabricates that distinction
 * away. Same additive-sum/'pending'-when-absent shape as
 * calculateCriticalErrors above, for the same reasons.
 */
export function calculateUnsupportedClaims(params: {
  side: PocResultSide
  dataPoints: PocMetricDataPoint[]
}): MetricCalculationResult {
  const entries = params.dataPoints.filter(
    (row) => row.dataPointKey === DATA_POINT_KEYS.UNSUPPORTED_CLAIMS_COUNT,
  )
  const supersededIds = new Set(
    entries.map((row) => row.supersedesMetricId).filter((id): id is string => id !== null),
  )
  const live = entries.filter((row) => !supersededIds.has(row.id) && row.valueNumeric !== null)

  if (live.length === 0) {
    return {
      status: 'pending',
      reason: `No human reviewer has verified the ${params.side}-side shortlisted pool's evidence citations for unsupported claims yet.`,
    }
  }

  const total = live.reduce((sum, row) => sum + (row.valueNumeric as number), 0)
  return {
    status: 'computed',
    value: total,
    unit: 'count',
    inputsUsed: live.map((row) => row.id),
    excludedCount: 0,
  }
}
