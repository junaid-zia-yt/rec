import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { env, anthropicConfigured } from '@/lib/env'
import { buildMatchingUserMessage } from './matching-prompt'
import {
  MatchingAIProviderError,
  type MatchingAIProvider,
  type MatchingAIProviderCallResult,
  type MatchingAIRequest,
} from './matching-provider'

/** claude-sonnet-5 per this session's model configuration (docs/09-ai-architecture.md: the exact model in use is always recorded, never assumed). */
const MATCHING_MODEL = 'claude-sonnet-5'
const MAX_OUTPUT_TOKENS = 8000
const REQUEST_TIMEOUT_MS = 60_000

const evidenceRefSchema = {
  type: 'object' as const,
  properties: {
    sourceKind: {
      type: 'string' as const,
      enum: ['experience', 'education', 'certification', 'skill', 'extracted_field', 'profile'],
    },
    sourceId: { type: ['string', 'null'] as unknown as 'string' },
    excerpt: { type: 'string' as const },
    location: { type: ['string', 'null'] as unknown as 'string' },
    isDirectStatement: { type: 'boolean' as const },
  },
  required: ['sourceKind', 'sourceId', 'excerpt', 'location', 'isDirectStatement'],
}

/**
 * The matching-assessment output forced via Anthropic tool-use, mirroring
 * @rqi/types' CandidateMatchAIOutputSchema field-for-field — hand-
 * maintained in lock-step with that Zod schema, same convention as
 * lib/ai/anthropic-provider.ts / lib/ai/anthropic-candidate-provider.ts.
 */
const MATCHING_ASSESSMENT_TOOL_NAME = 'submit_matching_assessment'
const MATCHING_ASSESSMENT_TOOL_SCHEMA = {
  name: MATCHING_ASSESSMENT_TOOL_NAME,
  description: 'Submit the structured per-requirement candidate-evidence assessment.',
  input_schema: {
    type: 'object' as const,
    properties: {
      assessments: {
        type: 'array' as const,
        maxItems: 60,
        items: {
          type: 'object' as const,
          properties: {
            requirementId: { type: 'string' as const },
            requirementType: { type: 'string' as const, enum: ['mandatory', 'preferred'] },
            relevanceScore: {
              type: ['number', 'null'] as unknown as 'number',
              minimum: 0,
              maximum: 1,
            },
            confidence: { type: ['number', 'null'] as unknown as 'number', minimum: 0, maximum: 1 },
            gateSuggestion: {
              type: ['string', 'null'] as unknown as 'string',
              enum: ['pass', 'fail', 'insufficient_evidence', null],
            },
            explanation: { type: 'string' as const, maxLength: 2000 },
            evidenceRefs: { type: 'array' as const, maxItems: 10, items: evidenceRefSchema },
            riskNotes: { type: 'array' as const, maxItems: 5, items: { type: 'string' as const } },
          },
          required: [
            'requirementId',
            'requirementType',
            'relevanceScore',
            'confidence',
            'gateSuggestion',
            'explanation',
            'evidenceRefs',
            'riskNotes',
          ],
        },
      },
      unresolvedNotes: { type: 'array' as const, maxItems: 20, items: { type: 'string' as const } },
    },
    required: ['assessments', 'unresolvedNotes'],
  },
}

/**
 * Real, live Anthropic-backed matching-assessment provider. Only ever
 * constructed/called when `anthropicConfigured` is true (checked by the
 * caller in lib/ai/run-matching-assessment.ts, and defensively again here)
 * — this repo's environment has no `ANTHROPIC_API_KEY` set, so this class
 * has never been exercised against the real API here. Its behavior is
 * verified instead via lib/ai/matching-test-adapter.ts.
 */
export class AnthropicMatchingProvider implements MatchingAIProvider {
  readonly name = 'anthropic'
  private readonly client: Anthropic

  constructor() {
    if (!anthropicConfigured) {
      throw new MatchingAIProviderError('Anthropic API key is not configured', 'not_configured')
    }
    this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: REQUEST_TIMEOUT_MS })
  }

  async assessMatch(request: MatchingAIRequest): Promise<MatchingAIProviderCallResult> {
    const startedAt = Date.now()
    try {
      const response = await this.client.messages.create({
        model: MATCHING_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: request.promptTemplate,
        messages: [
          {
            role: 'user',
            content: buildMatchingUserMessage(request.trustedContext, request.candidateEvidence),
          },
        ],
        tools: [MATCHING_ASSESSMENT_TOOL_SCHEMA],
        tool_choice: { type: 'tool', name: MATCHING_ASSESSMENT_TOOL_NAME },
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
        throw new MatchingAIProviderError('The AI matching request timed out', 'timeout')
      }
      if (error instanceof Anthropic.APIConnectionError) {
        throw new MatchingAIProviderError('Could not reach the AI provider', 'network')
      }
      // Never surface the raw provider exception message — it could echo
      // candidate-evidence content back (same rule as Build Phase 6's
      // "never log/leak raw CV content").
      throw new MatchingAIProviderError('The AI provider returned an error', 'provider_error')
    }
  }
}

/** Construct the real provider only when configured; throws MatchingAIProviderError('not_configured') otherwise. */
export function createAnthropicMatchingProvider(): AnthropicMatchingProvider {
  return new AnthropicMatchingProvider()
}
