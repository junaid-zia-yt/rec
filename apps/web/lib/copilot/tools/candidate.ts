import 'server-only'
import { z } from 'zod'
import { assertResourceOwnership } from '../resource-ownership'
import { redactCandidateProfile } from '../redaction'
import { loadCandidateVerifiedEvidenceBundle } from '@/lib/outreach/evidence'
import {
  type CopilotToolContext,
  type CopilotToolHandlerResult,
  CopilotToolInputError,
} from './shared'

/**
 * Build Phase 11, Wave 2 — tools/candidate.ts.
 *
 * summarize_candidate / explain_candidate_match / identify_missing_evidence.
 * Evidence-bearing data is loaded through
 * `loadCandidateVerifiedEvidenceBundle` (apps/web/lib/outreach/evidence.ts,
 * Phase 9) — the SAME already-verified-only bundle outreach drafting uses —
 * per the task brief's explicit instruction to reuse it rather than
 * re-derive candidate evidence assembly a third time.
 */

// ---------------------------------------------------------------------------
// summarize_candidate
// ---------------------------------------------------------------------------

export const SummarizeCandidateInputSchema = z.object({
  candidateId: z.string().uuid(),
})
export type SummarizeCandidateInput = z.infer<typeof SummarizeCandidateInputSchema>

export const SummarizeCandidateOutputSchema = z.object({
  candidateId: z.string(),
  fullName: z.string(),
  status: z.string(),
  profile: z
    .object({
      currentTitle: z.string().nullable(),
      currentCompany: z.string().nullable(),
      location: z.string().nullable(),
      yearsExperience: z.number().nullable(),
      workAuthorization: z.string().nullable(),
      availabilityNotes: z.string().nullable(),
      workplacePreference: z.string().nullable(),
      /** Present only when the conversation's data_classification is 'standard' — see redaction.ts. Absent (never null) for a client_decision_maker conversation. */
      recruiterNotes: z.string().nullable().optional(),
    })
    .nullable(),
  evidenceSummary: z.object({
    verifiedFieldCount: z.number().int(),
    unverifiedFieldCount: z.number().int(),
    experienceCount: z.number().int(),
    educationCount: z.number().int(),
    certificationCount: z.number().int(),
    skillCount: z.number().int(),
  }),
})
export type SummarizeCandidateOutput = z.infer<typeof SummarizeCandidateOutputSchema>

export async function summarizeCandidate(
  ctx: CopilotToolContext,
  input: SummarizeCandidateInput,
): Promise<CopilotToolHandlerResult<SummarizeCandidateOutput>> {
  const { supabase, organizationId, userId, role, dataClassification } = ctx

  const ownership = await assertResourceOwnership(supabase, {
    organizationId,
    userId,
    role,
    resourceType: 'candidate',
    resourceId: input.candidateId,
  })

  const { data: candidate } = await supabase
    .from('candidates')
    .select('id, full_name, status')
    .eq('id', input.candidateId)
    .eq('organization_id', organizationId)
    .maybeSingle()
  if (!candidate) throw new CopilotToolInputError(`candidate ${input.candidateId} not found`)

  const { data: profileRow } = await supabase
    .from('candidate_profiles')
    .select(
      'current_title, current_company, location, years_experience, work_authorization, availability_notes, workplace_preference, recruiter_notes',
    )
    .eq('candidate_id', input.candidateId)
    .maybeSingle()

  const { data: allExtractedFields } = await supabase
    .from('candidate_extracted_fields')
    .select('id, verification_status')
    .eq('candidate_id', input.candidateId)

  const [{ data: experiences }, { data: education }, { data: certifications }, { data: skills }] =
    await Promise.all([
      supabase.from('candidate_experiences').select('id').eq('candidate_id', input.candidateId),
      supabase.from('candidate_education').select('id').eq('candidate_id', input.candidateId),
      supabase.from('candidate_certifications').select('id').eq('candidate_id', input.candidateId),
      supabase.from('candidate_skills').select('id').eq('candidate_id', input.candidateId),
    ])

  const verifiedCount = (allExtractedFields ?? []).filter(
    (f) => f.verification_status === 'verified' || f.verification_status === 'edited',
  ).length
  const unverifiedCount = (allExtractedFields ?? []).length - verifiedCount

  const redactedProfile = profileRow
    ? redactCandidateProfile(
        {
          currentTitle: profileRow.current_title as string | null,
          currentCompany: profileRow.current_company as string | null,
          location: profileRow.location as string | null,
          yearsExperience: profileRow.years_experience as number | null,
          workAuthorization: profileRow.work_authorization as string | null,
          availabilityNotes: profileRow.availability_notes as string | null,
          workplacePreference: profileRow.workplace_preference as string | null,
          recruiterNotes: profileRow.recruiter_notes as string | null,
        },
        dataClassification,
      )
    : null

  const output: SummarizeCandidateOutput = {
    candidateId: candidate.id,
    fullName: candidate.full_name,
    status: candidate.status,
    profile: redactedProfile as SummarizeCandidateOutput['profile'],
    evidenceSummary: {
      verifiedFieldCount: verifiedCount,
      unverifiedFieldCount: unverifiedCount,
      experienceCount: experiences?.length ?? 0,
      educationCount: education?.length ?? 0,
      certificationCount: certifications?.length ?? 0,
      skillCount: skills?.length ?? 0,
    },
  }

  // No per-field citations here — this is a structural/statistical
  // summary, not a claim about any specific candidate fact. A caller
  // wanting evidence-grounded claims should use explain_candidate_match or
  // identify_missing_evidence, which do cite specific extracted fields.
  return { output, citations: [], ownership: [ownership] }
}

