import type {
  CandidateResponse,
  ClientDecisionRecord,
  OutreachMessage,
  PocMetricDataPoint,
  PocResultSide,
} from '@rqi/types'
import { DATA_POINT_KEYS } from './data-point-keys'
import { resolveLatestDataPoint } from './resolve-inputs'
import type { MetricCalculationResult } from './types'

/**
 * Human-acceptance / candidate-response-family calculators (docs/14-poc-
 * specification.md §14.9). No DB/network I/O.
 *
 * These metrics are not part of the candidate-count "quality-
 * differentiation comparison" calculate-quality-metrics.ts covers, and
 * poc_exclusions (candidate-discovery duplicates) has no natural bearing on
 * a shortlist-decision or an outreach-response count, so none of the
 * functions here take an `exclusions` parameter — a candidate excluded as
 * a cross-side duplicate before ever reaching a shortlist or outreach
 * cannot also appear in these datasets.
 */

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round((value + Number.EPSILON) * factor) / factor
}

/** OutreachMessage statuses that represent an actual, delivered-or-better contact attempt — i.e. the candidate was reachably contacted, as opposed to still drafted/awaiting approval/cancelled/failed to send. */
const CONTACTED_STATUSES: ReadonlySet<OutreachMessage['status']> = new Set([
  'sent',
  'delivered',
  'responded',
])

/**
 * Shortlist Acceptance Rate (human_acceptance, percent, both sides).
 *
 * - vendor: share of this role's client_decisions (Build Phase 8,
 *   supabase/migrations/0028) recorded as `accept`, out of every decision
 *   recorded (accept + discuss + reject) — the same treatment
 *   `apps/web/lib/shortlists/` already gives shortlist decisions,
 *   deliberately not re-derived here.
 * - client: no `poc_baselines` column represents this distinctly, so this
 *   reads a manually-logged poc_metrics data point
 *   (DATA_POINT_KEYS.CLIENT_SHORTLIST_ACCEPTANCE_RATE); `not_measured`
 *   when absent — the migration's own calculation_notes call this out as
 *   "not_measured if the client does not track this distinctly" (as
 *   opposed to `not_available`, since the client's process could in
 *   principle report this, it just normally hasn't been asked to).
 */
