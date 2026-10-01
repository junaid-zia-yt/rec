import 'server-only'
import type {
  CandidateEvidenceBundleItem,
  MatchingAIProvider,
  MatchingAIProviderCallResult,
  MatchingAIRequest,
} from '@/lib/ai/matching-provider'

/**
 * Build Phase 17D Wave A ("Private Client Demo Readiness") — a deterministic,
 * offline stand-in for a live Anthropic matching call, used ONLY by
 * `scripts/seed-demo.ts` / `scripts/reset-demo.ts` to feed real, fictional
 * candidate evidence through the REAL deterministic pipeline
 * (`lib/matching/matching-pipeline.ts` -> `runMatchingPipeline` ->
 * `computeDeterministicMatchResult`), so every gate/score/evidence row this
 * demo displays is a genuine output of real code, not hand-typed numbers.
 *
 * This is a DISTINCT module from `lib/ai/matching-test-adapter.ts`'s
 * `TestMatchingAIProvider` (imported only by `.test.ts` files, per that
 * file's own header note) — this one is imported by non-test seed scripts,
 * so it is named and labeled for that purpose from the start rather than
 * reusing the test-only double. The matching LOGIC is intentionally the
 * same shape (case-insensitive substring match of the requirement name
 * against each evidence item's text, with a `FAIL:` marker meaning
 * "evidence contradicts the requirement" and no match meaning
 * `insufficient_evidence`) because that is exactly what makes the result
 * reproducible and inspectable for a demo audience, not a live model's
 * actual semantic judgment.
 *
 * `model` is deliberately named 'sample-assessment-v1' (never a real
 * Anthropic model id like 'claude-...') so the `ai_runs.model` column this
 * produces can never be mistaken for a live provider call by anything that
 * later reads it (e.g. a future "which model produced this" UI).
 */
export class SampleAssessmentMatchingProvider implements MatchingAIProvider {
  readonly name = 'demo-sample-assessment'

  async assessMatch(request: MatchingAIRequest): Promise<MatchingAIProviderCallResult> {
    return {
      model: 'sample-assessment-v1',
      rawOutput: deriveSampleAssessment(request),
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      latencyMs: 0,
    }
  }
}

function findMatches(
  requirementName: string,
  evidence: CandidateEvidenceBundleItem[],
): CandidateEvidenceBundleItem[] {
  const needle = requirementName.trim().toLowerCase()
  if (!needle) return []
  return evidence.filter((item) => item.text.toLowerCase().includes(needle))
}

function deriveSampleAssessment(request: MatchingAIRequest) {
  const assessments = request.trustedContext.requirements.map((requirement) => {
    const matches = findMatches(requirement.name, request.candidateEvidence)

    if (matches.length === 0) {
      return {
        requirementId: requirement.requirementId,
        requirementType: requirement.type,
        relevanceScore: null,
        confidence: null,
        gateSuggestion: requirement.type === 'mandatory' ? 'insufficient_evidence' : null,
        explanation: `No sample evidence was seeded for "${requirement.name}" — marked unverified, never guessed.`,
        evidenceRefs: [],
        riskNotes: [],
      }
    }

    const explicitFail = matches.some((item) => /\bFAIL:/i.test(item.text))
    const conflicting = matches.length > 1 && matches.some((item) => !item.isDirectStatement)
    const allDirect = matches.every((item) => item.isDirectStatement)

    return {
      requirementId: requirement.requirementId,
      requirementType: requirement.type,
      relevanceScore: explicitFail ? 0.1 : allDirect ? 0.9 : 0.55,
      confidence: conflicting ? 0.4 : allDirect ? 0.9 : 0.6,
      gateSuggestion: requirement.type === 'mandatory' ? (explicitFail ? 'fail' : 'pass') : null,
      explanation: conflicting
        ? `Sample evidence for "${requirement.name}" conflicts across ${matches.length} sources.`
        : explicitFail
          ? `Sample evidence directly contradicts "${requirement.name}".`
          : `Sample evidence supports "${requirement.name}".`,
      evidenceRefs: matches.slice(0, 5).map((item) => ({
        sourceKind: item.sourceKind,
        sourceId: item.sourceId,
        excerpt: item.text.slice(0, 300),
        location: null,
        isDirectStatement: item.isDirectStatement,
      })),
      riskNotes: [],
    }
  })

  return { assessments, unresolvedNotes: [] }
}