// ---------------------------------------------------------------------------
// explain_candidate_match
// ---------------------------------------------------------------------------

export const ExplainCandidateMatchInputSchema = z.object({
  candidateRoleMatchId: z.string().uuid(),
})
export type ExplainCandidateMatchInput = z.infer<typeof ExplainCandidateMatchInputSchema>

const GateExplanationSchema = z.object({
  requirementId: z.string(),
  requirementName: z.string(),
  state: z.string(),
  hasEvidence: z.boolean(),
  overriddenByHuman: z.boolean(),
})

const CriterionExplanationSchema = z.object({
  requirementId: z.string(),
  requirementName: z.string(),
  weight: z.number(),
  rawScore: z.number().nullable(),
  effectiveScore: z.number().nullable(),
  weightedContribution: z.number().nullable(),
})

export const ExplainCandidateMatchOutputSchema = z.object({
  candidateRoleMatchId: z.string(),
  candidateId: z.string(),
  jobId: z.string(),
  eligibility: z.string(),
  overallScore: z.number().nullable(),
  evidenceCoveragePct: z.number(),
  dataCompletenessPct: z.number(),
  confidence: z.number().nullable(),
  gates: z.array(GateExplanationSchema),
  criteria: z.array(CriterionExplanationSchema),
})
export type ExplainCandidateMatchOutput = z.infer<typeof ExplainCandidateMatchOutputSchema>

export async function explainCandidateMatch(
  ctx: CopilotToolContext,
  input: ExplainCandidateMatchInput,
): Promise<CopilotToolHandlerResult<ExplainCandidateMatchOutput>> {
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
    .select(
      'id, candidate_id, job_id, eligibility, overall_score, evidence_coverage_pct, data_completeness_pct, confidence',
    )
    .eq('id', input.candidateRoleMatchId)
    .eq('organization_id', organizationId)
    .maybeSingle()
  if (!match)
    throw new CopilotToolInputError(`candidate role match ${input.candidateRoleMatchId} not found`)

  const [{ data: gateRows }, { data: scoringRows }] = await Promise.all([
    supabase
      .from('mandatory_gate_results')
      .select('requirement_id, requirement_name, state, deterministic_result, override_result')
      .eq('candidate_role_match_id', input.candidateRoleMatchId),
    supabase
      .from('scoring_breakdowns')
      .select(
        'requirement_id, requirement_name, weight, raw_score, effective_score, weighted_contribution',
      )
      .eq('candidate_role_match_id', input.candidateRoleMatchId),
  ])

  const output: ExplainCandidateMatchOutput = {
    candidateRoleMatchId: match.id,
    candidateId: match.candidate_id,
    jobId: match.job_id,
    eligibility: match.eligibility,
    overallScore: match.overall_score,
    evidenceCoveragePct: Number(match.evidence_coverage_pct),
    dataCompletenessPct: Number(match.data_completeness_pct),
    confidence: match.confidence,
    gates: (gateRows ?? []).map((g) => ({
      requirementId: g.requirement_id as string,
      requirementName: g.requirement_name as string,
      state: g.state as string,
      // mandatory_gate_results carries no `has_evidence` column of its own
      // — `deterministic_result` IS the evidence-derived fact (gates.ts:
      // "no evidence at all -> insufficient_evidence, full stop"), so
      // "insufficient_evidence" is the sole reliable signal that zero
      // evidence was found for this gate.
      hasEvidence: g.deterministic_result !== 'insufficient_evidence',
      overriddenByHuman: g.override_result !== null && g.override_result !== undefined,
    })),
    criteria: (scoringRows ?? []).map((s) => ({
      requirementId: s.requirement_id as string,
      requirementName: s.requirement_name as string,
      weight: Number(s.weight),
      rawScore: s.raw_score,
      effectiveScore: s.effective_score,
      weightedContribution: s.weighted_contribution,
    })),
  }

  const citations = [
    ...(gateRows ?? []).map((g) => ({
      kind: 'candidate_role_match' as const,
      id: match.id,
      excerpt: `${g.requirement_name}: ${g.state}`,
    })),
  ]

  return { output, citations, ownership: [ownership] }
}

