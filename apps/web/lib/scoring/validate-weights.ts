import { UNWEIGHTED_REQUIREMENT_TYPES, type RequirementType } from '@rqi/types'

/**
 * Deterministic scorecard weight validation (Build Phase 4 brief
 * §"Scoring validation"). Pure, side-effect-free, and never delegated to
 * the AI: the project's AI safety rules require "deterministic logic for
 * mandatory gates and final score calculations", and weight/total
 * validation is exactly that class of decision — it must give the same
 * answer for the same input every time, which an LLM call cannot
 * guarantee.
 *
 * Deliberately NOT marked 'server-only' — unlike the server-action modules
 * that call it, this file does no I/O and is imported by the client-side
 * scorecard editor (components/domain/scorecard/*) to render a live
 * weight-total preview as a recruiter edits. The actual approval gate is
 * still always re-run server-side (lib/scorecards/actions.ts) before any
 * write — a client-side preview is a convenience, never the authority.
 */

export interface WeightCheckRequirement {
  id: string
  type: RequirementType
  weight: number | null
}

export interface WeightValidationResult {
  valid: boolean
  errors: string[]
  /** Sum of all `preferred` weights, or null when there are no preferred requirements to sum. */
  preferredWeightTotal: number | null
}

const WEIGHT_TOTAL_TOLERANCE = 0.01
const UNWEIGHTED_TYPES = new Set<string>(UNWEIGHTED_REQUIREMENT_TYPES)

/**
 * Validates one scorecard's full requirement set:
 *   - Mandatory, disqualifying, informational, and requires_clarification
 *     requirements must never carry a weight (Build Phase 4 brief:
 *     "Mandatory requirements do not need percentage weights" — extended
 *     here to every pass/fail or unscored type, per
 *     UNWEIGHTED_REQUIREMENT_TYPES).
 *   - Every `preferred` requirement must carry a weight.
 *   - The `preferred` weights, taken together, must total exactly 100%
 *     (within a small floating-point tolerance) — Build Phase 4 brief:
 *     "Preferred weighted categories must total 100%". A scorecard with no
 *     preferred requirements at all has nothing to total and is not, by
 *     itself, a weight-validation failure.
 */
export function validateRequirementWeights(
  requirements: WeightCheckRequirement[],
): WeightValidationResult {
  const errors: string[] = []

  for (const requirement of requirements) {
    if (UNWEIGHTED_TYPES.has(requirement.type) && requirement.weight !== null) {
      errors.push(
        `Requirement "${requirement.id}" is type "${requirement.type}" and must not carry a weight — mandatory, disqualifying, informational, and requires_clarification requirements are pass/fail gates or unscored, never percentage-weighted.`,
      )
    }
    if (requirement.type === 'preferred' && requirement.weight === null) {
      errors.push(`Requirement "${requirement.id}" is "preferred" and must have a weight.`)
    }
    if (
      requirement.type === 'preferred' &&
      requirement.weight !== null &&
      (requirement.weight < 0 || requirement.weight > 100)
    ) {
      errors.push(
        `Requirement "${requirement.id}" has an out-of-range weight (${requirement.weight}); weights must be between 0 and 100.`,
      )
    }
  }

  const preferredWeights = requirements
    .filter((requirement) => requirement.type === 'preferred' && requirement.weight !== null)
    .map((requirement) => requirement.weight as number)

  const preferredWeightTotal =
    preferredWeights.length > 0 ? preferredWeights.reduce((sum, w) => sum + w, 0) : null

  if (
    preferredWeightTotal !== null &&
    Math.abs(preferredWeightTotal - 100) > WEIGHT_TOTAL_TOLERANCE
  ) {
    errors.push(
      `Preferred requirement weights must total 100% — currently ${preferredWeightTotal.toFixed(2)}%.`,
    )
  }

  return { valid: errors.length === 0, errors, preferredWeightTotal }
}
