import type { MetricUnit, PocResultSide } from '@rqi/types'

/**
 * Build Phase 10, Wave 2 — POC metrics calculation engine (docs/14-poc-
 * specification.md, supabase/migrations/0030_poc_benchmarks.sql). Every
 * module under apps/web/lib/poc/ is pure TypeScript: no Supabase client, no
 * fetch, no filesystem access. Callers (wave 3's server actions) load rows
 * from poc_benchmarks/poc_roles/poc_participants/poc_baselines/poc_metrics/
 * poc_exclusions plus whatever live platform tables a metric needs
 * (candidate_role_matches, shortlist_candidates, client_decisions,
 * outreach_messages, candidate_responses, …) and pass plain arrays/objects
 * into these functions.
 *
 * THE CORE RULE THIS TYPE EXISTS TO ENFORCE (brief §METRICS: "Do not invent
 * missing results. Use Pending / Not Available / Not Measured instead of
 * fabricated values."): a calculator may NEVER return `status: 'computed'`
 * with a guessed, interpolated or partially-derived number. If the inputs
 * it needs are missing, empty, ambiguous, or structurally unavailable, it
 * must return one of the three non-computed statuses instead. This mirrors
 * poc_results' own `poc_results_value_matches_status` CHECK constraint
 * (status='computed' <=> value is not null) at the TypeScript layer, ahead
 * of ever reaching the database.
 *
 * Status choice (documented once here so every calculator applies it the
 * same way, rather than each file inventing its own judgment call):
 *   - 'not_available'  — no data source exists at all to measure this for
 *     this side/metric (e.g. offer_progression — no offer-stage table
 *     exists anywhere in the schema yet; evidence_coverage on the client
 *     side — the client's manual process has no structured evidence trail
 *     by design, not just "not yet reported").
 *   - 'pending'        — a data source exists and collection is expected,
 *     but the specific rows needed have not been recorded yet (e.g. a
 *     client baseline hasn't been entered yet for a role that is still
 *     `in_progress`).
 *   - 'not_measured'   — this specific benchmark/team chose not to track
 *     this metric for this instance (e.g. the POC's timeline didn't allow
 *     a post-hoc interview/offer follow-up check for this role), distinct
 *     from 'not_available' where no mechanism to track it exists at all.
 */
export type MetricCalculationResult =
  | {
      status: 'computed'
      value: number
      unit: MetricUnit
      /**
       * Ids of the raw poc_baselines / poc_metrics / poc_exclusions (or,
       * for vendor-side metrics backed directly by production tables,
       * candidate_role_matches / shortlist_candidates / client_decisions /
       * outreach_messages / candidate_responses) rows this value was
       * computed from. Never a recomputation of those rows — purely a
       * reference list for audit/explainability, matching poc_results.
       * calculation_input_ref's own "reference, never the formula" intent.
       */
      inputsUsed: string[]
      /**
       * Count of poc_exclusions rows that were factored into this specific
       * calculation (either subtracted from a count, or deliberately kept
       * in a speed total per still_counts_toward_speed) — 0 when no
       * exclusion applied. Lets a caller/report surface "N candidates
       * excluded" next to the number without re-deriving it.
       */
      excludedCount: number
    }
  | { status: 'pending'; reason: string }
  | { status: 'not_available'; reason: string }
  | { status: 'not_measured'; reason: string }

/** Convenience narrowing helper — `result.value` is only legal after this returns true. */
export function isComputedResult(
  result: MetricCalculationResult,
): result is Extract<MetricCalculationResult, { status: 'computed' }> {
  return result.status === 'computed'
}

/** Which "side" of the POC a calculation is being run for — re-exported here so calculator files don't each need their own import of PocResultSide alongside MetricCalculationResult. */
export type { PocResultSide }
