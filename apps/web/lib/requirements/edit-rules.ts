import type { RequirementSourceStatus } from '@rqi/types'

/**
 * Deterministic status transition applied whenever a human edits a
 * requirement (Build Phase 4 brief §AI WORKFLOW step 9: "Allow editing,
 * deletion, reclassification and weighting"). Extracted as a pure function
 * so the human-edit-preservation rule is unit-testable without mocking
 * Supabase — lib/requirements/actions.ts's updateRequirementAction calls
 * this rather than inlining the transition.
 *
 * A manually-added requirement's status never changes on edit — it was
 * never AI-proposed, so there is nothing to mark "reviewed". Every other
 * requirement (whether still `proposed` or already `reviewed`) becomes
 * `reviewed` on any edit, which is how the UI distinguishes "AI proposed,
 * unreviewed" from "a human has looked at and confirmed or changed this".
 *
 * This function NEVER touches `aiGenerated` — that flag is a permanent,
 * honest record of whether the AI originated this row's content, and an
 * edit must preserve it exactly (a human correcting an AI-proposed
 * requirement's wording does not retroactively make it human-authored —
 * project AI safety rule: every AI action must remain auditable).
 */
export function nextRequirementStatusAfterEdit(
  currentStatus: RequirementSourceStatus,
): RequirementSourceStatus {
  return currentStatus === 'manually_added' ? 'manually_added' : 'reviewed'
}
