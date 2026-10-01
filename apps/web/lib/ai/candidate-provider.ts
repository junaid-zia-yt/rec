import 'server-only'
import { CandidateExtractionOutputSchema, type CandidateExtractionOutput } from '@rqi/types'
import type { AIProviderCallResult } from './provider'

/**
 * A single call to an AI candidate-document parsing provider (Build Phase 6
 * brief §AI PIPELINE step 6: "Parse into a strict structured schema").
 * `documentText` is always the UNTRUSTED, already deterministically
 * extracted CV text (lib/candidates/document-text-extraction.ts) — a
 * provider implementation must never concatenate it into anything that
 * could be read back as an instruction; see lib/ai/candidate-prompt.ts for
 * how it is framed. There is no trusted counterpart metadata equivalent to
 * job-requirement extraction's `TrustedJobMetadata` here — the brief lists
 * no platform-side candidate facts to feed in alongside the document, so
 * the request is the document text alone.
 */
export interface CandidateAIExtractionRequest {
  documentText: string
  promptVersion: string
  promptTemplate: string
}

/**
 * Typed provider interface for candidate-document parsing (mirrors
 * lib/ai/provider.ts's `AIProvider`, kept as a separate interface because
 * the request/response shape is CV-specific). Every implementation — the
 * real Anthropic-backed one and the deterministic test adapter alike —
 * returns the same `AIProviderCallResult` shape (reused unchanged from
 * lib/ai/provider.ts) so the orchestration layer
 * (lib/ai/parse-candidate-document.ts) never branches on which provider
 * produced a result.
 */
export interface CandidateAIProvider {
  readonly name: string
  callCandidateExtraction(request: CandidateAIExtractionRequest): Promise<AIProviderCallResult>
}

/**
 * Validates a provider's raw output against the strict structured schema
 * (Build Phase 6 brief §AI PIPELINE step 7: "Validate every AI output").
 * Never throws — returns a discriminated result so the caller can decide
 * between a retry and a `rejected_by_validation` outcome without a
 * try/catch around Zod. The schema's own `extractedScalarField` refinement
 * (packages/types/src/index.ts) is what enforces the brief's "If evidence
 * is absent, return unknown" rule at the type level: a field with
 * `hasEvidence: false` carrying a non-null value fails validation here,
 * the same way a malformed job-requirement extraction does today.
 */
export function validateCandidateExtractionOutput(
  rawOutput: unknown,
): { valid: true; output: CandidateExtractionOutput } | { valid: false; issues: string[] } {
  const result = CandidateExtractionOutputSchema.safeParse(rawOutput)
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