// ---------------------------------------------------------------------------
// identify_missing_evidence
// ---------------------------------------------------------------------------

export const IdentifyMissingEvidenceInputSchema = z.object({
  candidateRoleMatchId: z.string().uuid(),
})
export type IdentifyMissingEvidenceInput = z.infer<typeof IdentifyMissingEvidenceInputSchema>

export const IdentifyMissingEvidenceOutputSchema = z.object({
  candidateRoleMatchId: z.string(),
  candidateId: z.string(),
  gatesWithoutEvidence: z.array(
    z.object({ requirementId: z.string(), requirementName: z.string() }),
  ),
  criteriaWithoutEvidence: z.array(
    z.object({ requirementId: z.string(), requirementName: z.string() }),
  ),
  unverifiedExtractedFields: z.array(
    z.object({ id: z.string(), fieldGroup: z.string(), fieldKey: z.string() }),
  ),
})
export type IdentifyMissingEvidenceOutput = z.infer<typeof IdentifyMissingEvidenceOutputSchema>

export async function identifyMissingEvidence(
  ctx: CopilotToolContext,
  input: IdentifyMissingEvidenceInput,
): Promise<CopilotToolHandlerResult<IdentifyMissingEvidenceOutput>> {
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
        .select('requirement_id, requirement_name, deterministic_result')
        .eq('candidate_role_match_id', input.candidateRoleMatchId)
        .eq('deterministic_result', 'insufficient_evidence'),
      supabase
        .from('scoring_breakdowns')
        .select('requirement_id, requirement_name, has_evidence')
        .eq('candidate_role_match_id', input.candidateRoleMatchId)
        .eq('has_evidence', false),
      supabase
        .from('candidate_extracted_fields')
        .select('id, field_group, field_key')
        .eq('candidate_id', match.candidate_id)
        .not('verification_status', 'in', '(verified,edited)'),
    ],
  )

  const output: IdentifyMissingEvidenceOutput = {
    candidateRoleMatchId: match.id,
    candidateId: match.candidate_id,
    gatesWithoutEvidence: (gateRows ?? []).map((g) => ({
      requirementId: g.requirement_id as string,
      requirementName: g.requirement_name as string,
    })),
    criteriaWithoutEvidence: (scoringRows ?? []).map((s) => ({
      requirementId: s.requirement_id as string,
      requirementName: s.requirement_name as string,
    })),
    unverifiedExtractedFields: (unverifiedFields ?? []).map((f) => ({
      id: f.id as string,
      fieldGroup: f.field_group as string,
      fieldKey: f.field_key as string,
    })),
  }

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

  return { output, citations, ownership: [ownership] }
}

/** Re-exported so a caller that only needs the verified evidence bundle itself (e.g. wave 3 building a prompt) can get it through this module without a second import path — thin passthrough, no re-derivation. */
export { loadCandidateVerifiedEvidenceBundle }
