import type { PocBaseline, PocMetricDataPoint, PocResultSide } from '@rqi/types'
import { DATA_POINT_KEYS } from './data-point-keys'
import { resolveLatestBaseline, resolveLatestDataPoint } from './resolve-inputs'
import type { MetricCalculationResult } from './types'

/**
 * Speed-family calculators (docs/14-poc-specification.md §14.10, migration
 * calculation_notes for time_to_first_qualified_candidate /
 * time_to_completed_shortlist / recruiter_hours). No DB/network I/O — every
 * input is a plain value or array the caller has already loaded.
 */

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round((value + Number.EPSILON) * factor) / factor
}

/** Wall-clock hours between two ISO timestamps, never negative (a negative gap means the caller passed inconsistent data — treated as 0, not a fabricated negative "speed"). */
function hoursBetween(startIso: string, endIso: string): number {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime()
  return Math.max(0, round(ms / (1000 * 60 * 60), 2))
}

/**
 * Time to First Qualified Candidate (speed, hours, both sides).
 *
 * - client: taken verbatim from the resolved (latest, correction-chain-
 *   aware) poc_baselines row's `timeToFirstQualifiedHours`, self-reported
 *   by the client — never computed or estimated by this side.
 * - vendor: either a directly-observed timestamp (the caller supplies the
 *   moment a candidate first became mandatory-gate-eligible, e.g. read off
 *   an audit_events row, together with that row's id for `inputsUsed`) or,
 *   failing that, the latest poc_metrics data point recorded under
 *   DATA_POINT_KEYS.TIME_TO_FIRST_QUALIFIED_HOURS (a manual/platform entry
 *   logged by wave 3's recording code). No candidate_role_matches column
 *   tracks "became eligible at" directly, so one of these two explicit
 *   inputs is required — this function never infers it from createdAt/
 *   updatedAt, which are match-record timestamps, not gate-outcome
 *   timestamps, and would silently misrepresent the metric.
 *
 * Returns 'pending' whenever the side-appropriate input has not been
 * recorded yet, and 'pending' (not a fabricated 0) when benchmarkStartTime
 * itself is unset — §14.5 requires a shared start time before this metric
 * is even meaningful.
 */
export function calculateTimeToFirstQualifiedCandidate(params: {
  side: PocResultSide
  benchmarkStartTime: string | null
  baselines: PocBaseline[]
  vendorObservedAt?: { timestamp: string; sourceRowId: string } | null
  dataPoints: PocMetricDataPoint[]
}): MetricCalculationResult {
  const { side, benchmarkStartTime, baselines, vendorObservedAt, dataPoints } = params

  if (side === 'client') {
    const baseline = resolveLatestBaseline(baselines)
    if (!baseline || baseline.timeToFirstQualifiedHours === null) {
      return {
        status: 'pending',
        reason:
          'No client baseline has reported time-to-first-qualified-candidate for this role yet.',
      }
    }
    return {
      status: 'computed',
      value: baseline.timeToFirstQualifiedHours,
      unit: 'hours',
      inputsUsed: [baseline.id],
      excludedCount: 0,
    }
  }

  if (!benchmarkStartTime) {
    return {
      status: 'pending',
      reason:
        'This benchmark has no shared start_time set yet (docs/14-poc-specification.md §14.5 requires one before speed metrics are meaningful).',
    }
  }

  if (vendorObservedAt) {
    return {
      status: 'computed',
      value: hoursBetween(benchmarkStartTime, vendorObservedAt.timestamp),
      unit: 'hours',
      inputsUsed: [vendorObservedAt.sourceRowId],
      excludedCount: 0,
    }
  }

  const dataPoint = resolveLatestDataPoint(
    dataPoints,
    DATA_POINT_KEYS.TIME_TO_FIRST_QUALIFIED_HOURS,
  )
  if (!dataPoint || dataPoint.valueNumeric === null) {
    return {
      status: 'pending',
      reason:
        'No vendor-side time-to-first-qualified-candidate observation has been recorded for this role yet.',
    }
  }
  return {
    status: 'computed',
    value: dataPoint.valueNumeric,
    unit: 'hours',
    inputsUsed: [dataPoint.id],
    excludedCount: 0,
  }
}

/**
 * Time to Completed Shortlist (speed, hours, both sides).
 *
 * - client: `poc_baselines.timeToShortlistHours`, self-reported.
 * - vendor: either a directly-observed shortlist-ready timestamp (e.g. the
 *   linked ShortlistVersion's `submittedAt`, passed by the caller together
 *   with that version's id) or the latest poc_metrics data point under
 *   DATA_POINT_KEYS.TIME_TO_COMPLETED_SHORTLIST_HOURS.
 */
