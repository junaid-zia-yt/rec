import type {
  CandidateProjectEntry,
  CandidateRoleMatch,
  PocBaseline,
  PocExclusion,
  PocMetricDataPoint,
  PocResultSide,
} from '@rqi/types'
import { DATA_POINT_KEYS } from './data-point-keys'
import {
  resolveLatestBaseline,
  resolveLatestDataPoint,
  resolveActiveExclusions,
} from './resolve-inputs'
import type { MetricCalculationResult } from './types'

/**
 * Progression-family calculators (docs/14-poc-specification.md §14.13
 * "candidate-progression metrics... to show the funnel, not just the final
 * 2-3"). No DB/network I/O.
 *
 * JUDGMENT CALL on exclusions for this file specifically (documented once
 * here, applies to both functions below): candidates_discovered and
 * candidates_reviewed are FUNNEL/progression counts, not the "quality-
 * differentiation comparison" §14.6 describes (that comparison is the
 * scoring/gate/evidence/shortlist metrics in calculate-quality-metrics.ts
 * and calculate-engagement-metrics.ts). So here, an exclusion only removes
 * a candidate from these two counts when `stillCountsTowardSpeed` is
 * false (i.e. the exclusion reason itself says this candidate should never
 * have been counted at all, e.g. genuinely out of the agreed search
 * boundary) — a plain cross-side duplicate (`stillCountsTowardSpeed:
 * true`) still counts here, exactly as §14.6 says: "still counts toward
 * each side's speed metric (both found them)". The quality-differentiation
 * calculators in the other files apply the opposite rule: ANY active
 * exclusion removes the candidate, regardless of the flag, because those
 * metrics exist specifically to compare methodology quality and a
 * candidate both sides found cannot help distinguish that.
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

/**
 * Candidates Discovered (progression, count, both sides).
 *
 * - client: `poc_baselines.candidatesSourcedCount`, self-reported — the
 *   client's own count already reflects whatever they consider "found",
 *   so no further exclusion arithmetic is applied to it here (an
 *   exclusion recorded against the client side is informational context
 *   for the report, not a subtraction from a number the client themselves
 *   already reported holistically).
 * - vendor: count of distinct `candidateProjectEntries` for this role's
 *   recruitment project, minus any active exclusion for the vendor side
 *   whose `stillCountsTowardSpeed` is false (see this file's module
 *   comment for the full reasoning).
 */
export function calculateCandidatesDiscovered(params: {
  side: PocResultSide
  baselines: PocBaseline[]
  candidateProjectEntries: CandidateProjectEntry[]
  exclusions: PocExclusion[]
}): MetricCalculationResult {
  const { side, baselines, candidateProjectEntries, exclusions } = params

  if (side === 'client') {
    const baseline = resolveLatestBaseline(baselines)
    if (!baseline || baseline.candidatesSourcedCount === null) {
      return {
        status: 'pending',
        reason: 'No client baseline has reported candidates discovered for this role yet.',
      }
    }
    return {
      status: 'computed',
      value: baseline.candidatesSourcedCount,
      unit: 'count',
      inputsUsed: [baseline.id],
      excludedCount: 0,
    }
  }

  if (candidateProjectEntries.length === 0) {
    return {
      status: 'pending',
      reason: 'No candidates have been discovered for the vendor side of this role yet.',
    }
  }

  const dropExclusions = activeExclusionsForSide(exclusions, 'vendor').filter(
    (row) => !row.stillCountsTowardSpeed,
  )
  const droppedCandidateIds = new Set(
    dropExclusions.map((row) => row.candidateId).filter((id): id is string => id !== null),
  )
  const kept = candidateProjectEntries.filter(
    (entry) => !droppedCandidateIds.has(entry.candidateId),
  )

  return {
    status: 'computed',
    value: kept.length,
    unit: 'count',
    inputsUsed: kept.map((entry) => entry.id),
    excludedCount: dropExclusions.length,
  }
}

/**
 * Candidates Reviewed (progression, count, both sides).
 *
 * - client: `poc_baselines.candidatesReviewedCount`.
 * - vendor: count of `candidateRoleMatches` for this role whose
 *   `reviewStatus` is anything other than 'pending' (i.e. has received at
 *   least one human review decision — supabase/migrations/0027/0028's
 *   review workflow), minus the same `stillCountsTowardSpeed: false`
 *   exclusion rule as candidates_discovered.
 */
