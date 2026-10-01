import 'server-only'
import { anthropicConfigured } from '@/lib/env'
import { createAnthropicOutreachDraftProvider } from './anthropic-outreach-draft-provider'
import {
  OUTREACH_DRAFT_PROMPT_VERSION,
  OUTREACH_DRAFT_SYSTEM_PROMPT,
} from './outreach-draft-prompt'
import {
  OutreachDraftAIProviderError,
  validateOutreachDraftOutput,
  type OutreachDraftAIOutput,
  type OutreachDraftAIProvider,
  type OutreachEvidenceBundleItem,
  type TrustedOutreachContext,
} from './outreach-draft-provider'

/**
 * Everything the outreach pipeline needs to write one complete `ai_runs`
 * row and, on success, hand the draft to the deterministic unsupported-
 * claims validator (lib/outreach/unsupported-claims.ts) before persisting
 * it — mirrors lib/ai/run-matching-assessment.ts's
 * MatchingAssessmentOutcome/runMatchingAssessment pattern exactly, including
 * the not_configured / retry-once-on-invalid-output / rejected_by_
 * validation state machine (docs/09-ai-architecture.md §9.4).
 */
export interface OutreachDraftGenerationOutcome {
  status: 'success' | 'error' | 'rejected_by_validation' | 'not_configured'
  provider: string | null
  model: string | null
  promptVersion: string
  rawOutput: unknown
  validated: OutreachDraftAIOutput | null
  errorMessage: string | null
  inputTokens: number | null
  outputTokens: number | null
  costUsd: number | null
  latencyMs: number
  retried: boolean
}

/**
 * Runs the outreach-draft-generation AI workflow end to end (Build Phase 9
 * brief functional requirements #1/#2/#5). Never writes to the database
 * itself, and never checks opt-out/approval state — persistence and those
 * gates are the caller's/DB triggers' job. The caller MUST also run the
 * returned draft through lib/outreach/unsupported-claims.ts before
 * persisting it: schema validity here only proves the AI's OWN self-
 * reported evidence references are well-formed, not that they are real or
 * verified against the candidate's actual evidence bundle.
 *
 * `provider` is only ever supplied by a test (TestOutreachDraftAIProvider)
 * — the live path always resolves the real AnthropicOutreachDraftProvider,
 * gated by `anthropicConfigured`, and returns `not_configured` without ever
 * constructing a provider when that flag is false.
 */
export async function runOutreachDraftGeneration(params: {
  trustedContext: TrustedOutreachContext
  candidateEvidence: OutreachEvidenceBundleItem[]
  provider?: OutreachDraftAIProvider
}): Promise<OutreachDraftGenerationOutcome> {
  const provider =
    params.provider ?? (anthropicConfigured ? createAnthropicOutreachDraftProvider() : null)

  if (!provider) {
    return {
      status: 'not_configured',
      provider: null,
      model: null,
      promptVersion: OUTREACH_DRAFT_PROMPT_VERSION,
      rawOutput: null,
      validated: null,
      errorMessage: 'AI outreach drafting is not available: no Anthropic API key is configured.',
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
    promptVersion: OUTREACH_DRAFT_PROMPT_VERSION,
    promptTemplate: OUTREACH_DRAFT_SYSTEM_PROMPT,
  }

  const startedAt = Date.now()

  const attempt = async () => {
    try {
      const call = await provider.generateDraft(request)
      return { call, error: null as OutreachDraftAIProviderError | null }
    } catch (error) {
      if (error instanceof OutreachDraftAIProviderError) {
        return { call: null, error }
      }
      return {
        call: null,
        error: new OutreachDraftAIProviderError(
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
      promptVersion: OUTREACH_DRAFT_PROMPT_VERSION,
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

  const firstValidation = validateOutreachDraftOutput(first.call!.rawOutput)
  if (firstValidation.valid) {
    return {
      status: 'success',
      provider: provider.name,
      model: first.call!.model,
      promptVersion: OUTREACH_DRAFT_PROMPT_VERSION,
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
      promptVersion: OUTREACH_DRAFT_PROMPT_VERSION,
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

  const secondValidation = validateOutreachDraftOutput(second.call!.rawOutput)
  if (secondValidation.valid) {
    return {
      status: 'success',
      provider: provider.name,
      model: second.call!.model,
      promptVersion: OUTREACH_DRAFT_PROMPT_VERSION,
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
    promptVersion: OUTREACH_DRAFT_PROMPT_VERSION,
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
