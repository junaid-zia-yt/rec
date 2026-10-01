import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { env, anthropicConfigured } from '@/lib/env'
import { buildOutreachDraftUserMessage } from './outreach-draft-prompt'
import {
  OutreachDraftAIProviderError,
  type OutreachDraftAIProvider,
  type OutreachDraftAIProviderCallResult,
  type OutreachDraftAIRequest,
} from './outreach-draft-provider'

/** claude-sonnet-5 per this session's model configuration (docs/09-ai-architecture.md: the exact model in use is always recorded, never assumed). */
const OUTREACH_DRAFT_MODEL = 'claude-sonnet-5'
const MAX_OUTPUT_TOKENS = 4000
const REQUEST_TIMEOUT_MS = 60_000

const evidenceRefSchema = {
  type: 'object' as const,
  properties: {
    sourceKind: {
      type: 'string' as const,
      enum: ['experience', 'education', 'certification', 'skill', 'extracted_field', 'profile'],
    },
    sourceId: { type: ['string', 'null'] as unknown as 'string' },
    claimText: { type: 'string' as const, maxLength: 500 },
    evidenceExcerpt: { type: 'string' as const, maxLength: 600 },
  },
  required: ['sourceKind', 'sourceId', 'claimText', 'evidenceExcerpt'],
}

/**
 * The outreach-draft output forced via Anthropic tool-use, mirroring
 * OutreachDraftAIOutputSchema field-for-field — hand-maintained in
 * lock-step with that Zod schema, same convention as
 * lib/ai/anthropic-matching-provider.ts.
 */
const OUTREACH_DRAFT_TOOL_NAME = 'submit_outreach_draft'
const OUTREACH_DRAFT_TOOL_SCHEMA = {
  name: OUTREACH_DRAFT_TOOL_NAME,
  description: 'Submit the drafted outreach message and its personalization evidence.',
  input_schema: {
    type: 'object' as const,
    properties: {
      subject: { type: ['string', 'null'] as unknown as 'string' },
      body: { type: 'string' as const, maxLength: 8000 },
      personalizationEvidence: { type: 'array' as const, maxItems: 20, items: evidenceRefSchema },
      wroteGenerically: { type: 'boolean' as const },
      unresolvedNotes: { type: 'array' as const, maxItems: 20, items: { type: 'string' as const } },
    },
    required: ['subject', 'body', 'personalizationEvidence', 'wroteGenerically', 'unresolvedNotes'],
  },
}

/**
 * Real, live Anthropic-backed outreach-draft provider. Only ever
 * constructed/called when `anthropicConfigured` is true (checked by the
 * caller in lib/ai/run-outreach-draft-generation.ts, and defensively again
 * here) — this repo's environment has no `ANTHROPIC_API_KEY` set, so this
 * class has never been exercised against the real API here. Its behavior is
 * verified instead via lib/ai/outreach-draft-test-adapter.ts.
 */
export class AnthropicOutreachDraftProvider implements OutreachDraftAIProvider {
  readonly name = 'anthropic'
  private readonly client: Anthropic

  constructor() {
    if (!anthropicConfigured) {
      throw new OutreachDraftAIProviderError(
        'Anthropic API key is not configured',
        'not_configured',
      )
    }
    this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: REQUEST_TIMEOUT_MS })
  }

  async generateDraft(request: OutreachDraftAIRequest): Promise<OutreachDraftAIProviderCallResult> {
    const startedAt = Date.now()
    try {
      const response = await this.client.messages.create({
        model: OUTREACH_DRAFT_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: request.promptTemplate,
        messages: [
          {
            role: 'user',
            content: buildOutreachDraftUserMessage(
              request.trustedContext,
              request.candidateEvidence,
            ),
          },
        ],
        tools: [OUTREACH_DRAFT_TOOL_SCHEMA],
        tool_choice: { type: 'tool', name: OUTREACH_DRAFT_TOOL_NAME },
      })

      const toolUse = response.content.find(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
      )

      return {
        model: response.model,
        rawOutput: toolUse?.input ?? null,
        inputTokens: response.usage?.input_tokens ?? null,
        outputTokens: response.usage?.output_tokens ?? null,
        costUsd: null,
        latencyMs: Date.now() - startedAt,
      }
    } catch (error) {
      if (error instanceof Anthropic.APIConnectionTimeoutError) {
        throw new OutreachDraftAIProviderError('The AI outreach draft request timed out', 'timeout')
      }
      if (error instanceof Anthropic.APIConnectionError) {
        throw new OutreachDraftAIProviderError('Could not reach the AI provider', 'network')
      }
      // Never surface the raw provider exception message — it could echo
      // candidate-evidence content back (same rule as the matching provider).
      throw new OutreachDraftAIProviderError('The AI provider returned an error', 'provider_error')
    }
  }
}

/** Construct the real provider only when configured; throws OutreachDraftAIProviderError('not_configured') otherwise. */
export function createAnthropicOutreachDraftProvider(): AnthropicOutreachDraftProvider {
  return new AnthropicOutreachDraftProvider()
}
