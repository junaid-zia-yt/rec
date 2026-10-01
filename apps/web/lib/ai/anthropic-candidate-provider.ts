import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { env, anthropicConfigured } from '@/lib/env'
import {
  CANDIDATE_EXTRACTION_SYSTEM_PROMPT,
  buildCandidateExtractionUserMessage,
} from './candidate-prompt'
import { AIProviderError, type AIProviderCallResult } from './provider'
import type { CandidateAIExtractionRequest, CandidateAIProvider } from './candidate-provider'

/** claude-sonnet-5 per this session's model configuration (docs/09-ai-architecture.md: the exact model in use is always recorded on candidate_document_processing_jobs, never assumed). */
const EXTRACTION_MODEL = 'claude-sonnet-5'
const MAX_OUTPUT_TOKENS = 8000
const REQUEST_TIMEOUT_MS = 60_000

/** A scalar field wrapped with its own evidence — every optional/uncertain fact in the schema follows this exact shape. Shared here so the tool schema below stays readable. */
const scalarFieldSchema = (valueType: 'string') => ({
  type: 'object' as const,
  properties: {
    value: { type: [valueType, 'null'] as unknown as 'string' },
    hasEvidence: { type: 'boolean' as const },
    sourceExcerpt: { type: ['string', 'null'] as unknown as 'string' },
    sourceLocation: { type: ['string', 'null'] as unknown as 'string' },
    confidence: { type: ['number', 'null'] as unknown as 'number', minimum: 0, maximum: 1 },
  },
  required: ['value', 'hasEvidence', 'sourceExcerpt', 'sourceLocation', 'confidence'],
})

const evidenceFields = {
  sourceExcerpt: { type: 'string' as const, description: 'Verbatim quote from the document' },
  sourceLocation: { type: ['string', 'null'] as unknown as 'string' },
  confidence: { type: 'number' as const, minimum: 0, maximum: 1 },
}

/**
 * The candidate-extraction output forced via Anthropic tool-use, mirroring
 * @rqi/types' CandidateExtractionOutputSchema field-for-field. Anthropic's
 * SDK takes a plain JSON Schema for a tool's input_schema, not a Zod schema
 * directly, so this is hand-maintained in lock-step with that Zod schema —
 * see lib/ai/candidate-provider.ts's validateCandidateExtractionOutput,
 * which is the actual source of truth the model's output is checked
 * against after the call (same pattern as lib/ai/anthropic-provider.ts's
 * EXTRACTION_TOOL_SCHEMA for job requirements).
 */
