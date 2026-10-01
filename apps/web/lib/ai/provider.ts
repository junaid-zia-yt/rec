import 'server-only'
import { z } from 'zod'
import { RequirementExtractionOutputSchema, type RequirementExtractionOutput } from '@rqi/types'

/**
 * Trusted metadata about the job the extraction is run for — comes from
 * `jobs`/`recruitment_projects` rows the caller already has RLS-scoped
 * access to, never from the uploaded document itself (docs/09-ai-
 * architecture.md trust boundary; Build Phase 4 brief §AI WORKFLOW step 1:
 * "Load trusted job metadata").
 */
export const TrustedJobMetadataSchema = z.object({
  title: z.string(),
  department: z.string().nullable(),
  industry: z.string().nullable(),
  employmentType: z.string(),
  workplaceArrangement: z.string(),
  location: z.string(),
})
export type TrustedJobMetadata = z.infer<typeof TrustedJobMetadataSchema>

/**
 * A single call to an AI requirement-extraction provider. `documentText` is
 * always the UNTRUSTED job-description body (Build Phase 4 brief §AI
 * WORKFLOW step 2/3: "Load untrusted job-description text" / "Clearly
 * isolate document content from system instructions") — a provider
 * implementation must never concatenate it into anything that could be
 * read back as an instruction; see lib/ai/prompt.ts for how it is framed.
 */
export interface AIExtractionRequest {
  jobMetadata: TrustedJobMetadata
  documentText: string
  promptVersion: string
  promptTemplate: string
}

/**
 * What a provider call returns BEFORE Zod validation — deliberately the raw,
 * untrusted shape the model produced (`rawOutput`), so the caller can record
 * it verbatim in `ai_runs.output_json` even when validation subsequently
 * rejects it (Build Phase 4 brief §AI WORKFLOW step 6/7: "Reject invalid
 * model output" / "Store the complete AI-run record" — the record must be
 * stored whether or not the output passed validation).
 */
export interface AIProviderCallResult {
  model: string
  rawOutput: unknown
  inputTokens: number | null
  outputTokens: number | null
  costUsd: number | null
  latencyMs: number
}

/**
 * A typed provider interface (Build Phase 4 brief: "implement a typed
 * provider interface and deterministic test adapter" when no real key is
 * available). Every implementation — the real Anthropic-backed one and the
 * deterministic test adapter alike — returns the SAME shape, so the
 * orchestration layer (extract-requirements.ts) never branches on which
 * provider produced a result.
 */
export interface AIProvider {
  readonly name: string
  callExtraction(request: AIExtractionRequest): Promise<AIProviderCallResult>
}

/** Thrown by a provider implementation for a caller-facing, never-sensitive failure reason. */
export class AIProviderError extends Error {
  constructor(
    message: string,
    readonly kind: 'timeout' | 'network' | 'provider_error' | 'not_configured',
  ) {
    super(message)
    this.name = 'AIProviderError'
  }
}

/**
 * Validates a provider's raw output against the strict structured schema
 * (Build Phase 4 brief §AI WORKFLOW step 5: "Validate output with Zod").
 * Never throws — returns a discriminated result so the caller can decide
 * between a retry and `failed_validation` without a try/catch around Zod.
 */
export function validateExtractionOutput(
  rawOutput: unknown,
): { valid: true; output: RequirementExtractionOutput } | { valid: false; issues: string[] } {
  const result = RequirementExtractionOutputSchema.safeParse(rawOutput)
  if (result.success) {
    return { valid: true, output: result.data }
  }
  return {
    valid: false,
    issues: result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    ),
  }
}
