import 'server-only'
import { z } from 'zod'
import { CommunicationChannel } from '@rqi/types'
import { assertResourceOwnership } from '../resource-ownership'
import { loadCandidateVerifiedEvidenceBundle } from '@/lib/outreach/evidence'
import { validateOutreachDraftEvidence } from '@/lib/outreach/unsupported-claims'
import { runOutreachDraftGeneration } from '@/lib/ai/run-outreach-draft-generation'
import type { TrustedOutreachContext } from '@/lib/ai/outreach-draft-provider'
import {
  markUntrusted,
  type CopilotToolContext,
  type CopilotToolHandlerResult,
  CopilotToolInputError,
} from './shared'

/**
 * Build Phase 11, Wave 2 — tools/drafting.ts: draft_verification_questions,
 * draft_interview_questions, draft_outreach_message.
 *
 * Structurally, per the task brief and mirroring
 * `apps/web/lib/outreach/channels/linkedin.ts`'s precedent: NONE of these
 * three functions exports or calls anything resembling a `send()`. They
 * only ever return drafted TEXT for a human to review, edit and act on
 * through the ALREADY-EXISTING outreach/interview workflows — nothing here
 * could be wired into an actual send/mutation path without a deliberate,
 * separate new function being written elsewhere.
 *
 * draft_verification_questions / draft_interview_questions are
 * DETERMINISTIC template generation, not an AI call (this wave makes zero
 * direct AI/Claude API calls — orchestration is wave 3's job). Every
 * question they produce is templated directly off a `job_requirements` row
 * a recruiter already authored/approved — trusted, human-authored data —
 * so there is nothing here that could "invent" a candidate qualification;
 * these tools never make a claim about a candidate at all, only ask a
 * question about one.
 */

// ---------------------------------------------------------------------------
// draft_verification_questions
// ---------------------------------------------------------------------------

export const DraftVerificationQuestionsInputSchema = z.object({
  candidateRoleMatchId: z.string().uuid(),
})
export type DraftVerificationQuestionsInput = z.infer<typeof DraftVerificationQuestionsInputSchema>

const VerificationQuestionSchema = z.object({
  requirementId: z.string().nullable(),
  requirementName: z.string(),
  question: z.string(),
  reason: z.string(),
})

export const DraftVerificationQuestionsOutputSchema = z.object({
  candidateRoleMatchId: z.string(),
  questions: z.array(VerificationQuestionSchema),
})
export type DraftVerificationQuestionsOutput = z.infer<
  typeof DraftVerificationQuestionsOutputSchema
>

export async function draftVerificationQuestions(
  ctx: CopilotToolContext,
  input: DraftVerificationQuestionsInput,
): Promise<CopilotToolHandlerResult<DraftVerificationQuestionsOutput>> {
  const { supabase, organizationId, userId, role } = ctx

  const ownership = await assertResourceOwnership(supabase, {
    organizationId,
    userId,
    role,
    resourceType: 'candidate_role_match',
    resourceId: input.candidateRoleMatchId,
  })

  const { data: match } = await supabase
    .from('candidate_role_matches')
    .select('id, candidate_id')
    .eq('id', input.candidateRoleMatchId)
    .eq('organization_id', organizationId)
    .maybeSingle()
  if (!match)
    throw new CopilotToolInputError(`candidate role match ${input.candidateRoleMatchId} not found`)

  const [{ data: gateRows }, { data: scoringRows }, { data: unverifiedFields }] = await Promise.all(
    [
      supabase
        .from('mandatory_gate_results')
        .select('requirement_id, requirement_name')
        .eq('candidate_role_match_id', input.candidateRoleMatchId)
        .eq('deterministic_result', 'insufficient_evidence'),
      supabase
        .from('scoring_breakdowns')
        .select('requirement_id, requirement_name')
        .eq('candidate_role_match_id', input.candidateRoleMatchId)
        .eq('has_evidence', false),
      supabase
        .from('candidate_extracted_fields')
        .select('id, field_group, field_key')
        .eq('candidate_id', match.candidate_id)
        .not('verification_status', 'in', '(verified,edited)'),
    ],
  )

  const questions: DraftVerificationQuestionsOutput['questions'] = [
    ...(gateRows ?? []).map((g) => ({
      requirementId: g.requirement_id as string,
      requirementName: g.requirement_name as string,
      question: `Can you tell me about your experience with "${g.requirement_name}"? This is a mandatory requirement for this role and we don't yet have documented evidence of it.`,
      reason:
        'Mandatory requirement with no verified evidence — a gate that cannot pass without it.',
    })),
    ...(scoringRows ?? []).map((s) => ({
      requirementId: s.requirement_id as string,
      requirementName: s.requirement_name as string,
      question: `Could you share a specific example of "${s.requirement_name}"?`,
      reason: 'Preferred requirement with no supporting evidence found in the candidate record.',
    })),
    ...(unverifiedFields ?? []).map((f) => ({
      requirementId: null,
      requirementName: `${f.field_group}.${f.field_key}`,
      question: `Can you confirm the details we have on file for "${f.field_key}"?`,
      reason: 'Extracted from a document but not yet verified by a recruiter.',
    })),
  ]

  const citations = [
    ...(gateRows ?? []).map((g) => ({
      kind: 'candidate_role_match' as const,
      id: match.id,
      excerpt: `${g.requirement_name}: no evidence`,
    })),
    ...(unverifiedFields ?? []).map((f) => ({
      kind: 'candidate_extracted_field' as const,
      id: f.id as string,
      excerpt: `${f.field_group}.${f.field_key}: unverified`,
    })),
  ]

  return {
    output: { candidateRoleMatchId: match.id, questions },
    citations,
    ownership: [ownership],
  }
}