export function calculateTimeToCompletedShortlist(params: {
  side: PocResultSide
  benchmarkStartTime: string | null
  baselines: PocBaseline[]
  vendorShortlistReadyAt?: { timestamp: string; sourceRowId: string } | null
  dataPoints: PocMetricDataPoint[]
}): MetricCalculationResult {
  const { side, benchmarkStartTime, baselines, vendorShortlistReadyAt, dataPoints } = params

  if (side === 'client') {
    const baseline = resolveLatestBaseline(baselines)
    if (!baseline || baseline.timeToShortlistHours === null) {
      return {
        status: 'pending',
        reason: 'No client baseline has reported time-to-completed-shortlist for this role yet.',
      }
    }
    return {
      status: 'computed',
      value: baseline.timeToShortlistHours,
      unit: 'hours',
      inputsUsed: [baseline.id],
      excludedCount: 0,
    }
  }

  if (!benchmarkStartTime) {
    return {
      status: 'pending',
      reason:
        'This benchmark has no shared start_time set yet (docs/14-poc-specification.md §14.5).',
    }
  }

  if (vendorShortlistReadyAt) {
    return {
      status: 'computed',
      value: hoursBetween(benchmarkStartTime, vendorShortlistReadyAt.timestamp),
      unit: 'hours',
      inputsUsed: [vendorShortlistReadyAt.sourceRowId],
      excludedCount: 0,
    }
  }

  const dataPoint = resolveLatestDataPoint(
    dataPoints,
    DATA_POINT_KEYS.TIME_TO_COMPLETED_SHORTLIST_HOURS,
  )
  if (!dataPoint || dataPoint.valueNumeric === null) {
    return {
      status: 'pending',
      reason:
        'The vendor-side shortlist for this role has not reached a submitted/ready state yet.',
    }
  }
  return {
    status: 'computed',
    value: dataPoint.valueNumeric,
    unit: 'hours',
    inputsUsed: [dataPoint.id],
    excludedCount: 0,
  }
}

/**
 * Recruiter Hours (effort, hours, both sides).
 *
 * - client: `poc_baselines.recruiterHoursSpent`, self-reported.
 * - vendor: sum of every `manual_recruiter_entry` poc_metrics row under
 *   DATA_POINT_KEYS.RECRUITER_HOURS for this participant — no automatic
 *   time-tracking exists yet, so this is always a manually logged total,
 *   never inferred from activity volume or elapsed calendar time (that
 *   would conflate effort with speed, two deliberately separate metrics
 *   per docs/14-poc-specification.md §14.9/§14.10).
 *
 * Supersession is resolved per entry: a manual log is typically made of
 * several additive rows (one per session), not a single corrected total,
 * so this function sums every LIVE (non-superseded) row rather than
 * picking "the latest one" the way the other calculators do — each row is
 * additive time, not a replaceable running total. A row is only dropped
 * from the sum when another row's `supersedesMetricId` points at it
 * (i.e. it was logged in error and corrected).
 */
export function calculateRecruiterHours(params: {
  side: PocResultSide
  baselines: PocBaseline[]
  dataPoints: PocMetricDataPoint[]
}): MetricCalculationResult {
  const { side, baselines, dataPoints } = params

  if (side === 'client') {
    const baseline = resolveLatestBaseline(baselines)
    if (!baseline || baseline.recruiterHoursSpent === null) {
      return {
        status: 'pending',
        reason: 'No client baseline has reported recruiter hours for this role yet.',
      }
    }
    return {
      status: 'computed',
      value: baseline.recruiterHoursSpent,
      unit: 'hours',
      inputsUsed: [baseline.id],
      excludedCount: 0,
    }
  }

  const entries = dataPoints.filter((row) => row.dataPointKey === DATA_POINT_KEYS.RECRUITER_HOURS)
  const supersededIds = new Set(
    entries.map((row) => row.supersedesMetricId).filter((id): id is string => id !== null),
  )
  const liveEntries = entries.filter(
    (row) => !supersededIds.has(row.id) && row.valueNumeric !== null,
  )

  if (liveEntries.length === 0) {
    return {
      status: 'pending',
      reason:
        'No manual recruiter-hours log entries have been recorded for the vendor side of this role yet.',
    }
  }

  const total = round(
    liveEntries.reduce((sum, row) => sum + (row.valueNumeric as number), 0),
    2,
  )

  return {
    status: 'computed',
    value: total,
    unit: 'hours',
    inputsUsed: liveEntries.map((row) => row.id),
    excludedCount: 0,
  }
}
