import {
  ACTIVE_CANDIDATE_PIPELINE_STAGES,
  TERMINAL_CANDIDATE_PIPELINE_STAGES,
  type CandidatePipelineStage,
} from '@rqi/types'

/**
 * Deterministic pipeline-stage transition rules — Build Phase 5 brief
 * §"Pipeline stages": "Every stage transition must: Be permission checked,
 * Be timestamped, Record actor, Record reason when required, Produce an
 * audit event." This module is the pure, unit-tested "is this transition
 * even legal" gate that runs before any of that — permission checking
 * itself lives in lib/auth (requirePermission + requireProjectAccess),
 * composed with this in the server action, never duplicated here.
 *
 * Deliberately deterministic, never AI — per the project's AI-safety rule
 * that pipeline/gate decisions are always application logic.
 */

function activeIndex(stage: CandidatePipelineStage): number {
  return ACTIVE_CANDIDATE_PIPELINE_STAGES.indexOf(stage)
}

/** True only when `stage` is one of the two terminal stages (rejected/withdrawn) — no further transition is ever valid from there. */
export function isTerminalStage(stage: CandidatePipelineStage): boolean {
  return TERMINAL_CANDIDATE_PIPELINE_STAGES.includes(stage)
}

export interface TransitionCheckResult {
  valid: boolean
  reason?: string
}

/**
 * A transition is valid when:
 *   - `from` is not already a terminal stage (rejected/withdrawn are final —
 *     no reactivation path in this build phase), AND
 *   - `to` is a terminal stage (reject/withdraw is always reachable from any
 *     active stage), OR
 *   - `to` is exactly one step forward or one step back among the six
 *     active stages (no skipping — e.g. discovered → shortlisted directly is
 *     invalid — and no jump of more than one step backward either).
 * A same-stage "transition" (from === to) is never valid — it is not a
 * transition, and re-recording the same stage would be a misleading pipeline
 * event.
 */
export function checkPipelineTransition(
  from: CandidatePipelineStage,
  to: CandidatePipelineStage,
): TransitionCheckResult {
  if (from === to) {
    return { valid: false, reason: 'The candidate is already in this stage.' }
  }

  if (isTerminalStage(from)) {
    return {
      valid: false,
      reason:
        'This candidate is in a terminal stage (rejected/withdrawn) and cannot be moved further.',
    }
  }

  if (isTerminalStage(to)) {
    return { valid: true }
  }

  const fromIndex = activeIndex(from)
  const toIndex = activeIndex(to)
  if (fromIndex === -1 || toIndex === -1) {
    return { valid: false, reason: 'Unrecognized pipeline stage.' }
  }

  if (Math.abs(toIndex - fromIndex) === 1) {
    return { valid: true }
  }

  return {
    valid: false,
    reason:
      'Stages cannot be skipped — move one step forward or back at a time, or reject/withdraw the candidate.',
  }
}

export function isValidPipelineTransition(
  from: CandidatePipelineStage,
  to: CandidatePipelineStage,
): boolean {
  return checkPipelineTransition(from, to).valid
}

/**
 * Brief §PRIVACY: "Restrict client reviewers to shortlisted or explicitly
 * shared candidates." A transition into 'shortlisted' automatically makes
 * the candidate client-visible for that project; every other transition
 * leaves the existing client_visible flag exactly as it was — an explicit
 * "share with client" action can still set it true earlier, and this
 * function never turns it back off (only an explicit unshare action would).
 */
export function nextClientVisible(
  toStage: CandidatePipelineStage,
  currentClientVisible: boolean,
): boolean {
  if (toStage === 'shortlisted') return true
  return currentClientVisible
}

/** Whether a transition reason is required — the brief says "Record reason when required"; a move into a terminal stage always needs one (recruiters must say why), an active→active move does not. */
export function transitionRequiresReason(to: CandidatePipelineStage): boolean {
  return isTerminalStage(to)
}