// ---------------------------------------------------------------------------
// draft_interview_questions
// ---------------------------------------------------------------------------

export const DraftInterviewQuestionsInputSchema = z.object({
  jobId: z.string().uuid(),
})
export type DraftInterviewQuestionsInput = z.infer<typeof DraftInterviewQuestionsInputSchema>

const InterviewQuestionSchema = z.object({
  requirementId: z.string(),
  requirementName: z.string(),
  type: z.string(),
  question: z.string(),
})

export const DraftInterviewQuestionsOutputSchema = z.object({
  jobId: z.string(),
  questions: z.array(InterviewQuestionSchema),
})
export type DraftInterviewQuestionsOutput = z.infer<typeof DraftInterviewQuestionsOutputSchema>

export async function draftInterviewQuestions(
  ctx: CopilotToolContext,
  input: DraftInterviewQuestionsInput,
): Promise<CopilotToolHandlerResult<DraftInterviewQuestionsOutput>> {
  const { supabase, organizationId, userId, role } = ctx

  const ownership = await assertResourceOwnership(supabase, {
    organizationId,
    userId,
    role,
    resourceType: 'job',
    resourceId: input.jobId,
  })

  const { data: requirements } = await supabase
    .from('job_requirements')
    .select('id, name, type')
    .eq('job_id', input.jobId)
    .eq('organization_id', organizationId)
    .in('type', ['mandatory', 'preferred'])

  const requirementRows = requirements ?? []

  const questions: DraftInterviewQuestionsOutput['questions'] = requirementRows.map((r) => ({
    requirementId: r.id as string,
    requirementName: r.name as string,
    type: r.type as string,
    question:
      r.type === 'mandatory'
        ? `Tell me about a specific time you demonstrated "${r.name}". What was the situation, what did you do, and what was the outcome?`
        : `How would you describe your experience with "${r.name}"? Please give a concrete example.`,
  }))

  const citations = requirementRows.map((r) => ({
    kind: 'job_requirement' as const,
    id: r.id as string,
    excerpt: r.name as string,
  }))

  return { output: { jobId: input.jobId, questions }, citations, ownership: [ownership] }
}

// ---------------------------------------------------------------------------
// draft_outreach_message
// ---------------------------------------------------------------------------

export const DraftOutreachMessageInputSchema = z.object({
  candidateRoleMatchId: z.string().uuid(),
  channel: CommunicationChannel,
  toneInstructions: z.string().nullable().optional(),
})
export type DraftOutreachMessageInput = z.infer<typeof DraftOutreachMessageInputSchema>