export function calculateCandidatesReviewed(params: {
  side: PocResultSide
  baselines: PocBaseline[]
  candidateRoleMatches: CandidateRoleMatch[]
  exclusions: PocExclusion[]
}): MetricCalculationResult {
  const { side, baselines, candidateRoleMatches, exclusions } = params

  if (side === 'client') {
    const baseline = resolveLatestBaseline(baselines)
    if (!baseline || baseline.candidatesReviewedCount === null) {
      return {
        status: 'pending',
        reason: 'No client baseline has reported candidates reviewed for this role yet.',
      }
    }
    return {
      status: 'computed',
      value: baseline.candidatesReviewedCount,
      unit: 'count',
      inputsUsed: [baseline.id],
      excludedCount: 0,
    }
  }

  const reviewed = candidateRoleMatches.filter((match) => match.reviewStatus !== 'pending')
  if (reviewed.length === 0) {
    return {
      status: 'pending',
      reason: 'No candidates have completed human review for the vendor side of this role yet.',
    }
  }

  const dropExclusions = activeExclusionsForSide(exclusions, 'vendor').filter(
    (row) => !row.stillCountsTowardSpeed,
  )
  const droppedCandidateIds = new Set(
    dropExclusions.map((row) => row.candidateId).filter((id): id is string => id !== null),
  )
  const kept = reviewed.filter((match) => !droppedCandidateIds.has(match.candidateId))

  return {
    status: 'computed',
    value: kept.length,
    unit: 'count',
    inputsUsed: kept.map((match) => match.id),
    excludedCount: dropExclusions.length,
  }
}

/**
 * Interview Progression (progression, percent, both sides) — docs/14-poc-
 * specification.md §14.13/§14.9's "post-hoc interview/offer conversion, if
 * the timeline allows a follow-up check". No `interviews` table exists
 * anywhere in the schema as of this wave (same structural gap class as
 * offer_progression below), but unlike offer_progression this metric is
 * explicitly expected to sometimes be trackable within a POC's timeline —
 * so, rather than hard-coding it to `not_available` like offer_progression,
 * this function reads a manually-recorded poc_metrics data point under
 * DATA_POINT_KEYS.INTERVIEW_PROGRESSION_PCT for either side (a recruiter
 * logs "X of Y shortlisted candidates reached an interview" once that
 * follow-up window closes). Absent that entry, it returns 'pending' — data
 * collection is expected, just not done yet — never 'not_available', since
 * a mechanism to record it does exist (manual entry).
 */
export function calculateInterviewProgression(params: {
  side: PocResultSide
  dataPoints: PocMetricDataPoint[]
}): MetricCalculationResult {
  const dataPoint = resolveLatestDataPoint(
    params.dataPoints,
    DATA_POINT_KEYS.INTERVIEW_PROGRESSION_PCT,
  )
  if (!dataPoint || dataPoint.valueNumeric === null) {
    return {
      status: 'pending',
      reason: `No interview-progression follow-up has been logged for the ${params.side} side of this role yet (no interviews table exists in the schema — this is recorded manually once the POC's follow-up window closes).`,
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

/**
 * Offer Progression (progression, percent, both sides) — docs/14-poc-
 * specification.md §14.9's "post-hoc interview/offer conversion". Build
 * Phase 10 Wave 1's schema report flagged that NO offer-stage table or
 * column exists ANYWHERE in the schema yet (no `offers` table, no offer
 * stage on candidate_project_entries' `currentStage` enum, no offer field
 * on candidate_role_matches) — there is currently no mechanism, manual or
 * automatic, to record an offer event at all.
 *
 * Per the wave 2 brief's explicit instruction, this function therefore
 * ALWAYS resolves to 'not_available', regardless of any input — never
 * 'not_measured' (which would imply someone should have tracked this and
 * chose not to) and never a computed value (which would require inventing
 * data that structurally cannot exist yet). This is intentionally the one
 * calculator in this package that ignores its side/whatever data a caller
 * might have loaded, by design — do not "fix" this by wiring it up to a
 * candidate_project_entries stage or similar unless a real offer-tracking
 * table is added in a future migration first.
 */
export function calculateOfferProgression(_params: {
  side: PocResultSide
}): MetricCalculationResult {
  return {
    status: 'not_available',
    reason:
      'No offer-stage data source exists anywhere in the schema yet (no offers table, no offer pipeline stage) — this metric cannot be computed until a future migration adds one.',
  }
}