export function calculateShortlistAcceptanceRate(params: {
  side: PocResultSide
  vendorClientDecisions: ClientDecisionRecord[]
  clientReportedDataPoints: PocMetricDataPoint[]
}): MetricCalculationResult {
  if (params.side === 'client') {
    const dataPoint = params.clientReportedDataPoints.find(
      (row) => row.dataPointKey === DATA_POINT_KEYS.CLIENT_SHORTLIST_ACCEPTANCE_RATE,
    )
    if (!dataPoint || dataPoint.valueNumeric === null) {
      return {
        status: 'not_measured',
        reason:
          'The client does not track shortlist acceptance as a distinct figure separate from their own hiring decision.',
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

  const decisions = params.vendorClientDecisions
  if (decisions.length === 0) {
    return {
      status: 'pending',
      reason:
        'The client has not recorded a decision on the vendor-side shortlist for this role yet.',
    }
  }

  const accepted = decisions.filter((decision) => decision.decision === 'accept')
  return {
    status: 'computed',
    value: round((accepted.length / decisions.length) * 100, 2),
    unit: 'percent',
    inputsUsed: decisions.map((decision) => decision.id),
    excludedCount: 0,
  }
}

/**
 * Candidate Response Rate (candidate_response, percent, both sides) —
 * share of CONTACTED candidates (message actually sent/delivered/responded
 * to, per CONTACTED_STATUSES above) who respond at all, regardless of
 * classification.
 *
 * - vendor: distinct candidates with at least one candidate_responses row,
 *   divided by distinct candidates with at least one contacted
 *   outreach_messages row (Build Phase 9, supabase/migrations/0029).
 * - client: manually-logged fallback (DATA_POINT_KEYS.CLIENT_CANDIDATE_
 *   RESPONSE_RATE); `not_available` when absent — outreach on the client's
 *   own channels is not observed by this platform at all.
 */
export function calculateCandidateResponseRate(params: {
  side: PocResultSide
  vendorOutreachMessages: OutreachMessage[]
  vendorCandidateResponses: CandidateResponse[]
  clientReportedDataPoints: PocMetricDataPoint[]
}): MetricCalculationResult {
  if (params.side === 'client') {
    const dataPoint = params.clientReportedDataPoints.find(
      (row) => row.dataPointKey === DATA_POINT_KEYS.CLIENT_CANDIDATE_RESPONSE_RATE,
    )
    if (!dataPoint || dataPoint.valueNumeric === null) {
      return {
        status: 'not_available',
        reason: "Outreach conducted on the client's own channels is not observed by this platform.",
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

  const contactedCandidateIds = new Set(
    params.vendorOutreachMessages
      .filter((msg) => CONTACTED_STATUSES.has(msg.status))
      .map((msg) => msg.candidateId),
  )
  if (contactedCandidateIds.size === 0) {
    return { status: 'pending', reason: 'No vendor-side outreach has been sent for this role yet.' }
  }

  const respondedCandidateIds = new Set(
    params.vendorCandidateResponses
      .filter((r) => contactedCandidateIds.has(r.candidateId))
      .map((r) => r.candidateId),
  )

  return {
    status: 'computed',
    value: round((respondedCandidateIds.size / contactedCandidateIds.size) * 100, 2),
    unit: 'percent',
    inputsUsed: [...contactedCandidateIds, ...respondedCandidateIds],
    excludedCount: 0,
  }
}

/**
 * Candidate Interest Rate (candidate_response, percent, both sides) —
 * share of RECEIVED responses (not contacted candidates — matches the
 * migration's own calculation_notes: "responses received", a narrower,
 * more meaningful denominator than every candidate contacted) whose
 * human-CONFIRMED classification (never the AI's `aiSuggestedClassification`
 * — see CandidateResponseSchema's own comment on why confirmedClassification
 * is the sole authoritative value) is 'interested' or 'needs_more_info'.
 *
 * - client: manually-logged fallback (DATA_POINT_KEYS.CLIENT_CANDIDATE_
 *   INTEREST_RATE); `not_available` when absent, same reasoning as
 *   candidate_response_rate above.
 */
export function calculateCandidateInterestRate(params: {
  side: PocResultSide
  vendorCandidateResponses: CandidateResponse[]
  clientReportedDataPoints: PocMetricDataPoint[]
}): MetricCalculationResult {
  if (params.side === 'client') {
    const dataPoint = params.clientReportedDataPoints.find(
      (row) => row.dataPointKey === DATA_POINT_KEYS.CLIENT_CANDIDATE_INTEREST_RATE,
    )
    if (!dataPoint || dataPoint.valueNumeric === null) {
      return {
        status: 'not_available',
        reason: "Outreach conducted on the client's own channels is not observed by this platform.",
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

  // Only responses a human has actually reviewed and confirmed count as
  // "received" for this metric's denominator — an un-reviewed inbound
  // reply has no authoritative classification yet (AI's suggestion alone
  // never counts, per CandidateResponseSchema's own contract).
  const confirmed = params.vendorCandidateResponses.filter(
    (r) => r.confirmedClassification !== null,
  )
  if (confirmed.length === 0) {
    return {
      status: 'pending',
      reason:
        'No vendor-side candidate responses have been reviewed and confirmed for this role yet.',
    }
  }

  const interested = confirmed.filter(
    (r) =>
      r.confirmedClassification === 'interested' || r.confirmedClassification === 'needs_more_info',
  )
  return {
    status: 'computed',
    value: round((interested.length / confirmed.length) * 100, 2),
    unit: 'percent',
    inputsUsed: confirmed.map((r) => r.id),
    excludedCount: 0,
  }
}
