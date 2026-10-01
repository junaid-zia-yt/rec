import 'server-only'
import { z } from 'zod'
import type { CandidateEvidenceBundleItem } from './matching-provider'
import { CommunicationChannel } from '@rqi/types'

/**
 * Trusted context for an outreach-draft AI call — the job/role and outreach
 * intent, all human-authored/approved data the recruiter already has
 * RLS-scoped access to (mirrors matching-provider.ts's TrustedMatchingContext
 * split exactly). Never anything derived from a candidate's own CV/profile
 * text.
 */
export const TrustedOutreachContextSchema = z.object({
  jobTitle: z.string(),
  clientName: z.string().nullable(),
  recruiterName: z.string().nullable(),
  channel: CommunicationChannel,
  /** Optional org template body to draft from/adapt, verbatim as authored — never candidate-sourced. */
  templateBody: z.string().nullable(),
  templateSubject: z.string().nullable(),
  /** Free-text tone/instruction hints from the recruiter (e.g. "keep it under 120 words", "mention flexible hours"). Human-authored, trusted, but still never allowed to override the evidence rules below — see the system prompt. */
  toneInstructions: z.string().nullable(),
})
export type TrustedOutreachContext = z.infer<typeof TrustedOutreachContextSchema>

/**
 * The candidate evidence bundle for drafting is the exact same shape and
 * same trust boundary as the matching workflow's
 * CandidateEvidenceBundleItem (apps/web/lib/matching/evidence-bundle.ts) —
 * re-exported here under a workflow-specific alias rather than re-defined,
 * so both AI workflows are provably fed from the one deterministic,
 * already-verified evidence loader.
 */
export type OutreachEvidenceBundleItem = CandidateEvidenceBundleItem

export interface OutreachDraftAIRequest {
  trustedContext: TrustedOutreachContext
  candidateEvidence: OutreachEvidenceBundleItem[]
  promptVersion: string
  promptTemplate: string
}

/** What a provider call returns BEFORE Zod validation — recorded verbatim in the linked ai_runs.output_json even when validation later rejects it (same convention as MatchingAIProviderCallResult). */
export interface OutreachDraftAIProviderCallResult {
  model: string
  rawOutput: unknown
  inputTokens: number | null
  outputTokens: number | null
  costUsd: number | null
  latencyMs: number
}

/** Same typed-provider-interface / deterministic-test-adapter pattern as lib/ai/matching-provider.ts. */
export interface OutreachDraftAIProvider {
  readonly name: string
  generateDraft(request: OutreachDraftAIRequest): Promise<OutreachDraftAIProviderCallResult>
}

export class OutreachDraftAIProviderError extends Error {
  constructor(
    message: string,
    readonly kind: 'timeout' | 'network' | 'provider_error' | 'not_configured',
  ) {
    super(message)
    this.name = 'OutreachDraftAIProviderError'
  }
}

/**
 * One evidence reference the model claims backs a specific personalized
 * sentence/claim in the draft. Intentionally a superset-compatible shape of
 * `OutreachPersonalizationEvidenceItemSchema` from @rqi/types (which is
 * deliberately loose, z.record(string, unknown)) — THIS is the concrete
 * shape this workflow actually produces and validates; the next wave's
 * persistence code can store these objects directly into
 * outreach_messages.personalization_evidence.
 */
export const OutreachDraftEvidenceRefSchema = z.object({
  sourceKind: z.enum([
    'experience',
    'education',
    'certification',
    'skill',
    'extracted_field',
    'profile',
  ]),
  sourceId: z.string().nullable(),
  /** The specific claim/sentence fragment in draftBody this evidence backs — lets a reviewer and the deterministic unsupported-claims validator (lib/outreach/unsupported-claims.ts) locate it. */
  claimText: z.string().min(1),
  /** Verbatim excerpt copied from the supplied evidence item that supports claimText — never paraphrased, never invented (same rule as the matching workflow). */
  evidenceExcerpt: z.string().min(1),
})
export type OutreachDraftEvidenceRef = z.infer<typeof OutreachDraftEvidenceRefSchema>

/** Structured output of the outreach-draft AI call. */
export const OutreachDraftAIOutputSchema = z.object({
  subject: z.string().nullable(),
  body: z.string().min(1).max(8000),
  personalizationEvidence: z.array(OutreachDraftEvidenceRefSchema).max(20),
  /** True only when the model judged the supplied evidence bundle too thin to personalize meaningfully and wrote a generic draft instead (this workflow's "if insufficient evidence exists, write generically instead of inventing" rule made visible to the reviewer). */
  wroteGenerically: z.boolean(),
  /** Short notes on anything the model could not confidently personalize — mirrors matching's unresolvedNotes convention. */
  unresolvedNotes: z.array(z.string()).max(20),
})
export type OutreachDraftAIOutput = z.infer<typeof OutreachDraftAIOutputSchema>

/** Never throws — same discriminated-result convention as validateMatchingOutput. */
export function validateOutreachDraftOutput(
  rawOutput: unknown,
): { valid: true; output: OutreachDraftAIOutput } | { valid: false; issues: string[] } {
  const result = OutreachDraftAIOutputSchema.safeParse(rawOutput)
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
