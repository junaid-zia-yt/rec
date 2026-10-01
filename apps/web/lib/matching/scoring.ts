import 'server-only'
import type {
  FrozenRequirement,
  MatchRequirementAssessment,
  ScoringCriterionComputation,
} from '@rqi/types'

/**
 * Deterministic weighted scoring (docs/08-candidate-scoring.md §8.1/§8.3).
 * Every function here is pure arithmetic over already-computed AI
 * assessments — the per-criterion `rawScore` may originate from an AI
 * semantic-similarity call (Layer C), but the aggregation into a weighted
 * score is a fixed formula, exactly as the brief requires: "AI does not
 * calculate or control the final numeric score."
 */

/** An unverified/low-confidence match is capped rather than scored at face value (docs/08-candidate-scoring.md §8.3's example: "x0.6"). */
export const LOW_CONFIDENCE_SCORE_DISCOUNT = 0.6
/** Below this AI-reported confidence, or when the evidence is inferred rather than a direct statement, the discount above applies. */
export const LOW_CONFIDENCE_THRESHOLD = 0.5

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round((value + Number.EPSILON) * factor) / factor
}

/** Layer D: the confidence-discount multiplier (docs/08-candidate-scoring.md §8.3/§8.6). Null confidence is treated as low-confidence, never as full trust. */
export function computeConfidenceDiscount(
  confidence: number | null,
  hasDirectEvidence: boolean,
): number {
  if (confidence === null) return LOW_CONFIDENCE_SCORE_DISCOUNT
  if (!hasDirectEvidence || confidence < LOW_CONFIDENCE_THRESHOLD)
    return LOW_CONFIDENCE_SCORE_DISCOUNT
  return 1
}

/**
 * Scores every PREFERRED requirement in the frozen scorecard snapshot
 * against the AI's assessments. A requirement with no assessment, no
 * evidence, or a null relevanceScore contributes exactly 0 — never
 * imputed or guessed (docs/08-candidate-scoring.md §8.7).
 */
export function scorePreferredRequirements(params: {
  preferredRequirements: FrozenRequirement[]
  assessments: MatchRequirementAssessment[]
}): ScoringCriterionComputation[] {
  const byRequirement = new Map(
    params.assessments.map((assessment) => [assessment.requirementId, assessment]),
  )

  return params.preferredRequirements.map((requirement) => {
    const weight = requirement.weight ?? 0
    const assessment = byRequirement.get(requirement.requirementId)
    const hasEvidence = Boolean(
      assessment && assessment.evidenceRefs.length > 0 && assessment.relevanceScore !== null,
    )

    if (!hasEvidence) {
      return {
        requirementId: requirement.requirementId,
        requirementName: requirement.name,
        weight,
        rawScore: null,
        confidenceDiscount: 1,
        effectiveScore: null,
        weightedContribution: 0,
        hasEvidence: false,
      }
    }

    const hasDirectEvidence = assessment!.evidenceRefs.some((ref) => ref.isDirectStatement)
    const confidenceDiscount = computeConfidenceDiscount(assessment!.confidence, hasDirectEvidence)
    const rawScore = assessment!.relevanceScore as number
    const effectiveScore = round(rawScore * confidenceDiscount, 3)
    const weightedContribution = round(effectiveScore * weight, 3)

    return {
      requirementId: requirement.requirementId,
      requirementName: requirement.name,
      weight,
      rawScore,
      confidenceDiscount,
      effectiveScore,
      weightedContribution,
      hasEvidence: true,
    }
  })
}

/**
 * `weighted_score = Σ(weight_i × criterion_score_i) / Σ(weight_i)` on a
 * 0-100 scale (docs/08-candidate-scoring.md §8.3's formula). Returns null
 * when there are no weighted (preferred) criteria at all — never a
 * division by zero, never a fabricated 0.
 */
export function computeWeightedScore(criteria: ScoringCriterionComputation[]): number | null {
  const totalWeight = criteria.reduce((sum, criterion) => sum + criterion.weight, 0)
  if (totalWeight <= 0) return null
  const numerator = criteria.reduce((sum, criterion) => sum + criterion.weightedContribution, 0)
  return round((numerator / totalWeight) * 100, 2)
}

/** `evidence_pct = (# scored criteria with verified evidence) / (# total scored criteria) x 100` (§8.3), computed over preferred criteria — mandatory-gate evidence coverage is a separate, gate-level concept. */
export function computeEvidenceCoveragePct(criteria: { hasEvidence: boolean }[]): number {
  if (criteria.length === 0) return 0
  const withEvidence = criteria.filter((criterion) => criterion.hasEvidence).length
  return round((withEvidence / criteria.length) * 100, 2)
}

/** `completeness = (# scorecard fields with any data) / (# total scorecard fields) x 100` (§8.3) — across BOTH mandatory and preferred requirements, since a mandatory gate resting on no evidence is just as much a completeness gap as an unscored preferred criterion. */
export function computeDataCompletenessPct(params: {
  mandatoryHasEvidence: boolean[]
  preferredHasEvidence: boolean[]
}): number {
  const all = [...params.mandatoryHasEvidence, ...params.preferredHasEvidence]
  if (all.length === 0) return 0
  const withData = all.filter(Boolean).length
  return round((withData / all.length) * 100, 2)
}

/** Aggregate confidence (Layer D), shown separately from overall_score per the brief: "Do not combine these into one misleading number." Averages only the criteria that actually reported a confidence value; null when none did. */
export function computeAggregateConfidence(confidences: (number | null)[]): number | null {
  const values = confidences.filter((value): value is number => value !== null)
  if (values.length === 0) return null
  return round(values.reduce((sum, value) => sum + value, 0) / values.length, 3)
}

/**
 * Tie-breaking (docs/08-candidate-scoring.md §8.11): two eligible
 * candidates within `epsilonPoints` of each other are flagged for human
 * decision rather than auto-ranked by a fractional difference the evidence
 * doesn't actually support. Returns the ids of every candidate involved in
 * at least one tie; the caller decides how to render the flag.
 */
export function flagTiedCandidates(
  candidates: { candidateId: string; overallScore: number | null }[],
  epsilonPoints = 1.5,
): Set<string> {
  const eligible = candidates.filter(
    (c): c is { candidateId: string; overallScore: number } => c.overallScore !== null,
  )
  const tied = new Set<string>()
  for (let i = 0; i < eligible.length; i += 1) {
    for (let j = i + 1; j < eligible.length; j += 1) {
      const a = eligible[i]!
      const b = eligible[j]!
      if (Math.abs(a.overallScore - b.overallScore) <= epsilonPoints) {
        tied.add(a.candidateId)
        tied.add(b.candidateId)
      }
    }
  }
  return tied
}
