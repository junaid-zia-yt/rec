import 'server-only'
import { z } from 'zod'
import {
  CandidateMatchAIOutputSchema,
  type CandidateMatchAIOutput,
  RequirementEvidenceSourceKind,
} from '@rqi/types'

/**
 * Trusted context for a matching AI call — the frozen scorecard snapshot
 * and job title, all human-authored/approved data the recruiter already
 * has RLS-scoped access to (docs/09-ai-architecture.md trust boundary),
 * never anything derived from a candidate's own CV/profile text.
 */
export const TrustedMatchingRequirementSchema = z.object({
  requirementId: z.string(),
  name: z.string(),
  description: z.string(),
  evidenceExpected: z.string(),
  type: z.enum(['mandatory', 'preferred']),
  weight: z.number().nullable(),
})
export type TrustedMatchingRequirement = z.infer<typeof TrustedMatchingRequirementSchema>

export const TrustedMatchingContextSchema = z.object({
  jobTitle: z.string(),
  requirements: z.array(TrustedMatchingRequirementSchema),
})
export type TrustedMatchingContext = z.infer<typeof TrustedMatchingContextSchema>

/**
 * One item of the deterministically-retrieved candidate evidence bundle
 * (matching pipeline step 5: "Retrieve relevant candidate evidence") — the
 * UNTRUSTED half of the request. Every item traces back to a real,
 * already-persisted candidate_experiences/_education/_certifications/
 * _skills/candidate_extracted_fields row (or the candidate_profiles
 * summary), never freshly re-read from a raw document — the CV text
 * itself was already validated and, where accepted, written into these
 * structured rows by the Build Phase 6 pipeline. It is still treated as
 * untrusted here (docs/09-ai-architecture.md §9.1's trust boundary is not
 * a one-time gate — candidate-sourced text stays data, never instructions,
 * at every workflow that reads it, including this one).
 */
export const CandidateEvidenceBundleItemSchema = z.object({
  sourceKind: RequirementEvidenceSourceKind,
  sourceId: z.string().nullable(),
  text: z.string(),
  isDirectStatement: z.boolean(),
})
export type CandidateEvidenceBundleItem = z.infer<typeof CandidateEvidenceBundleItemSchema>

export interface MatchingAIRequest {
  trustedContext: TrustedMatchingContext
  candidateEvidence: CandidateEvidenceBundleItem[]
  promptVersion: string
  promptTemplate: string
}

/** What a provider call returns BEFORE Zod validation — the raw, unvalidated model output, recorded verbatim in matching_runs' linked ai_runs.output_json even when validation later rejects it. */
export interface MatchingAIProviderCallResult {
  model: string
  rawOutput: unknown
  inputTokens: number | null
  outputTokens: number | null
  costUsd: number | null
  latencyMs: number
}

/** Same typed-provider-interface / deterministic-test-adapter pattern as lib/ai/provider.ts (Build Phase 4) and lib/ai/candidate-provider.ts (Build Phase 6) — every implementation returns the same shape so the orchestration layer never branches on which provider produced a result. */
export interface MatchingAIProvider {
  readonly name: string
  assessMatch(request: MatchingAIRequest): Promise<MatchingAIProviderCallResult>
}

export class MatchingAIProviderError extends Error {
  constructor(
    message: string,
    readonly kind: 'timeout' | 'network' | 'provider_error' | 'not_configured',
  ) {
    super(message)
    this.name = 'MatchingAIProviderError'
  }
}

/** Never throws — a discriminated result so the caller can decide between a retry and `validation_failed` without a try/catch around Zod. */
export function validateMatchingOutput(
  rawOutput: unknown,
): { valid: true; output: CandidateMatchAIOutput } | { valid: false; issues: string[] } {
  const result = CandidateMatchAIOutputSchema.safeParse(rawOutput)
  if (result.success) {
    return { valid: true, output: result.data }
  }
  return {
    valid: false,
    issues: result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    ),
  }
}
