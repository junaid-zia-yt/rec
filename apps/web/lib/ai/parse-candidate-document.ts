import 'server-only'
import type { CandidateExtractionOutput } from '@rqi/types'
import { anthropicConfigured } from '@/lib/env'
import { createAnthropicCandidateProvider } from './anthropic-candidate-provider'
import {
  CANDIDATE_EXTRACTION_PROMPT_VERSION,
  CANDIDATE_EXTRACTION_SYSTEM_PROMPT,
} from './candidate-prompt'
import { validateCandidateExtractionOutput, type CandidateAIProvider } from './candidate-provider'
import { AIProviderError } from './provider'

/**
 * Everything a caller (the processing-job server action, task #41) needs to
 * write one complete `candidate_document_processing_jobs` row REGARDLESS of
 * outcome (Build Phase 6 brief §SECURITY: "Record model and prompt
 * versions", §AI PIPELINE step 9: "Present results for human review" — even
 * a failed run must be recorded and shown, never silently dropped). A
 * `not_configured` result never calls the model at all and instead drives
 * the UI's "AI processing is not available" state (mirrors
 * lib/ai/extract-requirements.ts's ExtractionOutcome exactly — same
 * contract, candidate-specific payload).
 */
export interface CandidateExtractionOutcome {
  status: 'success' | 'error' | 'rejected_by_validation' | 'not_configured'
  provider: string | null
  model: string | null
  promptVersion: string
  rawOutput: unknown
  validated: CandidateExtractionOutput | null
  /** Always a safe, non-sensitive message — never a raw provider exception, and never CV content (Build Phase 6 brief §SECURITY: "Do not place raw CVs in application logs"). */
  errorMessage: string | null
  inputTokens: number | null
  outputTokens: number | null
  costUsd: number | null
  latencyMs: number
  /** True when a first invalid response triggered exactly one retry (Build Phase 6 brief §SECURITY: "Use bounded retries"). */
  retried: boolean
}

/**
 * Runs the candidate CV-parsing AI workflow end to end (Build Phase 6
 * brief §AI PIPELINE steps 6-7): builds the trust-boundary-respecting
 * prompt, calls the provider, validates the structured output with Zod, and
 * retries exactly once on a validation failure before giving up — the same
 * bounded-retry policy as lib/ai/extract-requirements.ts. Never writes to
 * the database itself — persistence (the `candidate_document_processing_jobs`
 * row and, on success, `candidate_extracted_fields` rows) is the caller's
 * job, kept separate so this function stays a pure orchestration/validation
 * layer a test can call without a database.
 *
 * `provider` is only ever supplied by a test (the deterministic
 * TestCandidateAIProvider) — the live path always resolves the real
 * AnthropicCandidateProvider, gated by `anthropicConfigured`, and returns
 * `not_configured` without ever constructing a provider when that flag is
 * false, so a missing key can never fall through to a substitute.
 */
export async function runCandidateDocumentExtraction(params: {
  documentText: string
  provider?: CandidateAIProvider
}): Promise<CandidateExtractionOutcome> {
  const provider =
    params.provider ?? (anthropicConfigured ? createAnthropicCandidateProvider() : null)

  if (!provider) {
    return {
      status: 'not_configured',
      provider: null,
      model: null,
      promptVersion: CANDIDATE_EXTRACTION_PROMPT_VERSION,
      rawOutput: null,
      validated: null,
      errorMessage: 'AI CV parsing is not available: no Anthropic API key is configured.',
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      latencyMs: 0,
      retried: false,
    }
  }

  const request = {
    documentText: params.documentText,
    promptVersion: CANDIDATE_EXTRACTION_PROMPT_VERSION,
    promptTemplate: CANDIDATE_EXTRACTION_SYSTEM_PROMPT,
  }

  const startedAt = Date.now()

  const attempt = async () => {
    try {
      const call = await provider.callCandidateExtraction(request)
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
      promptVersion: CANDIDATE_EXTRACTION_PROMPT_VERSION,
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

  const firstValidation = validateCandidateExtractionOutput(first.call!.rawOutput)
  if (firstValidation.valid) {
    return {
      status: 'success',
      provider: provider.name,
      model: first.call!.model,
      promptVersion: CANDIDATE_EXTRACTION_PROMPT_VERSION,
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

  // Retry exactly once on invalid structured output (Build Phase 6 brief
  // §SECURITY: "Use bounded retries"). A transport-level error on the retry
  // itself still reports as the retry's own `error` status, distinct from
  // `rejected_by_validation`, matching lib/ai/extract-requirements.ts.
  const second = await attempt()
  if (second.error) {
    return {
      status: 'error',
      provider: provider.name,
      model: null,
      promptVersion: CANDIDATE_EXTRACTION_PROMPT_VERSION,
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

  const secondValidation = validateCandidateExtractionOutput(second.call!.rawOutput)
  if (secondValidation.valid) {
    return {
      status: 'success',
      provider: provider.name,
      model: second.call!.model,
      promptVersion: CANDIDATE_EXTRACTION_PROMPT_VERSION,
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
    promptVersion: CANDIDATE_EXTRACTION_PROMPT_VERSION,
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
