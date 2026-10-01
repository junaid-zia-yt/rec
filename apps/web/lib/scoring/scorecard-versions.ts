import 'server-only'
import type { RequirementType } from '@rqi/types'
import { validateRequirementWeights, type WeightCheckRequirement } from './validate-weights'

/**
 * Deterministic scorecard-version lifecycle rules (Build Phase 4 brief
 * §"Scoring validation"): version numbering, the freeze-on-approval
 * snapshot shape, and the single approval gate every approve/reject/
 * request-changes decision must be checked against before it is recorded.
 * None of this is AI-driven — see lib/scoring/validate-weights.ts's header
 * note on the same rule.
 */

export interface RequirementSnapshotEntry {
  requirementId: string
  type: RequirementType
  weight: number | null
}

/** The frozen snapshot written to scorecard_versions.requirement_snapshot at submission time (immutable once the version becomes active — enforced by the DB trigger in 0016_scorecards.sql). */
export function buildRequirementSnapshot(
  requirements: WeightCheckRequirement[],
): RequirementSnapshotEntry[] {
  return requirements.map((requirement) => ({
    requirementId: requirement.id,
    type: requirement.type,
    weight: requirement.weight,
  }))
}

/** The next version_no for a scorecard, given the version numbers it already has. Starts at 1. */
export function nextVersionNumber(existingVersionNumbers: number[]): number {
  if (existingVersionNumbers.length === 0) return 1
  return Math.max(...existingVersionNumbers) + 1
}

/**
 * True when an edit to a scorecard's requirements must be applied to a
 * brand-new draft version rather than the version the caller currently has
 * open (Build Phase 4 brief: "Changes after approval create a new draft
 * version"). A version that is still `draft` or `pending_approval` may be
 * edited in place; once a version has ever reached `active`, or has been
 * `superseded`, editing it is never allowed — a fresh draft is required.
 */
export function requiresNewDraftVersion(currentVersionStatus: string): boolean {
  return currentVersionStatus === 'active' || currentVersionStatus === 'superseded'
}

export interface ApprovalGateResult {
  canApprove: boolean
  reasons: string[]
}

/**
 * The single deterministic gate every scorecard-version approval decision
 * must pass (Build Phase 4 brief: "The scorecard cannot be approved with
 * invalid totals"). A server action must call this and refuse to write a
 * scorecard_approvals row with decision = 'approved' when canApprove is
 * false — the AI never makes this call, and the database's own immutability
 * trigger (0016_scorecards.sql) is the second, independent layer should an
 * application bug ever try anyway.
 */
export function canApproveScorecardVersion(params: {
  versionStatus: string
  requirements: WeightCheckRequirement[]
}): ApprovalGateResult {
  const reasons: string[] = []

  if (params.versionStatus === 'active') {
    reasons.push('This scorecard version is already active and approved.')
  }
  if (params.versionStatus === 'superseded') {
    reasons.push('This scorecard version has been superseded and can no longer be approved.')
  }
  if (params.requirements.length === 0) {
    reasons.push('A scorecard must contain at least one requirement before it can be approved.')
  }

  const weightCheck = validateRequirementWeights(params.requirements)
  if (!weightCheck.valid) {
    reasons.push(...weightCheck.errors)
  }

  return { canApprove: reasons.length === 0, reasons }
}
