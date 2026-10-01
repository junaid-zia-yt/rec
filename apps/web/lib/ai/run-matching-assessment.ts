import 'server-only'
import type { CandidateMatchAIOutput } from '@rqi/types'
import { anthropicConfigured } from '@/lib/env'
import { createAnthropicMatchingProvider } from './anthropic-matching-provider'
import {
  MATCHING_ASSESSMENT_PROMPT_VERSION,
  MATCHING_ASSESSMENT_SYSTEM_PROMPT,
} from './matching-prompt'
import {
  MatchingAIProviderError,
  validateMatchingOutput,
  type CandidateEvidenceBundleItem,
  type MatchingAIProvider,
  type TrustedMatchingContext,
} from './matching-provider'

/**
 * Everything the matching pipeline (apps/web/lib/matching/matching-
 * pipeline.ts) needs to write one complete `ai_runs` row and, on success,
 * feed the deterministic gate/scoring engine — mirrors
 * lib/ai/extract-requirements.ts's ExtractionOutcome/runRequirementExtraction
 * pattern exactly, including the not_configured / retry-once-on-invalid-
 * output / rejected_by_validation state machine (docs/09-ai-architecture.md
 * §9.4).
 */
export interface MatchingAssessmentOutcome {
  status: 'success' | 'error' | 'rejected_by_validation' | 'not_configured'
  provider: string | null
  model: string | null
  promptVersion: string
  rawOutput: unknown
  validated: CandidateMatchAIOutput | null
  errorMessage: string | null
  inputTokens: number | null
  outputTokens: number | null
  costUsd: number | null
  latencyMs: number
  retried: boolean
}

/**
 * Runs the candidate-matching semantic-assist AI workflow end to end
 * (Build Phase 7 brief pipeline steps 5-7: retrieve evidence [done by the
 * caller before this is invoked], call the AI, validate, retry once).
 * Never writes to the database itself — persistence is the caller's job.
 *
 * `provider` is only ever supplied by a test (TestMatchingAIProvider) — the
 * live path always resolves the real AnthropicMatchingProvider, gated by
 * `anthropicConfigured`, and returns `not_configured` without ever
 * constructing a provider when that flag is false.
 */
export async function runMatchingAssessment(params: {
  trustedContext: TrustedMatchingContext
  candidateEvidence: CandidateEvidenceBundleItem[]
  provider?: MatchingAIProvider
}): Promise<MatchingAssessmentOutcome> {
  const provider =
    params.provider ?? (anthropicConfigured ? createAnthropicMatchingProvider() : null)

  if (!provider) {
    return {
      status: 'not_configured',
      provider: null,
      model: null,
      promptVersion: MATCHING_ASSESSMENT_PROMPT_VERSION,
      rawOutput: null,
      validated: null,
      errorMessage: 'AI candidate matching is not available: no Anthropic API key is configured.',
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      latencyMs: 0,
      retried: false,
    }
  }

  const request = {
    trustedContext: params.trustedContext,
    candidateEvidence: params.candidateEvidence,
    promptVersion: MATCHING_ASSESSMENT_PROMPT_VERSION,
    promptTemplate: MATCHING_ASSESSMENT_SYSTEM_PROMPT,
  }

  const startedAt = Date.now()

  const attempt = async () => {
    try {
      const call = await provider.assessMatch(request)
      return { call, error: null as MatchingAIProviderError | null }
    } catch (error) {
      if (error instanceof MatchingAIProviderError) {
        return { call: null, error }
      }
      return {
        call: null,
        error: new MatchingAIProviderError(
          'The AI provider returned an unexpected error',
          'provider_error',
        ),
      }
    }
  }

  const first = await attempt()
  if (first.error) {
    return {
      status: 'error',
      provider: provider.name,
      model: null,
      promptVersion: MATCHING_ASSESSMENT_PROMPT_VERSION,
      rawOutput: null,
      validated: null,
      errorMessage: first.error.message,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      latencyMs: Date.now() - startedAt,
      retried: false,
    }
  }

  const firstValidation = validateMatchingOutput(first.call!.rawOutput)
  if (firstValidation.valid) {
    return {
      status: 'success',
      provider: provider.name,
      model: first.call!.model,
      promptVersion: MATCHING_ASSESSMENT_PROMPT_VERSION,
      rawOutput: first.call!.rawOutput,
      validated: firstValidation.output,
      errorMessage: null,
      inputTokens: first.call!.inputTokens,
      outputTokens: first.call!.outputTokens,
      costUsd: first.call!.costUsd,
      latencyMs: Date.now() - startedAt,
      retried: false,
    }
  }

  // Retry exactly once on invalid structured output (docs/09-ai-
  // architecture.md §9.4), same policy as every other AI workflow in this
  // codebase.
  const second = await attempt()
  if (second.error) {
    return {
      status: 'error',
      provider: provider.name,
      model: null,
      promptVersion: MATCHING_ASSESSMENT_PROMPT_VERSION,
      rawOutput: first.call!.rawOutput,
      validated: null,
      errorMessage: second.error.message,
      inputTokens: first.call!.inputTokens,
      outputTokens: first.call!.outputTokens,
      costUsd: first.call!.costUsd,
      latencyMs: Date.now() - startedAt,
      retried: true,
    }
  }

  const secondValidation = validateMatchingOutput(second.call!.rawOutput)
  if (secondValidation.valid) {
    return {
      status: 'success',
      provider: provider.name,
      model: second.call!.model,
      promptVersion: MATCHING_ASSESSMENT_PROMPT_VERSION,
      rawOutput: second.call!.rawOutput,
      validated: secondValidation.output,
      errorMessage: null,
      inputTokens: second.call!.inputTokens,
      outputTokens: second.call!.outputTokens,
      costUsd: second.call!.costUsd,
      latencyMs: Date.now() - startedAt,
      retried: true,
    }
  }

  return {
    status: 'rejected_by_validation',
    provider: provider.name,
    model: second.call!.model,
    promptVersion: MATCHING_ASSESSMENT_PROMPT_VERSION,
    rawOutput: second.call!.rawOutput,
    validated: null,
    errorMessage: `AI output failed structured-schema validation twice: ${secondValidation.issues.slice(0, 5).join('; ')}`,
    inputTokens: second.call!.inputTokens,
    outputTokens: second.call!.outputTokens,
    costUsd: second.call!.costUsd,
    latencyMs: Date.now() - startedAt,
    retried: true,
  }
}
