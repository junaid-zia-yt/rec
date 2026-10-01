import 'server-only'
import { z } from 'zod'
import { CandidateResponseClassification, CommunicationChannel } from '@rqi/types'

/**
 * Trusted context for a response-classification AI call — what was sent
 * and the channel it went out on, all platform-recorded data the recruiter
 * already has RLS-scoped access to (mirrors matching-provider.ts's trust-
 * boundary split). Never anything derived from the candidate's reply text
 * itself.
 */
export const TrustedResponseClassificationContextSchema = z.object({
  channel: CommunicationChannel,
  /** The outbound message's body the candidate is replying to, so the model has the conversational context — still trusted/platform-authored (draft_body), never candidate-sourced. Null if no prior outbound message is linked. */
  outboundMessageBody: z.string().nullable(),
})
export type TrustedResponseClassificationContext = z.infer<
  typeof TrustedResponseClassificationContextSchema
>

export interface ResponseClassificationAIRequest {
  trustedContext: TrustedResponseClassificationContext
  /**
   * The candidate's inbound reply text — candidate_responses.raw_response_text.
   * UNTRUSTED. This text must NEVER be treated as instructions by the
   * model, only as data to classify (docs/10-ai-evaluation-guardrails.md).
   */
  rawResponseText: string
  promptVersion: string
  promptTemplate: string
}

/** What a provider call returns BEFORE Zod validation — recorded verbatim in the linked ai_runs.output_json even when validation later rejects it (same convention as MatchingAIProviderCallResult). */
export interface ResponseClassificationAIProviderCallResult {
  model: string
  rawOutput: unknown
  inputTokens: number | null
  outputTokens: number | null
  costUsd: number | null
  latencyMs: number
}

/** Same typed-provider-interface / deterministic-test-adapter pattern as lib/ai/matching-provider.ts. */
export interface ResponseClassificationAIProvider {
  readonly name: string
  classifyResponse(
    request: ResponseClassificationAIRequest,
  ): Promise<ResponseClassificationAIProviderCallResult>
}

export class ResponseClassificationAIProviderError extends Error {
  constructor(
    message: string,
    readonly kind: 'timeout' | 'network' | 'provider_error' | 'not_configured',
  ) {
    super(message)
    this.name = 'ResponseClassificationAIProviderError'
  }
}

/**
 * Structured output of the response-classification AI call. This is
 * EXPLICITLY ADVISORY ONLY (@rqi/types' CandidateResponseSchema.
 * aiSuggestedClassification) — it is never the authoritative value, and
 * this module never writes to the database. The field name intentionally
 * does not read "confirmed" or "final" anywhere in this file, so nothing
 * downstream can be mistaken for the human-confirmed value.
 */
export const ResponseClassificationAIOutputSchema = z.object({
  suggestedClassification: CandidateResponseClassification,
  /** 0-1 confidence in suggestedClassification; lower for ambiguous/mixed-signal replies. */
  confidence: z.number().min(0).max(1),
  /** Short, evidence-grounded rationale quoting/paraphrasing the reply — never a fabricated justification. */
  rationale: z.string().min(1).max(1000),
})
export type ResponseClassificationAIOutput = z.infer<typeof ResponseClassificationAIOutputSchema>

/** Never throws — same discriminated-result convention as validateMatchingOutput. */
export function validateResponseClassificationOutput(
  rawOutput: unknown,
): { valid: true; output: ResponseClassificationAIOutput } | { valid: false; issues: string[] } {
  const result = ResponseClassificationAIOutputSchema.safeParse(rawOutput)
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
