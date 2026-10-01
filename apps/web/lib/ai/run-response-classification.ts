import 'server-only'
import { anthropicConfigured } from '@/lib/env'
import { createAnthropicResponseClassificationProvider } from './anthropic-response-classification-provider'
import {
  RESPONSE_CLASSIFICATION_PROMPT_VERSION,
  RESPONSE_CLASSIFICATION_SYSTEM_PROMPT,
} from './response-classification-prompt'
import {
  ResponseClassificationAIProviderError,
  validateResponseClassificationOutput,
  type ResponseClassificationAIOutput,
  type ResponseClassificationAIProvider,
  type TrustedResponseClassificationContext,
} from './response-classification-provider'

/**
 * Everything the response-classification workflow needs to write one
 * complete `ai_runs` row — mirrors lib/ai/run-matching-assessment.ts's
 * MatchingAssessmentOutcome/runMatchingAssessment pattern exactly,
 * including the not_configured / retry-once-on-invalid-output / rejected_
 * by_validation state machine (docs/09-ai-architecture.md §9.4).
 *
 * This function is a PURE INFERENCE call. It never reads or writes
 * candidate_responses or any other table — wiring `validated.
 * suggestedClassification` into candidate_responses.ai_suggested_
 * classification is explicitly the next wave's server-action job. Nothing
 * this function returns is ever the authoritative classification; only a
 * human-confirmed value (candidate_responses.confirmed_classification) can
 * be that, and only that field can ever trigger the opt-out hard gate.
 */
export interface ResponseClassificationOutcome {
  status: 'success' | 'error' | 'rejected_by_validation' | 'not_configured'
  provider: string | null
  model: string | null
  promptVersion: string
  rawOutput: unknown
  validated: ResponseClassificationAIOutput | null
  errorMessage: string | null
  inputTokens: number | null
  outputTokens: number | null
  costUsd: number | null
  latencyMs: number
  retried: boolean
}

/**
 * `provider` is only ever supplied by a test (TestResponseClassificationAIProvider)
 * — the live path always resolves the real
 * AnthropicResponseClassificationProvider, gated by `anthropicConfigured`,
 * and returns `not_configured` without ever constructing a provider when
 * that flag is false.
 */
export async function runResponseClassification(params: {
  trustedContext: TrustedResponseClassificationContext
  rawResponseText: string
  provider?: ResponseClassificationAIProvider
}): Promise<ResponseClassificationOutcome> {
  const provider =
    params.provider ??
    (anthropicConfigured ? createAnthropicResponseClassificationProvider() : null)

  if (!provider) {
    return {
      status: 'not_configured',
      provider: null,
      model: null,
      promptVersion: RESPONSE_CLASSIFICATION_PROMPT_VERSION,
      rawOutput: null,
      validated: null,
      errorMessage:
        'AI response classification is not available: no Anthropic API key is configured.',
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      latencyMs: 0,
      retried: false,
    }
  }

  const request = {
    trustedContext: params.trustedContext,
    rawResponseText: params.rawResponseText,
    promptVersion: RESPONSE_CLASSIFICATION_PROMPT_VERSION,
    promptTemplate: RESPONSE_CLASSIFICATION_SYSTEM_PROMPT,
  }

  const startedAt = Date.now()

  const attempt = async () => {
    try {
      const call = await provider.classifyResponse(request)
      return { call, error: null as ResponseClassificationAIProviderError | null }
    } catch (error) {
      if (error instanceof ResponseClassificationAIProviderError) {
        return { call: null, error }
      }
      return {
        call: null,
        error: new ResponseClassificationAIProviderError(
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
      promptVersion: RESPONSE_CLASSIFICATION_PROMPT_VERSION,
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

  const firstValidation = validateResponseClassificationOutput(first.call!.rawOutput)
  if (firstValidation.valid) {
    return {
      status: 'success',
      provider: provider.name,
      model: first.call!.model,
      promptVersion: RESPONSE_CLASSIFICATION_PROMPT_VERSION,
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
      promptVersion: RESPONSE_CLASSIFICATION_PROMPT_VERSION,
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

  const secondValidation = validateResponseClassificationOutput(second.call!.rawOutput)
  if (secondValidation.valid) {
    return {
      status: 'success',
      provider: provider.name,
      model: second.call!.model,
      promptVersion: RESPONSE_CLASSIFICATION_PROMPT_VERSION,
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
    promptVersion: RESPONSE_CLASSIFICATION_PROMPT_VERSION,
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
