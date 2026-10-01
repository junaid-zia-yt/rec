import 'server-only'
import type { RequirementExtractionOutput } from '@rqi/types'
import { anthropicConfigured } from '@/lib/env'
import { createAnthropicProvider } from './anthropic-provider'
import {
  REQUIREMENT_EXTRACTION_PROMPT_VERSION,
  REQUIREMENT_EXTRACTION_SYSTEM_PROMPT,
} from './prompt'
import {
  AIProviderError,
  validateExtractionOutput,
  type AIProvider,
  type TrustedJobMetadata,
} from './provider'

/**
 * Everything a caller (the requirement-extraction server action, task #23)
 * needs to write one complete `ai_runs` row and, on success, the resulting
 * `job_requirements` rows — never less than the full record required by
 * Build Phase 4 brief §"AI operations" ("Model and prompt version
 * recording", "Cost/token metadata") and §AI WORKFLOW step 7 ("Store the
 * complete AI-run record") REGARDLESS of outcome. A `not_configured` result
 * never calls the model at all and is not itself an ai_runs row — the
 * caller renders the UI's "AI processing is not available" state instead
 * (Build Phase 4 brief: "Do not fake a successful live integration").
 */
export interface ExtractionOutcome {
  status: 'success' | 'error' | 'rejected_by_validation' | 'not_configured'
  provider: string | null
  model: string | null
  promptVersion: string
  rawOutput: unknown
  validated: RequirementExtractionOutput | null
  /** Always a safe, non-sensitive message — never a raw provider exception. */
  errorMessage: string | null
  inputTokens: number | null
  outputTokens: number | null
  costUsd: number | null
  latencyMs: number
  /** True when a first invalid response triggered exactly one retry (docs/09-ai-architecture.md retry-once-then-failed_validation policy). */
  retried: boolean
}

/**
 * Runs the requirement-extraction AI workflow end to end (Build Phase 4
 * brief §AI WORKFLOW steps 1-7): builds the trust-boundary-respecting
 * prompt, calls the provider, validates the structured output with Zod, and
 * retries exactly once on a validation failure before giving up. Never
 * writes to the database itself — persistence (the `ai_runs` row, and, on
 * success, human-reviewable `job_requirements` rows) is the caller's job,
 * kept separate so this function stays a pure orchestration/validation
 * layer that a test can call without a database.
 *
 * `provider` is only ever supplied by a test (the deterministic
 * TestAIProvider) — the live path always resolves the real
 * AnthropicProvider, gated by `anthropicConfigured`, and returns
 * `not_configured` without ever constructing a provider when that flag is
 * false, so a missing key can never fall through to a substitute.
 */
export async function runRequirementExtraction(params: {
  jobMetadata: TrustedJobMetadata
  documentText: string
  provider?: AIProvider
}): Promise<ExtractionOutcome> {
  const provider = params.provider ?? (anthropicConfigured ? createAnthropicProvider() : null)

  if (!provider) {
    return {
      status: 'not_configured',
      provider: null,
      model: null,
      promptVersion: REQUIREMENT_EXTRACTION_PROMPT_VERSION,
      rawOutput: null,
      validated: null,
      errorMessage:
        'AI requirement extraction is not available: no Anthropic API key is configured.',
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      latencyMs: 0,
      retried: false,
    }
  }

  const request = {
    jobMetadata: params.jobMetadata,
    documentText: params.documentText,
    promptVersion: REQUIREMENT_EXTRACTION_PROMPT_VERSION,
    promptTemplate: REQUIREMENT_EXTRACTION_SYSTEM_PROMPT,
  }

  const startedAt = Date.now()

  const attempt = async () => {
    try {
      const call = await provider.callExtraction(request)
      return { call, error: null as AIProviderError | null }
    } catch (error) {
      if (error instanceof AIProviderError) {
        return { call: null, error }
      }
      return {
        call: null,
        error: new AIProviderError(
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
      promptVersion: REQUIREMENT_EXTRACTION_PROMPT_VERSION,
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

  const firstValidation = validateExtractionOutput(first.call!.rawOutput)
  if (firstValidation.valid) {
    return {
      status: 'success',
      provider: provider.name,
      model: first.call!.model,
      promptVersion: REQUIREMENT_EXTRACTION_PROMPT_VERSION,
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
  // architecture.md). A transport-level error on the retry itself still
  // reports as the retry's own `error` status, distinct from
  // `rejected_by_validation`, so a caller can tell "the model produced bad
  // JSON twice" apart from "the network failed on the second try".
  const second = await attempt()
  if (second.error) {
    return {
      status: 'error',
      provider: provider.name,
      model: null,
      promptVersion: REQUIREMENT_EXTRACTION_PROMPT_VERSION,
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

  const secondValidation = validateExtractionOutput(second.call!.rawOutput)
  if (secondValidation.valid) {
    return {
      status: 'success',
      provider: provider.name,
      model: second.call!.model,
      promptVersion: REQUIREMENT_EXTRACTION_PROMPT_VERSION,
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
    promptVersion: REQUIREMENT_EXTRACTION_PROMPT_VERSION,
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
