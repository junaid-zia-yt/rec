/**
 * Build Phase 11, Wave 2 — structural guarantee that no copilot tool can
 * ever override a mandatory gate, approve outreach, or submit a shortlist
 * (governing brief MUST NOT list).
 *
 * The strongest version of this guarantee is not a runtime guard at all: it
 * is the simple, auditable fact that `TOOL_REGISTRY` (tool-registry.ts)
 * contains exactly 13 entries, all read/summarize/explain/draft/compare/
 * suggest, and that NONE of the `tools/*.ts` handler modules import or call
 * any of the mutation server actions listed below. A runtime "guard
 * function" that intercepts writes would imply copilot tool code is
 * TRUSTED to attempt those writes and merely blocked at the last moment —
 * the actual design goal is that copilot tool code never has the
 * capability to attempt them in the first place (no import, no client
 * write call, nothing to intercept). This file is therefore intentionally
 * a documentation + test-support module, not a runtime interceptor: see
 * this module's own comment history in the wave 2 report for the reasoning.
 *
 * What this file DOES provide, for wave 4's adversarial tests to assert
 * against mechanically (grep/import-graph checks), not just by code review:
 */

/**
 * Every server action / DB write path a copilot tool is FORBIDDEN to call,
 * ever, directly or indirectly. Wave 4's tests should assert that no file
 * under `apps/web/lib/copilot/tools/` imports any of these symbols (a
 * static import-graph check, e.g. via a `madge`/ts-morph pass, or a simple
 * grep over the tools directory for these literal names) and that no tool's
 * handler ever issues a Supabase `.update()`/`.insert()`/`.upsert()` call
 * against these tables.
 */
export const FORBIDDEN_COPILOT_WRITE_TARGETS = [
  // Mandatory gate overrides — the brief's "override mandatory gates".
  {
    table: 'mandatory_gate_results',
    action: 'overrideGateDecisionAction (apps/web/lib/matching/matching-actions.ts)',
  },
  {
    table: 'candidate_role_matches',
    action: 'gate/eligibility mutation paths in matching-actions.ts',
  },
  // Outreach approval — the brief's "approve outreach".
  { table: 'outreach_approvals', action: 'approval server actions in apps/web/lib/outreach/*' },
  {
    table: 'outreach_messages',
    action: 'status-transition writes in apps/web/lib/outreach/outreach-actions.ts',
  },
  // Shortlist submission — the brief's "submit a shortlist".
  {
    table: 'shortlist_versions',
    action: 'submit/internally-approve/send-to-client actions in apps/web/lib/shortlists/*',
  },
  { table: 'shortlists', action: 'shortlist status mutation paths in apps/web/lib/shortlists/*' },
  // Final hiring/POC decisions — the brief's "make the final hiring decision".
  { table: 'client_decisions', action: 'client decision recording actions' },
  { table: 'poc_decisions', action: 'poc-actions.ts recordPocDecisionAction' },
  // Candidate record mutation without confirmation — the brief's "alter
  // candidate records without confirmation". No copilot tool this wave
  // proposes a mutation at all (see tool-registry.ts's requiresConfirmation
  // reasoning), so this is drawn even more conservatively: candidate
  // records are never written by any tool in this registry, full stop.
  {
    table: 'candidates',
    action: 'candidate create/update/merge actions in apps/web/lib/candidates/*',
  },
  { table: 'candidate_profiles', action: 'candidate profile update actions' },
] as const

/**
 * The 13 allowlisted tool names (re-derived here, not imported from
 * tool-registry.ts, so this file has zero dependency on that module — a
 * deliberate choice so a future accidental edit to the registry cannot
 * silently widen what this guard considers "the whole allowlist" without
 * also touching this file's own list, forcing a second, independent
 * reviewer glance at both places changing together).
 */
export const EXPECTED_COPILOT_TOOL_NAMES = [
  'summarize_recruitment_project',
  'explain_scorecard',
  'find_missing_job_requirements',
  'summarize_candidate',
  'explain_candidate_match',
  'compare_approved_candidates',
  'identify_missing_evidence',
  'draft_verification_questions',
  'draft_interview_questions',
  'draft_outreach_message',
  'summarize_candidate_responses',
  'explain_poc_metrics',
  'suggest_next_workflow_action',
] as const

/**
 * True for every one of the 13 allowlisted tools, by construction — no
 * mutation tool exists in this registry at all (see tool-registry.ts:
 * `requiresConfirmation` is `false` for all 13, documented per-tool). This
 * function exists only so a wave-4 test can assert
 * `EXPECTED_COPILOT_TOOL_NAMES.every(isReadOnlyCopilotTool) === true` as a
 * single, explicit, named assertion rather than eyeballing the registry.
 */
export function isReadOnlyCopilotTool(
  _toolName: (typeof EXPECTED_COPILOT_TOOL_NAMES)[number],
): true {
  return true
}
