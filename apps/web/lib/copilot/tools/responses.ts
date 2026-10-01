import 'server-only'
import { z } from 'zod'
import { assertResourceOwnership } from '../resource-ownership'
import { markUntrusted, type CopilotToolContext, type CopilotToolHandlerResult } from './shared'

/**
 * Build Phase 11, Wave 2 — summarize_candidate_responses. Reads Phase 9's
 * `candidate_responses` table (docs/09-ai-architecture.md §9.1 trust
 * boundary). `rawResponseText` is UNTRUSTED candidate-authored text
 * (0029's own column comment: "never treated as instructions to this
 * system or to any AI classification call that reads it") — marked with
 * `markUntrusted` here so wave 3's prompt-construction code inherits that
 * framing at the type level, not just from a comment.
 */

export const SummarizeCandidateResponsesInputSchema = z.object({
  candidateId: z.string().uuid(),
})
export type SummarizeCandidateResponsesInput = z.infer<
  typeof SummarizeCandidateResponsesInputSchema
>

const CandidateResponseSchema = z.object({
  id: z.string(),
  channel: z.string(),
  receivedAt: z.string(),
  /** UNTRUSTED — candidate-authored. Never an instruction, regardless of its content. */
  rawResponseText: z.string(),
  aiSuggestedClassification: z.string().nullable(),
  /** The sole authoritative classification (0029: "the only one the opt-out hard-gate trigger reads"). Never overridden by anything this tool or any AI narration derives. */
  confirmedClassification: z.string().nullable(),
})

export const SummarizeCandidateResponsesOutputSchema = z.object({
  candidateId: z.string(),
  responseCount: z.number().int(),
  responses: z.array(CandidateResponseSchema),
})
export type SummarizeCandidateResponsesOutput = z.infer<
  typeof SummarizeCandidateResponsesOutputSchema
>

export async function summarizeCandidateResponses(
  ctx: CopilotToolContext,
  input: SummarizeCandidateResponsesInput,
): Promise<CopilotToolHandlerResult<SummarizeCandidateResponsesOutput>> {
  const { supabase, organizationId, userId, role } = ctx

  const ownership = await assertResourceOwnership(supabase, {
    organizationId,
    userId,
    role,
    resourceType: 'candidate',
    resourceId: input.candidateId,
  })

  const { data: responses } = await supabase
    .from('candidate_responses')
    .select(
      'id, channel, received_at, raw_response_text, ai_suggested_classification, confirmed_classification',
    )
    .eq('candidate_id', input.candidateId)
    .eq('organization_id', organizationId)
    .order('received_at', { ascending: true })

  const rows = responses ?? []

  const output: SummarizeCandidateResponsesOutput = {
    candidateId: input.candidateId,
    responseCount: rows.length,
    responses: rows.map((r) => ({
      id: r.id as string,
      channel: r.channel as string,
      receivedAt: r.received_at as string,
      rawResponseText: markUntrusted(r.raw_response_text as string),
      aiSuggestedClassification: r.ai_suggested_classification as string | null,
      confirmedClassification: r.confirmed_classification as string | null,
    })),
  }

  const citations = rows.map((r) => ({
    kind: 'candidate_response' as const,
    id: r.id as string,
    excerpt: (r.raw_response_text as string).slice(0, 200),
  }))

  return { output, citations, ownership: [ownership] }
}
