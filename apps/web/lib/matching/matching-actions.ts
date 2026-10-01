'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import type { GateResult } from '@rqi/types'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { supabaseConfigured } from '@/lib/env'
import { logAuditEvent } from '@/lib/audit/log'
import { GENERIC_AUTH_ERROR_MESSAGE } from '@/lib/auth/errors'
import { requirePermission } from '@/lib/auth/session'
import type { ActionResult } from '@/lib/auth/actions'
import { deriveEligibility } from './gates'
import { computeRawWeightedScoreForOverride } from './evaluate'
import { enqueueJob } from '@/lib/jobs/enqueue'
import { executeJob } from '@/lib/jobs/executor'
import { DEFAULT_JOB_HANDLERS } from '@/lib/jobs/handlers'
import type { CandidateEvaluationResult } from '@/lib/jobs/handlers/candidate-evaluation'
import { runDemoEvaluation, getDemoProjectIdForJob } from '@/lib/demo/engine'

/**
 * Candidate-matching server actions (Build Phase 7 brief §MATCHING
 * PIPELINE / §MANDATORY GATE STATES / §UI). Every write here follows the
 * same 'use server' + Zod + requirePermission + Supabase write +
 * logAuditEvent + revalidatePath + ActionResult shape established by
 * apps/web/lib/candidates/document-processing-actions.ts (Build Phase 6).
 *
 * PERMISSIONS NOTE: kicking off or re-running an evaluation is gated on
 * 'candidate_records' (update) — starting a matching run is a human action
 * performed ON the candidate's record, the same category as uploading a
 * document or editing a profile field, not an attempt to author AI
 * content. Every review/verification/override action is gated on
 * 'human_reviews' (full), which the permission matrix already restricts to
 * agency_admin/recruiter — this is the brief's "Authorized role"
 * requirement for a human override, enforced identically to every other
 * human-decision action in this codebase. Migration 0027's RLS policies
 * encode the same interpretation at the database layer (client_decision_
 * maker has no write policy on any of the 7 new tables).
 */

const RunEvaluationSchema = z.object({
  organizationId: z.string().uuid(),
  candidateId: z.string().uuid(),
  jobId: z.string().uuid(),
  triggerReason: z
    .enum([
      'initial_evaluation',
      'scorecard_version_changed',
      'candidate_document_updated',
      'manual_reevaluation',
    ])
    .default('initial_evaluation'),
  triggerNote: z.string().trim().max(1000).optional(),
})

/**
 * Kicks off (or reports the existing) matching evaluation for one
 * candidate x job pair (Build Phase 7 brief §MATCHING PIPELINE, all 11
 * steps). The full pipeline (steps 1-11: freeze the scorecard version,
 * assemble candidate evidence, call the AI, compute deterministic gates/
 * score, store every result row) now runs through the durable job engine
 * (Build Phase 14, Wave 4b — see `lib/jobs/handlers/candidate-
 * evaluation.ts`'s own header note) via `enqueueJob` immediately followed by
 * `executeJob` in this same request ("enqueue and try now" — the common-case
 * return to the caller/UI is unchanged: still synchronous, still the final
 * result, before this request completes).
 */
