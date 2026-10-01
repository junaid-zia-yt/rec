import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { env, anthropicConfigured } from '@/lib/env'
import { REQUIREMENT_EXTRACTION_SYSTEM_PROMPT, buildExtractionUserMessage } from './prompt'
import {
  AIProviderError,
  type AIExtractionRequest,
  type AIProviderCallResult,
  type AIProvider,
} from './provider'

/** claude-sonnet-5 per this session's model configuration (docs/09-ai-architecture.md: the exact model in use is always recorded on ai_runs, never assumed). */
const EXTRACTION_MODEL = 'claude-sonnet-5'
const MAX_OUTPUT_TOKENS = 8000
const REQUEST_TIMEOUT_MS = 60_000

/**
 * The extraction output forced via Anthropic tool-use, mirroring
 * @rqi/types' RequirementExtractionOutputSchema field-for-field. Anthropic's
 * SDK takes a plain JSON Schema for a tool's input_schema, not a Zod schema
 * directly, so this is hand-maintained in lock-step with that Zod schema —
 * see lib/ai/provider.ts's validateExtractionOutput, which is the actual
 * source of truth the model's output is checked against after the call.
 */
const EXTRACTION_TOOL_NAME = 'submit_extracted_requirements'
const EXTRACTION_TOOL_SCHEMA = {
  name: EXTRACTION_TOOL_NAME,
  description: 'Submit the structured job-requirement extraction result.',
  input_schema: {
    type: 'object' as const,
    properties: {
      requirements: {
        type: 'array' as const,
        maxItems: 60,
        items: {
          type: 'object' as const,
          properties: {
            name: { type: 'string' as const },
            description: { type: 'string' as const },
            category: { type: 'string' as const },
            type: {
              type: 'string' as const,
              enum: [
                'mandatory',
                'preferred',
                'informational',
                'disqualifying',
                'requires_clarification',
              ],
            },
            weight: {
              type: ['number', 'null'] as unknown as 'number',
              description: '0-100, preferred only, else null',
            },
            evidenceExpected: { type: 'string' as const },
            sourceText: {
              type: 'string' as const,
              description: 'Verbatim quote from the document',
            },
            sourceLocation: { type: ['string', 'null'] as unknown as 'string' },
            confidence: { type: 'number' as const, minimum: 0, maximum: 1 },
          },
          required: [
            'name',
            'description',
            'category',
            'type',
            'weight',
            'evidenceExpected',
            'sourceText',
            'sourceLocation',
            'confidence',
          ],
        },
      },
      unresolvedNotes: {
        type: 'array' as const,
        maxItems: 20,
        items: { type: 'string' as const },
      },
    },
    required: ['requirements', 'unresolvedNotes'],
  },
}

/**
 * Real, live Anthropic-backed provider. Only ever constructed/called when
 * `anthropicConfigured` is true (checked by the caller in
 * extract-requirements.ts, and defensively again here) — this repo's
 * environment has no `ANTHROPIC_API_KEY` set, so this class has never been
 * exercised against the real API here. Its behavior is verified instead via
 * lib/ai/test-adapter.ts, which implements the identical AIProvider
 * interface deterministically for the test suite.
 */
export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic'
  private readonly client: Anthropic

  constructor() {
    if (!anthropicConfigured) {
      throw new AIProviderError('Anthropic API key is not configured', 'not_configured')
    }
    this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: REQUEST_TIMEOUT_MS })
  }

  async callExtraction(request: AIExtractionRequest): Promise<AIProviderCallResult> {
    const startedAt = Date.now()
    try {
      const response = await this.client.messages.create({
        model: EXTRACTION_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: request.promptTemplate,
        messages: [
          {
            role: 'user',
            content: buildExtractionUserMessage(request.jobMetadata, request.documentText),
          },
        ],
        tools: [EXTRACTION_TOOL_SCHEMA],
        tool_choice: { type: 'tool', name: EXTRACTION_TOOL_NAME },
      })

      const toolUse = response.content.find(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
      )

      return {
        model: response.model,
        rawOutput: toolUse?.input ?? null,
        inputTokens: response.usage?.input_tokens ?? null,
        outputTokens: response.usage?.output_tokens ?? null,
        // Cost is computed by the caller from a versioned per-model rate
        // table (never hardcoded here, since Anthropic pricing changes
        // independently of this file) — left null when the orchestration
        // layer doesn't supply one.
        costUsd: null,
        latencyMs: Date.now() - startedAt,
      }
    } catch (error) {
      if (error instanceof Anthropic.APIConnectionTimeoutError) {
        throw new AIProviderError('The AI extraction request timed out', 'timeout')
      }
      if (error instanceof Anthropic.APIConnectionError) {
        throw new AIProviderError('Could not reach the AI provider', 'network')
      }
      // Never surface the raw provider exception message — it may contain
      // request internals — Build Phase 4 brief §"AI operations": "Safe
      // error messages... No sensitive prompt logging outside protected
      // storage".
      throw new AIProviderError('The AI provider returned an error', 'provider_error')
    }
  }
}

/** Construct the real provider only when configured; throws AIProviderError('not_configured') otherwise, matching validateExtractionOutput's never-throw-on-bad-data contract by being the one place that DOES throw for a genuine precondition failure. */
export function createAnthropicProvider(): AnthropicProvider {
  return new AnthropicProvider()
}
