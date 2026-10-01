import type { PocBaseline, PocExclusion, PocMetricDataPoint } from '@rqi/types'

/**
 * poc_baselines, poc_metrics and poc_exclusions are all append-only at the
 * DB layer (supabase/migrations/0030_poc_benchmarks.sql — no update/delete
 * grant on any of them): a correction is always a NEW row referencing the
 * one it corrects/supersedes/reverses, never an in-place edit. Every
 * calculator in this package must therefore resolve "the current value" by
 * walking that chain itself before doing arithmetic — these three helpers
 * are the single, shared place that logic lives, so no calculator
 * re-derives (and potentially gets wrong) its own version of "latest".
 *
 * All three helpers are pure and take the FULL set of rows for a given
 * scope (one poc_participant_id for baselines/metrics, one poc_role_id for
 * exclusions) — callers do not need to pre-filter by correction chain
 * themselves.
 */

/**
 * Resolves the current, authoritative poc_baselines row for one
 * participant: any row that is itself referenced by another row's
 * `correctionOfBaselineId` has been superseded and is excluded; among the
 * remaining ("live") rows, the most recently created one wins (there
 * should normally be exactly one live row per participant, but recruiters
 * could in principle log more than one independent baseline entry before a
 * correction chain forms — most-recent-by-createdAt is the deterministic
 * tie-break).
 *
 * Returns null when no baseline has been recorded at all — callers must
 * treat this as "not yet reported" (`pending`), never as zero.
 */
export function resolveLatestBaseline(baselines: PocBaseline[]): PocBaseline | null {
  if (baselines.length === 0) return null

  const supersededIds = new Set(
    baselines.map((row) => row.correctionOfBaselineId).filter((id): id is string => id !== null),
  )
  const live = baselines.filter((row) => !supersededIds.has(row.id))
  const pool = live.length > 0 ? live : baselines

  return [...pool].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )[0]!
}

/**
 * Resolves the current, authoritative poc_metrics row for one participant +
 * `dataPointKey` (e.g. 'recruiter_hours', 'critical_errors_count' — see
 * metric-definitions.ts's DATA_POINT_KEYS for the convention this package
 * expects wave 3 to record under). Same supersession logic as
 * resolveLatestBaseline, keyed off `supersedesMetricId` instead.
 *
 * Returns null when no data point with that key has been recorded.
 */
export function resolveLatestDataPoint(
  dataPoints: PocMetricDataPoint[],
  dataPointKey: string,
): PocMetricDataPoint | null {
  const matching = dataPoints.filter((row) => row.dataPointKey === dataPointKey)
  if (matching.length === 0) return null

  const supersededIds = new Set(
    matching.map((row) => row.supersedesMetricId).filter((id): id is string => id !== null),
  )
  const live = matching.filter((row) => !supersededIds.has(row.id))
  const pool = live.length > 0 ? live : matching

  return [...pool].sort(
    (a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime(),
  )[0]!
}

/**
 * Resolves every LIVE (i.e. not-yet-reversed) poc_exclusions row for a
 * role. A row with `reversesExclusionId` set is treated purely as a
 * cancellation marker for the row it points at — it is not itself counted
 * as an active exclusion of a candidate (judgment call, documented here:
 * the schema requires a reversal row to carry the same mandatory fields as
 * any exclusion — candidate identity, side, reason — as a way of recording
 * *why* the original exclusion was undone, not because the reversal itself
 * newly excludes anyone).
 */
export function resolveActiveExclusions(exclusions: PocExclusion[]): PocExclusion[] {
  const reversedIds = new Set(
    exclusions.map((row) => row.reversesExclusionId).filter((id): id is string => id !== null),
  )
  return exclusions.filter((row) => !reversedIds.has(row.id) && row.reversesExclusionId === null)
}

/**
 * Splits a role's active exclusions into the candidate ids/labels they
 * cover, keyed by whether that exclusion still counts toward the side's
 * SPEED metrics (docs/14-poc-specification.md §14.6: a duplicate still
 * counts toward speed even while excluded from the quality-differentiation
 * comparison). A candidate is identified by `candidateId` when known,
 * falling back to `candidateReferenceLabel` (client-side candidates
 * frequently have no platform row at all).
 */
export function partitionExclusionsBySpeedCounting(exclusions: PocExclusion[]): {
  excludedFromQualityOnly: PocExclusion[]
  excludedFromEverything: PocExclusion[]
} {
  const active = resolveActiveExclusions(exclusions)
  return {
    // still_counts_toward_speed = true: keep in speed/time totals, drop from quality-count totals.
    excludedFromQualityOnly: active.filter((row) => row.stillCountsTowardSpeed),
    // still_counts_toward_speed = false: drop from every count, speed or quality.
    excludedFromEverything: active.filter((row) => !row.stillCountsTowardSpeed),
  }
}

/** Identity key for matching a poc_exclusions row against a live candidate row — candidateId when present, else the free-text label. */
export function exclusionCandidateKey(
  exclusion: Pick<PocExclusion, 'candidateId' | 'candidateReferenceLabel'>,
): string {
  return exclusion.candidateId ?? `label:${exclusion.candidateReferenceLabel ?? ''}`
}