export async function runMatchingEvaluationAction(formData: FormData): Promise<ActionResult> {
  const parsed = RunEvaluationSchema.safeParse({
    organizationId: formData.get('organizationId'),
    candidateId: formData.get('candidateId'),
    jobId: formData.get('jobId'),
    triggerReason: formData.get('triggerReason') || undefined,
    triggerNote: formData.get('triggerNote') || undefined,
  })
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }

  // Build Phase 18: the private demo runs the SAME deterministic pipeline
  // the live path uses (see lib/demo/engine.ts's runDemoEvaluation), fed by
  // an honestly-labelled stand-in provider instead of a live Anthropic
  // call and an in-memory store instead of Supabase. No live credential of
  // any kind is required for this to produce a real, evidence-grounded
  // result — see docs/client-feedback-reproduction-report.md §1/§2.
  if (!supabaseConfigured) {
    const demoProjectId = getDemoProjectIdForJob(parsed.data.jobId)
    if (!demoProjectId) {
      return { success: false, message: 'This role was not found in the private demo dataset.' }
    }
    revalidatePath(`/candidates/${parsed.data.candidateId}`)
    return runDemoEvaluation(demoProjectId, parsed.data.candidateId, 'Dana Reyes (demo)')
  }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'candidate_records', 'update')

  const { data: existingInFlight } = await supabase!
    .from('matching_runs')
    .select('id')
    .eq('candidate_id', parsed.data.candidateId)
    .eq('job_id', parsed.data.jobId)
    .in('status', ['queued', 'evaluating_gates', 'assessing_semantic', 'scoring'])
    .limit(1)
    .maybeSingle()

  if (existingInFlight) {
    return {
      success: false,
      message: 'This candidate is already being evaluated against this role.',
    }
  }

  // Own idempotency key (unchanged from the pre-job-engine action — see
  // matching_runs_org_idempotency_key_idx, migration 0027): a per-
  // candidate/job monotonic attempt number. Computed here (not re-derived
  // inside the handler from a second, possibly-racing COUNT query) and
  // carried in the job payload so the handler can rebuild the identical key.
  const { data: priorAttempts } = await supabase!
    .from('matching_runs')
    .select('id')
    .eq('candidate_id', parsed.data.candidateId)
    .eq('job_id', parsed.data.jobId)

  const attemptNo = (priorAttempts?.length ?? 0) + 1

  const { job: bgJob } = await enqueueJob({
    organizationId: parsed.data.organizationId,
    jobType: 'candidate_evaluation',
    payload: {
      candidateId: parsed.data.candidateId,
      jobId: parsed.data.jobId,
      attemptNo,
      triggerReason: parsed.data.triggerReason,
      triggerNote: parsed.data.triggerNote,
    },
    idempotencyKey: `${parsed.data.candidateId}:${parsed.data.jobId}:${attemptNo}`,
    supabase: supabase!,
    userId: user.id,
  })

  const outcome = await executeJob({
    jobId: bgJob.id,
    supabase: supabase!,
    handlers: DEFAULT_JOB_HANDLERS,
  })

  revalidatePath(`/candidates/${parsed.data.candidateId}`)

  switch (outcome.kind) {
    case 'succeeded': {
      const result = outcome.result as CandidateEvaluationResult
      return result.status === 'completed'
        ? { success: true, message: 'Evaluation complete.' }
        : {
            success: false,
            message: result.errorMessage ?? 'The evaluation could not be completed.',
          }
    }
    case 'failed_will_retry':
      return { success: false, message: outcome.errorMessage }
    case 'dead_lettered':
      return { success: false, message: outcome.errorMessage }
    case 'not_claimed':
      return {
        success: false,
        message: 'Could not start the evaluation — it may already be running.',
      }
    case 'no_handler':
    default:
      return { success: false, message: 'The evaluation could not be completed.' }
  }
}

const RequestVerificationSchema = z.object({
  organizationId: z.string().uuid(),
  candidateId: z.string().uuid(),
  gateResultId: z.string().uuid(),
  note: z.string().trim().max(1000).optional(),
})

/** Flags one mandatory-gate result as needing a human to go find/confirm evidence (brief §UI: "Request-verification action"). */
export async function requestGateVerificationAction(formData: FormData): Promise<ActionResult> {
  const parsed = RequestVerificationSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'human_reviews', 'update')

  const { error } = await supabase!
    .from('mandatory_gate_results')
    .update({
      state: 'requires_verification',
      verification_requested_by: user.id,
      verification_requested_at: new Date().toISOString(),
      verification_note: parsed.data.note ?? null,
    })
    .eq('id', parsed.data.gateResultId)
    .eq('organization_id', parsed.data.organizationId)

  if (error) return { success: false, message: 'Could not request verification.' }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'candidate_match.gate_verification_requested',
      entityType: 'mandatory_gate_results',
      entityId: parsed.data.gateResultId,
      metadata: { note: parsed.data.note },
    },
    supabase!,
  )

  revalidatePath(`/candidates/${parsed.data.candidateId}`)
  return { success: true, message: 'Verification requested.' }
}

const OverrideGateSchema = z.object({
  organizationId: z.string().uuid(),
  candidateId: z.string().uuid(),
  candidateRoleMatchId: z.string().uuid(),
  gateResultId: z.string().uuid(),
  overrideResult: z.enum(['pass', 'fail']),
  reason: z.string().trim().min(1, 'A reason is required to override a mandatory gate.').max(2000),
  evidenceNote: z
    .string()
    .trim()
    .min(1, 'Supporting evidence is required to override a mandatory gate.')
    .max(2000),
})