const CANDIDATE_EXTRACTION_TOOL_NAME = 'submit_candidate_extraction'
const CANDIDATE_EXTRACTION_TOOL_SCHEMA = {
  name: CANDIDATE_EXTRACTION_TOOL_NAME,
  description: 'Submit the structured candidate CV extraction result.',
  input_schema: {
    type: 'object' as const,
    properties: {
      fullName: scalarFieldSchema('string'),
      contactDetails: {
        type: 'array' as const,
        maxItems: 10,
        items: {
          type: 'object' as const,
          properties: {
            type: { type: 'string' as const, enum: ['email', 'phone', 'linkedin', 'other'] },
            value: { type: 'string' as const },
            ...evidenceFields,
          },
          required: ['type', 'value', 'sourceExcerpt', 'sourceLocation', 'confidence'],
        },
      },
      location: scalarFieldSchema('string'),
      currentTitle: scalarFieldSchema('string'),
      currentCompany: scalarFieldSchema('string'),
      employmentHistory: {
        type: 'array' as const,
        maxItems: 40,
        items: {
          type: 'object' as const,
          properties: {
            company: { type: 'string' as const },
            title: { type: 'string' as const },
            startDate: { type: ['string', 'null'] as unknown as 'string' },
            endDate: { type: ['string', 'null'] as unknown as 'string' },
            isCurrent: { type: 'boolean' as const },
            responsibilities: {
              type: 'array' as const,
              maxItems: 30,
              items: { type: 'string' as const },
            },
            ...evidenceFields,
          },
          required: [
            'company',
            'title',
            'startDate',
            'endDate',
            'isCurrent',
            'responsibilities',
            'sourceExcerpt',
            'sourceLocation',
            'confidence',
          ],
        },
      },
      skills: {
        type: 'array' as const,
        maxItems: 60,
        items: {
          type: 'object' as const,
          properties: { skillName: { type: 'string' as const }, ...evidenceFields },
          required: ['skillName', 'sourceExcerpt', 'sourceLocation', 'confidence'],
        },
      },
      education: {
        type: 'array' as const,
        maxItems: 20,
        items: {
          type: 'object' as const,
          properties: {
            institution: { type: 'string' as const },
            degree: { type: ['string', 'null'] as unknown as 'string' },
            fieldOfStudy: { type: ['string', 'null'] as unknown as 'string' },
            startDate: { type: ['string', 'null'] as unknown as 'string' },
            endDate: { type: ['string', 'null'] as unknown as 'string' },
            ...evidenceFields,
          },
          required: [
            'institution',
            'degree',
            'fieldOfStudy',
            'startDate',
            'endDate',
            'sourceExcerpt',
            'sourceLocation',
            'confidence',
          ],
        },
      },
      certifications: {
        type: 'array' as const,
        maxItems: 20,
        items: {
          type: 'object' as const,
          properties: {
            name: { type: 'string' as const },
            issuingBody: { type: ['string', 'null'] as unknown as 'string' },
            issuedDate: { type: ['string', 'null'] as unknown as 'string' },
            expiresDate: { type: ['string', 'null'] as unknown as 'string' },
            ...evidenceFields,
          },
          required: [
            'name',
            'issuingBody',
            'issuedDate',
            'expiresDate',
            'sourceExcerpt',
            'sourceLocation',
            'confidence',
          ],
        },
      },
      industryExposure: {
        type: 'array' as const,
        maxItems: 15,
        items: {
          type: 'object' as const,
          properties: { industry: { type: 'string' as const }, ...evidenceFields },
          required: ['industry', 'sourceExcerpt', 'sourceLocation', 'confidence'],
        },
      },
      leadershipScope: scalarFieldSchema('string'),
      pnlResponsibility: scalarFieldSchema('string'),
      workAuthorization: scalarFieldSchema('string'),
      compensation: scalarFieldSchema('string'),
      availability: scalarFieldSchema('string'),
      unresolvedNotes: { type: 'array' as const, maxItems: 20, items: { type: 'string' as const } },
    },
    required: [
      'fullName',
      'contactDetails',
      'location',
      'currentTitle',
      'currentCompany',
      'employmentHistory',
      'skills',
      'education',
      'certifications',
      'industryExposure',
      'leadershipScope',
      'pnlResponsibility',
      'workAuthorization',
      'compensation',
      'availability',
      'unresolvedNotes',
    ],
  },
}

/**
 * Real, live Anthropic-backed provider for candidate CV parsing. Only ever
 * constructed/called when `anthropicConfigured` is true (checked by the
 * caller in lib/ai/parse-candidate-document.ts, and defensively again here)
 * — this repo's environment has no `ANTHROPIC_API_KEY` set, so this class
 * has never been exercised against the real API here. Its behavior is
 * verified instead via lib/ai/candidate-test-adapter.ts, which implements
 * the identical CandidateAIProvider interface deterministically for the
 * test suite.
 */
export class AnthropicCandidateProvider implements CandidateAIProvider {
  readonly name = 'anthropic'
  private readonly client: Anthropic

  constructor() {
    if (!anthropicConfigured) {
      throw new AIProviderError('Anthropic API key is not configured', 'not_configured')
    }
    this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: REQUEST_TIMEOUT_MS })
  }

  async callCandidateExtraction(
    request: CandidateAIExtractionRequest,
  ): Promise<AIProviderCallResult> {
    const startedAt = Date.now()
    try {
      const response = await this.client.messages.create({
        model: EXTRACTION_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: request.promptTemplate,
        messages: [
          { role: 'user', content: buildCandidateExtractionUserMessage(request.documentText) },
        ],
        tools: [CANDIDATE_EXTRACTION_TOOL_SCHEMA],
        tool_choice: { type: 'tool', name: CANDIDATE_EXTRACTION_TOOL_NAME },
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
        // table (never hardcoded here) — left null when the orchestration
        // layer doesn't supply one, same as lib/ai/anthropic-provider.ts.
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
      // Never surface the raw provider exception message — it may echo CV
      // content back (Build Phase 6 brief §SECURITY: "Do not place raw CVs
      // in application logs").
      throw new AIProviderError('The AI provider returned an error', 'provider_error')
    }
  }
}

/** Construct the real provider only when configured; throws AIProviderError('not_configured') otherwise. */
export function createAnthropicCandidateProvider(): AnthropicCandidateProvider {
  return new AnthropicCandidateProvider()
}
