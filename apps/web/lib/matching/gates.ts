import 'server-only'
import type {
  FrozenRequirement,
  GateResult,
  MandatoryGateComputation,
  MatchRequirementAssessment,
} from '@rqi/types'

/**
 * Deterministic mandatory-gate evaluation (docs/08-candidate-scoring.md
 * §8.5, Build Phase 7 brief §CORE RULES: "Mandatory gates are evaluated
 * before ranking" / "Unknown is not equivalent to passed"). Pure function —
 * no AI call, no database. The AI's `gateSuggestion` (Layer A's "AI only
 * proposes") is informational input only; it is NEVER trusted at face
 * value without evidence, and it never overrides the "no evidence ->
 * insufficient_evidence" rule below (brief: "AI does not calculate or
 * control the final numeric score" — extended here: it never controls the
 * gate result either).
 */
export function evaluateMandatoryGates(params: {
  mandatoryRequirements: FrozenRequirement[]
  assessments: MatchRequirementAssessment[]
}): MandatoryGateComputation[] {
  const byRequirement = new Map(
    params.assessments.map((assessment) => [assessment.requirementId, assessment]),
  )

  return params.mandatoryRequirements.map((requirement) => {
    const assessment = byRequirement.get(requirement.requirementId)
    const hasAnyEvidence = Boolean(assessment && assessment.evidenceRefs.length > 0)

    let deterministicResult: GateResult
    if (!hasAnyEvidence) {
      // No evidence at all -> insufficient_evidence, full stop, regardless
      // of anything the model suggested (docs/08-candidate-scoring.md
      // §8.7: "Any requirement with zero evidence is insufficient_evidence
      // /unverified").
      deterministicResult = 'insufficient_evidence'
    } else if (assessment!.gateSuggestion === 'pass') {
      deterministicResult = 'pass'
    } else if (assessment!.gateSuggestion === 'fail') {
      deterministicResult = 'fail'
    } else {
      // Evidence exists but the model itself was unsure (or the assessment
      // carried no gateSuggestion at all, e.g. mismatched data) — never
      // guessed as a pass just because SOME evidence was found.
      deterministicResult = 'insufficient_evidence'
    }

    return {
      requirementId: requirement.requirementId,
      requirementName: requirement.name,
      deterministicResult,
      hasAnyEvidence,
    }
  })
}

/** Maps a deterministic result to its un-overridden display state (supabase/migrations/0027's five-state `state` column). A human override on top of this is applied by the caller, never derived here. */
export function deriveGateState(deterministicResult: GateResult): 'passed' | 'failed' | 'unknown' {
  switch (deterministicResult) {
    case 'pass':
      return 'passed'
    case 'fail':
      return 'failed'
    case 'insufficient_evidence':
    default:
      return 'unknown'
  }
}

/**
 * Overall eligibility (docs/08-candidate-scoring.md §8.3's `gate_pass`
 * rule), computed from the EFFECTIVE result of every mandatory gate — the
 * caller passes `overrideResult ?? deterministicResult` per gate, so a
 * recorded human override (brief: "Human Override" state) is reflected
 * here without this function needing any database/override knowledge of
 * its own.
 *
 * A single 'fail' makes the candidate ineligible outright (brief: "A
 * failed mandatory gate makes the candidate ineligible for ranked
 * shortlisting"). A single 'insufficient_evidence' with no 'fail' present
 * routes to 'pending_verification' — never silently treated as a pass and
 * never silently excluded either (brief: "Unknown is not equivalent to
 * passed").
 */
export function deriveEligibility(
  effectiveResults: GateResult[],
): 'eligible' | 'ineligible' | 'pending_verification' {
  if (effectiveResults.length === 0) return 'eligible'
  if (effectiveResults.some((result) => result === 'fail')) return 'ineligible'
  if (effectiveResults.some((result) => result === 'insufficient_evidence'))
    return 'pending_verification'
  return 'eligible'
}