/**
 * Records a human override of one mandatory-gate result (brief §MANDATORY
 * GATE STATES: "A human override must require: Authorized role, Reason,
 * Supporting evidence, Timestamp, Audit event" — all five are enforced
 * here plus, redundantly, by the database CHECK constraint
 * mandatory_gate_results_override_requires_full_record). After recording
 * the override, the parent candidate_role_matches.eligibility is
 * recomputed from every gate's EFFECTIVE result (override, where present,
 * else the deterministic result) — never from the override alone, since
 * other mandatory gates on the same match may still be failing or unknown.
 * If eligibility becomes 'eligible', the already-computed weighted score is
 * revealed from the stored scoring_breakdowns rows rather than re-running
 * the AI (docs/08-candidate-scoring.md's "gate_pass gates score reveal,
 * not score computation" design — see evaluate.ts).
 */
export async function overrideMandatoryGateAction(formData: FormData): Promise<ActionResult> {
  const parsed = OverrideGateSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? 'Check the form and try again.',
    }
  }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  // requirePermission throws (never silently returns false) on denial — this
  // is the brief's "Authorized role" requirement for a human override.
  await requirePermission(user.id, parsed.data.organizationId, 'human_reviews', 'update')

  const overrideAt = new Date().toISOString()

  const { data: gate, error: gateError } = await supabase!
    .from('mandatory_gate_results')
    .update({
      state: 'human_override',
      override_result: parsed.data.overrideResult,
      override_by: user.id,
      override_reason: parsed.data.reason,
      override_evidence_note: parsed.data.evidenceNote,
      override_at: overrideAt,
    })
    .eq('id', parsed.data.gateResultId)
    .eq('organization_id', parsed.data.organizationId)
    .select('id, requirement_id, deterministic_result, override_result')
    .single()

  if (gateError || !gate) return { success: false, message: 'Could not record the override.' }

  const { data: matchForReview } = await supabase!
    .from('candidate_role_matches')
    .select('latest_matching_run_id')
    .eq('id', parsed.data.candidateRoleMatchId)
    .single()

  if (!matchForReview)
    return { success: false, message: 'Could not find the match record for this override.' }

  await supabase!.from('human_reviews').insert({
    organization_id: parsed.data.organizationId,
    candidate_role_match_id: parsed.data.candidateRoleMatchId,
    matching_run_id: matchForReview.latest_matching_run_id,
    reviewer_id: user.id,
    decision: 'gate_overridden',
    reason: parsed.data.reason,
  })

  const { data: humanReview } = await supabase!
    .from('human_reviews')
    .select('id')
    .eq('candidate_role_match_id', parsed.data.candidateRoleMatchId)
    .eq('reviewer_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (humanReview) {
    await supabase!.from('review_decisions').insert({
      organization_id: parsed.data.organizationId,
      human_review_id: humanReview.id,
      field: `gate:${gate.requirement_id}`,
      before_value: { deterministicResult: gate.deterministic_result },
      after_value: { overrideResult: gate.override_result },
      reason: parsed.data.reason,
    })
  }

  // Recompute eligibility from every gate's EFFECTIVE result.
  const { data: allGates } = await supabase!
    .from('mandatory_gate_results')
    .select('deterministic_result, override_result')
    .eq('candidate_role_match_id', parsed.data.candidateRoleMatchId)

  const effectiveResults: GateResult[] = (allGates ?? []).map(
    (row) => (row.override_result as GateResult | null) ?? (row.deterministic_result as GateResult),
  )
  const eligibility = deriveEligibility(effectiveResults)

  let overallScore: number | null = null
  if (eligibility === 'eligible') {
    const { data: breakdowns } = await supabase!
      .from('scoring_breakdowns')
      .select(
        'requirement_id, requirement_name, weight, raw_score, confidence_discount, effective_score, weighted_contribution, has_evidence',
      )
      .eq('candidate_role_match_id', parsed.data.candidateRoleMatchId)

    overallScore = computeRawWeightedScoreForOverride(
      (breakdowns ?? []).map((row) => ({
        requirementId: row.requirement_id,
        requirementName: row.requirement_name,
        weight: row.weight,
        rawScore: row.raw_score,
        confidenceDiscount: row.confidence_discount,
        effectiveScore: row.effective_score,
        weightedContribution: row.weighted_contribution,
        hasEvidence: row.has_evidence,
      })),
    )
  }

  await supabase!
    .from('candidate_role_matches')
    .update({ eligibility, overall_score: overallScore })
    .eq('id', parsed.data.candidateRoleMatchId)
    .eq('organization_id', parsed.data.organizationId)

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'candidate_match.gate_overridden',
      entityType: 'mandatory_gate_results',
      entityId: parsed.data.gateResultId,
      metadata: {
        overrideResult: parsed.data.overrideResult,
        reason: parsed.data.reason,
        resultingEligibility: eligibility,
      },
    },
    supabase!,
  )

  revalidatePath(`/candidates/${parsed.data.candidateId}`)
  return { success: true, message: 'Gate override recorded.' }
}

