import 'server-only'
import type {
  CandidateEligibility,
  FrozenRequirement,
  MandatoryGateComputation,
  MatchRequirementAssessment,
  ScoringCriterionComputation,
  WeightedScoreResult,
} from '@rqi/types'
import { deriveEligibility, evaluateMandatoryGates } from './gates'
import {
  computeAggregateConfidence,
  computeDataCompletenessPct,
  computeEvidenceCoveragePct,
  computeWeightedScore,
  scorePreferredRequirements,
} from './scoring'

/**
 * Pure orchestration of the deterministic half of the matching pipeline
 * (docs/08-candidate-scoring.md §8.1 layers A/B/E) — no AI call, no
 * database. `params.assessments` is the AI's already-validated Layer C/D
 * semantic output (apps/web/lib/ai/matching-provider.ts); this function
 * only ever reads `relevanceScore`/`confidence`/`gateSuggestion` from it,
 * never writes back to it, and never trusts a value the assessment itself
 * didn't ground in an evidence excerpt (see gates.ts / scoring.ts).
 *
 * Kept separate from apps/web/lib/matching/matching-pipeline.ts (which
 * adds I/O: freezing the scorecard, retrieving evidence, calling the AI
 * provider) so this function is directly unit-testable against fixed
 * input/output pairs, matching this repo's "deterministic layer: unit-
 * tested against fixed input/output pairs (no AI call in the test)"
 * convention (docs/08-candidate-scoring.md §8.13).
 */
export interface DeterministicMatchResult {
  gates: MandatoryGateComputation[]
  eligibility: CandidateEligibility
  criteria: ScoringCriterionComputation[]
  weighted: WeightedScoreResult
}

export function computeDeterministicMatchResult(params: {
  requirements: FrozenRequirement[]
  assessments: MatchRequirementAssessment[]
}): DeterministicMatchResult {
  const mandatoryRequirements = params.requirements.filter(
    (requirement) => requirement.type === 'mandatory',
  )
  const preferredRequirements = params.requirements.filter(
    (requirement) => requirement.type === 'preferred',
  )

  const gates = evaluateMandatoryGates({ mandatoryRequirements, assessments: params.assessments })
  const eligibility = deriveEligibility(gates.map((gate) => gate.deterministicResult))

  const criteria = scorePreferredRequirements({
    preferredRequirements,
    assessments: params.assessments,
  })

  // docs/08-candidate-scoring.md §8.3: "if not gate_pass: overall_score =
  // null" — the weighted arithmetic is still computed (so a later human
  // override that flips eligibility to 'eligible' can reveal the already-
  // computed score without a fresh AI call — see
  // matching-actions.ts:overrideGateDecisionAction), but it is only ever
  // SURFACED when the candidate is actually eligible.
  const rawWeightedScore = computeWeightedScore(criteria)
  const overallScore: number | null = eligibility === 'eligible' ? rawWeightedScore : null

  const evidenceCoveragePct = computeEvidenceCoveragePct(criteria)
  const dataCompletenessPct = computeDataCompletenessPct({
    mandatoryHasEvidence: gates.map((gate) => gate.hasAnyEvidence),
    preferredHasEvidence: criteria.map((criterion) => criterion.hasEvidence),
  })
  const confidence = computeAggregateConfidence(
    params.assessments.map((assessment) => assessment.confidence),
  )

  return {
    gates,
    eligibility,
    criteria,
    weighted: {
      overallScore,
      evidenceCoveragePct,
      dataCompletenessPct,
      confidence,
      criteria,
    },
  }
}

/** The raw (not eligibility-gated) weighted score, used only by the override flow described above to reveal an already-computed score without re-running the AI. Never surfaced directly to a UI that hasn't already checked eligibility. */
export function computeRawWeightedScoreForOverride(
  criteria: ScoringCriterionComputation[],
): number | null {
  return computeWeightedScore(criteria)
}
