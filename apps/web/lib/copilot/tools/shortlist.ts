import 'server-only'
import { z } from 'zod'
import { assertResourceOwnership } from '../resource-ownership'
import { redactShortlistCandidates } from '../redaction'
import { loadShortlistDetail } from '@/lib/shortlists/load-detail'
import {
  type CopilotToolContext,
  type CopilotToolHandlerResult,
  CopilotToolInputError,
} from './shared'

/**
 * Build Phase 11, Wave 2 — compare_approved_candidates. Reuses
 * `loadShortlistDetail` (apps/web/lib/shortlists/load-detail.ts, Phase 8)
 * directly rather than re-querying shortlist_candidates/candidate_role_matches
 * itself, per the task brief's reuse instruction. "Approved" here means the
 * candidates already on a shortlist's CURRENT version — the same set the
 * Phase 8 UI already treats as the comparison set (a candidate cannot be on
 * a shortlist without having passed every mandatory gate — see
 * shortlists/load.ts's loadEligibleCandidatesForShortlist, `.eq('eligibility',
 * 'eligible')` — so "approved" and "on the shortlist" are the same
 * population here, never re-derived).
 */

export const CompareApprovedCandidatesInputSchema = z.object({
  shortlistId: z.string().uuid(),
})
export type CompareApprovedCandidatesInput = z.infer<typeof CompareApprovedCandidatesInputSchema>

const ComparedCandidateSchema = z.object({
  candidateId: z.string(),
  candidateName: z.string(),
  rank: z.number().int(),
  overallScore: z.number().nullable(),
  evidenceCoveragePct: z.number(),
  dataCompletenessPct: z.number(),
  gatesPassed: z.number().int(),
  gatesTotal: z.number().int(),
  /** Present only for a 'standard'-classification conversation (recruiter/admin) — see redaction.ts. Never present for a client_decision_maker conversation. */
  recruiterNote: z.string().nullable().optional(),
})

export const CompareApprovedCandidatesOutputSchema = z.object({
  shortlistId: z.string(),
  jobId: z.string(),
  jobTitle: z.string(),
  status: z.string(),
  candidates: z.array(ComparedCandidateSchema),
})
export type CompareApprovedCandidatesOutput = z.infer<typeof CompareApprovedCandidatesOutputSchema>

export async function compareApprovedCandidates(
  ctx: CopilotToolContext,
  input: CompareApprovedCandidatesInput,
): Promise<CopilotToolHandlerResult<CompareApprovedCandidatesOutput>> {
  const { supabase, organizationId, userId, role, dataClassification } = ctx

  const ownership = await assertResourceOwnership(supabase, {
    organizationId,
    userId,
    role,
    resourceType: 'shortlist',
    resourceId: input.shortlistId,
  })

  const detail = await loadShortlistDetail(organizationId, input.shortlistId, supabase)
  if (!detail) throw new CopilotToolInputError(`shortlist ${input.shortlistId} not found`)

  const redactedCandidates = redactShortlistCandidates(
    detail.candidates.map((c) => ({
      candidateId: c.candidateId,
      candidateName: c.candidateName,
      rank: c.rank,
      overallScore: c.overallScore,
      evidenceCoveragePct: c.evidenceCoveragePct,
      dataCompletenessPct: c.dataCompletenessPct,
      gatesPassed: c.gatesPassed,
      gatesTotal: c.gatesTotal,
      recruiterNote: c.recruiterNote,
    })),
    dataClassification,
  )

  const output: CompareApprovedCandidatesOutput = {
    shortlistId: detail.id,
    jobId: detail.jobId,
    jobTitle: detail.jobTitle,
    status: detail.status,
    candidates: redactedCandidates as CompareApprovedCandidatesOutput['candidates'],
  }

  const citations = detail.candidates.map((c) => ({
    kind: 'shortlist_candidate' as const,
    id: c.shortlistCandidateId,
    excerpt: `${c.candidateName}: rank ${c.rank}, score ${c.overallScore ?? 'n/a'}`,
  }))

  return { output, citations, ownership: [ownership] }
}