const RecordReviewDecisionSchema = z.object({
  organizationId: z.string().uuid(),
  candidateId: z.string().uuid(),
  candidateRoleMatchId: z.string().uuid(),
  decision: z.enum([
    'approved_for_outreach',
    'rejected',
    'requires_verification',
    'escalated',
    'note_added',
  ]),
  reason: z.string().trim().max(2000).optional(),
})

/**
 * Records the human reviewer's decision on a candidate_role_match as a
 * whole (brief §UI: "Approve for outreach", "Reject with reason", Build
 * Phase 8 brief §"Reviewer decisions": "Escalate", "Add internal notes") —
 * distinct from a single gate override above. A reason is required for
 * every decision except 'approved_for_outreach' (matches the database
 * CHECK constraint human_reviews_reason_required_unless_approved) — for
 * 'note_added' the "reason" field IS the note text, reusing the same
 * required-non-empty-text infrastructure rather than a separate notes
 * table. 'note_added' and 'escalated' never change review_status to
 * something that would remove the candidate from the eligible/reviewable
 * pool the way 'rejected' does — 'escalated' is its own terminal-ish
 * review_status (a senior reviewer must resolve it), 'note_added' leaves
 * review_status untouched entirely.
 */
export async function recordReviewDecisionAction(formData: FormData): Promise<ActionResult> {
  const parsed = RecordReviewDecisionSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (parsed.data.decision !== 'approved_for_outreach' && !parsed.data.reason) {
    return {
      success: false,
      message:
        parsed.data.decision === 'note_added'
          ? 'The note cannot be empty.'
          : 'A reason is required for this decision.',
    }
  }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'human_reviews', 'update')

  const { data: before } = await supabase!
    .from('candidate_role_matches')
    .select('review_status, latest_matching_run_id')
    .eq('id', parsed.data.candidateRoleMatchId)
    .single()

  if (!before)
    return { success: false, message: 'Could not find the match record for this decision.' }

  // 'note_added' is a pure log entry — it never overwrites review_status.
  if (parsed.data.decision !== 'note_added') {
    const { error } = await supabase!
      .from('candidate_role_matches')
      .update({
        review_status: parsed.data.decision,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', parsed.data.candidateRoleMatchId)
      .eq('organization_id', parsed.data.organizationId)

    if (error) return { success: false, message: 'Could not save the review decision.' }
  }

  const { data: humanReview } = await supabase!
    .from('human_reviews')
    .insert({
      organization_id: parsed.data.organizationId,
      candidate_role_match_id: parsed.data.candidateRoleMatchId,
      matching_run_id: before.latest_matching_run_id,
      reviewer_id: user.id,
      decision: parsed.data.decision,
      reason: parsed.data.reason ?? null,
    })
    .select('id')
    .single()

  if (humanReview) {
    await supabase!.from('review_decisions').insert({
      organization_id: parsed.data.organizationId,
      human_review_id: humanReview.id,
      field: parsed.data.decision === 'note_added' ? 'internal_note' : 'review_status',
      before_value:
        parsed.data.decision === 'note_added'
          ? null
          : { reviewStatus: before?.review_status ?? null },
      after_value:
        parsed.data.decision === 'note_added'
          ? { note: parsed.data.reason }
          : { reviewStatus: parsed.data.decision },
      reason: parsed.data.reason ?? 'Approved for outreach.',
    })
  }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'candidate_match.review_decided',
      entityType: 'candidate_role_matches',
      entityId: parsed.data.candidateRoleMatchId,
      metadata: { decision: parsed.data.decision, reason: parsed.data.reason },
    },
    supabase!,
  )

  revalidatePath(`/candidates/${parsed.data.candidateId}`)
  return { success: true, message: 'Review decision saved.' }
}