export const DraftOutreachMessageOutputSchema = z.object({
  candidateRoleMatchId: z.string(),
  status: z.enum(['success', 'error', 'rejected_by_validation', 'not_configured']),
  subject: z.string().nullable(),
  /** Untrusted-framed at the type level even though the text is AI-drafted, not candidate-authored — it is built FROM candidate evidence, so it is treated the same way a CV excerpt would be by any later prompt step (never as instructions). */
  body: z.string().nullable(),
  wroteGenerically: z.boolean(),
  errorMessage: z.string().nullable(),
})
export type DraftOutreachMessageOutput = z.infer<typeof DraftOutreachMessageOutputSchema>

/**
 * Thin wrapper over `runOutreachDraftGeneration` (apps/web/lib/ai/
 * run-outreach-draft-generation.ts, Phase 9) — per the task brief, this
 * tool does NOT reimplement drafting; it assembles the same trusted
 * context + verified evidence bundle Phase 9's own server action would
 * assemble, calls the existing generator, and re-validates the result with
 * the existing `validateOutreachDraftEvidence` guardrail before returning
 * it. It never persists an outreach_messages row and never sends anything
 * — see this module's header note.
 */
export async function draftOutreachMessage(
  ctx: CopilotToolContext,
  input: DraftOutreachMessageInput,
): Promise<CopilotToolHandlerResult<DraftOutreachMessageOutput>> {
  const { supabase, organizationId, userId, role } = ctx

  const ownership = await assertResourceOwnership(supabase, {
    organizationId,
    userId,
    role,
    resourceType: 'candidate_role_match',
    resourceId: input.candidateRoleMatchId,
  })

  const { data: match } = await supabase
    .from('candidate_role_matches')
    .select('id, candidate_id, job_id, recruitment_project_id')
    .eq('id', input.candidateRoleMatchId)
    .eq('organization_id', organizationId)
    .maybeSingle()
  if (!match)
    throw new CopilotToolInputError(`candidate role match ${input.candidateRoleMatchId} not found`)

  const [{ data: job }, { data: project }] = await Promise.all([
    supabase.from('jobs').select('title').eq('id', match.job_id).maybeSingle(),
    supabase
      .from('recruitment_projects')
      .select('client_id')
      .eq('id', match.recruitment_project_id)
      .maybeSingle(),
  ])
  const { data: client } = project
    ? await supabase.from('clients').select('name').eq('id', project.client_id).maybeSingle()
    : { data: null }
  const { data: recruiterProfile } = await supabase
    .from('user_profiles')
    .select('full_name')
    .eq('id', userId)
    .maybeSingle()

  const trustedContext: TrustedOutreachContext = {
    jobTitle: job?.title ?? 'this role',
    clientName: client?.name ?? null,
    recruiterName: recruiterProfile?.full_name ?? null,
    channel: input.channel,
    templateBody: null,
    templateSubject: null,
    toneInstructions: input.toneInstructions ?? null,
  }

  const candidateEvidence = await loadCandidateVerifiedEvidenceBundle(supabase, match.candidate_id)

  const outcome = await runOutreachDraftGeneration({ trustedContext, candidateEvidence })

  if (outcome.status !== 'success' || !outcome.validated) {
    return {
      output: {
        candidateRoleMatchId: match.id,
        status: outcome.status,
        subject: null,
        body: null,
        wroteGenerically: false,
        errorMessage: outcome.errorMessage,
      },
      citations: [],
      ownership: [ownership],
    }
  }

  const validation = validateOutreachDraftEvidence({
    personalizationEvidence: outcome.validated.personalizationEvidence,
    verifiedEvidenceBundle: candidateEvidence,
  })

  if (!validation.valid) {
    return {
      output: {
        candidateRoleMatchId: match.id,
        status: 'rejected_by_validation',
        subject: null,
        body: null,
        wroteGenerically: false,
        errorMessage: `Draft rejected: unsupported claims detected (${validation.issues.slice(0, 3).join('; ')})`,
      },
      citations: [],
      ownership: [ownership],
    }
  }

  const citations = outcome.validated.personalizationEvidence.map((ref) => ({
    kind: 'candidate_extracted_field' as const,
    id: ref.sourceId ?? match.candidate_id,
    excerpt: ref.evidenceExcerpt,
  }))

  return {
    output: {
      candidateRoleMatchId: match.id,
      status: 'success',
      subject: outcome.validated.subject,
      body: markUntrusted(outcome.validated.body),
      wroteGenerically: outcome.validated.wroteGenerically,
      errorMessage: null,
    },
    citations,
    ownership: [ownership],
  }
}
