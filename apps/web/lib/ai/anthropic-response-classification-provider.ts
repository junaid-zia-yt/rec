import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { env, anthropicConfigured } from '@/lib/env'
import { buildResponseClassificationUserMessage } from './response-classification-prompt'
import {
  ResponseClassificationAIProviderError,
  type ResponseClassificationAIProvider,
  type ResponseClassificationAIProviderCallResult,
  type ResponseClassificationAIRequest,
} from './response-classification-provider'

/** claude-sonnet-5 per this session's model configuration (docs/09-ai-architecture.md: the exact model in use is always recorded, never assumed). */
const RESPONSE_CLASSIFICATION_MODEL = 'claude-sonnet-5'
const MAX_OUTPUT_TOKENS = 1000
const REQUEST_TIMEOUT_MS = 30_000

/**
 * The response-classification output forced via Anthropic tool-use,
 * mirroring ResponseClassificationAIOutputSchema field-for-field —
 * hand-maintained in lock-step with that Zod schema, same convention as
 * lib/ai/anthropic-matching-provider.ts.
 */
const RESPONSE_CLASSIFICATION_TOOL_NAME = 'submit_response_classification'
const RESPONSE_CLASSIFICATION_TOOL_SCHEMA = {
  name: RESPONSE_CLASSIFICATION_TOOL_NAME,
  description: 'Submit the suggested classification for a candidate reply.',
  input_schema: {
    type: 'object' as const,
    properties: {
      suggestedClassification: {
        type: 'string' as const,
        enum: [
          'interested',
          'not_interested',
          'needs_more_info',
          'follow_up_later',
          'opt_out',
          'ambiguous',
        ],
      },
      confidence: { type: 'number' as const, minimum: 0, maximum: 1 },
      rationale: { type: 'string' as const, maxLength: 1000 },
    },
    required: ['suggestedClassification', 'confidence', 'rationale'],
  },
}

/**
 * Real, live Anthropic-backed response-classification provider. Only ever
 * constructed/called when `anthropicConfigured` is true (checked by the
 * caller in lib/ai/run-response-classification.ts, and defensively again
 * here) — this repo's environment has no `ANTHROPIC_API_KEY` set, so this
 * class has never been exercised against the real API here. Its behavior is
 * verified instead via lib/ai/response-classification-test-adapter.ts.
 */
export class AnthropicResponseClassificationProvider implements ResponseClassificationAIProvider {
  readonly name = 'anthropic'
  private readonly client: Anthropic

  constructor() {
    if (!anthropicConfigured) {
      throw new ResponseClassificationAIProviderError(
        'Anthropic API key is not configured',
        'not_configured',
      )
    }
    this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: REQUEST_TIMEOUT_MS })
  }

  async classifyResponse(
    request: ResponseClassificationAIRequest,
  ): Promise<ResponseClassificationAIProviderCallResult> {
    const startedAt = Date.now()
    try {
      const response = await this.client.messages.create({
        model: RESPONSE_CLASSIFICATION_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: request.promptTemplate,
        messages: [
          {
            role: 'user',
            content: buildResponseClassificationUserMessage(
              request.trustedContext,
              request.rawResponseText,
            ),
          },
        ],
        tools: [RESPONSE_CLASSIFICATION_TOOL_SCHEMA],
        tool_choice: { type: 'tool', name: RESPONSE_CLASSIFICATION_TOOL_NAME },
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
        throw new ResponseClassificationAIProviderError(
          'The AI response classification request timed out',
          'timeout',
        )
      }
      if (error instanceof Anthropic.APIConnectionError) {
        throw new ResponseClassificationAIProviderError(
          'Could not reach the AI provider',
          'network',
        )
      }
      // Never surface the raw provider exception message — it could echo
      // candidate reply content back (same rule as the matching provider).
      throw new ResponseClassificationAIProviderError(
        'The AI provider returned an error',
        'provider_error',
      )
    }
  }
}

/** Construct the real provider only when configured; throws ResponseClassificationAIProviderError('not_configured') otherwise. */
export function createAnthropicResponseClassificationProvider(): AnthropicResponseClassificationProvider {
  return new AnthropicResponseClassificationProvider()
}
