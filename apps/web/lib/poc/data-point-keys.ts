/**
 * Conventional `poc_metrics.data_point_key` values this calculation engine
 * looks for when a metric has no dedicated backing table and must fall
 * back to a manually- or platform-recorded generic data point (see each
 * calculator's doc comment for which of these it reads). Centralizing the
 * key strings here means wave 3's recording code and this package's
 * reading code can never drift apart on spelling.
 *
 * Kept in its own file (not metric-definitions.ts) purely to avoid an
 * import cycle: metric-definitions.ts imports the calculator functions,
 * and the calculators need these keys, so metric-definitions.ts cannot
 * also be the keys' source.
 */
export const DATA_POINT_KEYS = {
  /** Vendor-side "hours to first mandatory-gate-passing candidate identified", recorded once a recruiter/system marks the moment (no dedicated timestamp column exists on candidate_role_matches for this). Unit: hours. */
  TIME_TO_FIRST_QUALIFIED_HOURS: 'time_to_first_qualified_hours',
  /** Vendor-side "hours to a shortlist reaching submitted-for-approval", used only as a fallback when shortlist version timestamps aren't supplied directly. Unit: hours. */
  TIME_TO_COMPLETED_SHORTLIST_HOURS: 'time_to_completed_shortlist_hours',
  /** Either side's recruiter time actually spent, logged manually (manual_recruiter_entry source) since no automatic time-tracking exists yet. Unit: hours. */
  RECRUITER_HOURS: 'recruiter_hours',
  /** Client-reported equivalent of mandatory_gate_pass_rate, only when the client's own process exposes a comparable pass/fail decision. Unit: percent. */
  CLIENT_MANDATORY_GATE_PASS_RATE: 'client_mandatory_gate_pass_rate',
  /** Client-reported count of candidates the client's own process scored at or above their equivalent of a 90% cutoff. Unit: count. */
  CLIENT_CANDIDATES_SCORING_90_OR_HIGHER: 'client_candidates_scoring_90_or_higher',
  /** Client-reported shortlist acceptance rate, when the client tracks this distinctly from a simple final decision. Unit: percent. */
  CLIENT_SHORTLIST_ACCEPTANCE_RATE: 'client_shortlist_acceptance_rate',
  /** Client-reported candidate response rate. Unit: percent. */
  CLIENT_CANDIDATE_RESPONSE_RATE: 'client_candidate_response_rate',
  /** Client-reported candidate interest rate. Unit: percent. */
  CLIENT_CANDIDATE_INTEREST_RATE: 'client_candidate_interest_rate',
  /** Either side's interview-progression percentage, recorded manually since no interviews table exists in the schema yet (same structural gap class as offer_progression, but interview follow-up is explicitly in scope per docs/14-poc-specification.md §14.13, so a manual-entry fallback is offered here rather than a hard not_available). Unit: percent. */
  INTERVIEW_PROGRESSION_PCT: 'interview_progression_pct',
  /** Either side's count of structural failures (docs/14-poc-specification.md §14.15), recorded by a human reviewer with a documented reason — never an automatic AI judgment. Unit: count. */
  CRITICAL_ERRORS_COUNT: 'critical_errors_count',
  /** Either side's count of unsupported (non-evidence-grounded) claims found in that side's shortlisted pool. Vendor side: logged once a human reviewer has verified the shortlisted pool's citations against requirement_evidence (structural target: zero) — never an automatic AI judgment. Client side: only when the client's process is independently audited for this. Unit: count. */
  UNSUPPORTED_CLAIMS_COUNT: 'unsupported_claims_count',
} as const
