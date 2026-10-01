/**
 * `candidate_evaluation` job handler — Build Phase 14, Wave 4b. Fills the
 * registry slot `handlers/index.ts`'s own header note lists as deliberately
 * empty.
 *
 * WHAT THIS MOVES: `lib/matching/matching-actions.ts`'s
 * `runMatchingEvaluationAction` ran the full candidate x job matching
 * pipeline (freeze the scorecard snapshot, assemble the candidate evidence
 * bundle, call the AI for semantic relevance via `runMatchingPipeline`,
 * compute deterministic gates/score/coverage, write every result row)
 * synchronously inline. This handler is that body, moved here unchanged in
 * substance — every DB write below is the exact write the action used to
 * perform inline; only the invocation mechanism changed (`matching-
 * actions.ts` now does `enqueueJob` immediately followed by `executeJob`,
 * the same "enqueue and try now" pattern `document-processing.ts` uses).
 *
 * RETRY-SAFETY OF THE `matching_runs` ROW: `matching_runs` already has its
 * own idempotency key (`${candidateId}:${jobId}:${attemptNo}`, unique per
 * organization per migration 0027) that this handler reuses byte-for-byte
 * (via `payload.attemptNo`, not a re-derived COUNT — see `job-payload-
 * schemas.ts`'s note on why). A background-job-level retry of this exact
 * job (same `attemptNo`) must therefore never attempt a second INSERT of
 * that row — this handler looks up any row already created under this key
 * first and reuses/advances it, exactly like `document-processing.ts` does
 * for its own domain table, and exactly like `enqueueJob` itself does for
 * `background_jobs`.
 *
 * RETRYABLE VS. NOT: a matching evaluation that fails because the AI call
 * itself timed out, could not be reached, or returned a raw provider error
 * (`errorKind` in {'timeout','network','provider_error'} —
 * `matching-pipeline.ts`'s own `classifyAiErrorKind`) is worth the job
 * engine's automatic backoff retry — this is precisely the "long-running,
 * retry-worthy work" this whole wave exists to wrap. A failure because no
 * Anthropic key is configured, or because the model's output failed
 * structured-schema validation twice (`runMatchingAssessment`'s own
 * retry-once policy has already run its course), will not be fixed by
 * retrying and is returned as a value instead — the SAME
 * retryable/non-retryable split `document-processing.ts` draws for its own
 * pipeline's failure kinds.
 */
import 'server-only'
import type { FrozenRequirement } from '@rqi/types'
import { logAuditEvent } from '@/lib/audit/log'
import { captureMonitoringMessage } from '@/lib/monitoring/capture'
import {
  buildCandidateEvidenceBundle,
  type CandidateExtractedFieldForEvidence,
} from '@/lib/matching/evidence-bundle'
import { runMatchingPipeline } from '@/lib/matching/matching-pipeline'
import { deriveGateState } from '@/lib/matching/gates'
import { notifyCandidateAwaitingReview } from '@/lib/notifications/event-triggers'
import type { MatchingAIProvider } from '@/lib/ai/matching-provider'
import type { CandidateEvaluationPayload } from '../job-payload-schemas'
import type { JobExecutionContext, JobHandler } from '../types'

export interface CandidateEvaluationResult {
  status: 'completed' | 'failed'
  matchingRunId: string
  candidateRoleMatchId: string | null
  errorMessage: string | null
}

const RETRYABLE_ERROR_KINDS = new Set(['timeout', 'network', 'provider_error'])

/**
 * Factory, not a bare handler — mirrors `runMatchingPipeline`'s own
 * `aiProvider?: MatchingAIProvider` injection seam
 * (`lib/matching/matching-pipeline.ts`): the registered
 * `candidateEvaluationHandler` below calls it with no override, while a test
 * supplies the deterministic test double already established by
 * `matching-pipeline.test.ts`/`run-matching-assessment.test.ts`.
 */
export function createCandidateEvaluationHandler(
  overrides: { aiProvider?: MatchingAIProvider } = {},
): JobHandler<CandidateEvaluationPayload, CandidateEvaluationResult> {
  return async (payload, context: JobExecutionContext) => {
    const supabase = context.supabase
    const { candidateId, jobId, attemptNo, triggerReason, triggerNote } = payload
    const idempotencyKey = `${candidateId}:${jobId}:${attemptNo}`

    const { data: authData } = await supabase.auth.getUser()
    const actorId = authData?.user?.id ?? null
    if (!actorId) {
      throw new Error(
        'candidateEvaluationHandler: no authenticated user on this execution context.',
      )
    }

    // Step 1: freeze the scorecard version.
    const { data: job } = await supabase
      .from('jobs')
      .select('id, title, recruitment_project_id')
      .eq('id', jobId)
      .eq('organization_id', context.organizationId)
      .single()
    if (!job) throw new Error('candidateEvaluationHandler: this role could not be found.')

    const { data: scorecard } = await supabase
      .from('scorecards')
      .select('id')
      .eq('job_id', jobId)
      .maybeSingle()
    if (!scorecard)
      throw new Error('candidateEvaluationHandler: no scorecard exists for this role yet.')

    const { data: scorecardVersion } = await supabase
      .from('scorecard_versions')
      .select('id, scorecard_id, requirement_snapshot')
      .eq('scorecard_id', scorecard.id)
      .eq('status', 'active')
      .single()
    if (!scorecardVersion) {
      throw new Error(
        'candidateEvaluationHandler: no approved scorecard exists for this role — an evaluation needs an approved, active scorecard version.',
      )
    }

    const snapshotEntries = scorecardVersion.requirement_snapshot as Array<{
      requirementId: string
      type: string
      weight: number | null
    }>
    if (snapshotEntries.length === 0) {
      throw new Error(
        'candidateEvaluationHandler: the active scorecard for this role has no requirements to evaluate against.',
      )
    }

    const requirementIds = snapshotEntries.map((entry) => entry.requirementId)
    const { data: requirementRows } = await supabase
      .from('job_requirements')
      .select('id, name')
      .in('id', requirementIds)
    const nameById = new Map(
      (requirementRows ?? []).map((row) => [row.id as string, row.name as string]),
    )
    const requirements: FrozenRequirement[] = snapshotEntries.map((entry) => ({
      requirementId: entry.requirementId,
      name: nameById.get(entry.requirementId) ?? 'Unnamed requirement',
      type: entry.type === 'mandatory' ? 'mandatory' : 'preferred',
      weight: entry.weight,
    }))

    // Step 2: load normalized candidate data.
    const [
      { data: profile },
      { data: experiences },
      { data: education },
      { data: certifications },
      { data: skills },
      { data: extractedFields },
    ] = await Promise.all([
      supabase
        .from('candidate_profiles')
        .select(
          'current_title, current_company, location, summary, leadership_scope, pnl_responsibility, work_authorization, compensation_notes, availability_notes, years_experience, notice_period_days, workplace_preference',
        )
        .eq('candidate_id', candidateId)
        .maybeSingle(),
      supabase
        .from('candidate_experiences')
        .select('id, company, title, location, start_date, end_date, is_current, description')
        .eq('candidate_id', candidateId),
      supabase
        .from('candidate_education')
        .select('id, institution, degree, field_of_study')
        .eq('candidate_id', candidateId),
      supabase
        .from('candidate_certifications')
        .select('id, name, issuing_body, issued_date, expires_date')
        .eq('candidate_id', candidateId),
      supabase
        .from('candidate_skills')
        .select('id, skill_name, proficiency, years_experience')
        .eq('candidate_id', candidateId),
      supabase
        .from('candidate_extracted_fields')
        .select(
          'id, field_group, field_key, verification_status, source_excerpt, extracted_value, edited_value',
        )
        .eq('candidate_id', candidateId)
        .in('verification_status', ['verified', 'edited']),
    ])

    const evidence = buildCandidateEvidenceBundle({
      profile: profile
        ? {
            currentTitle: profile.current_title,
            currentCompany: profile.current_company,
            location: profile.location,
            summary: profile.summary,
            leadershipScope: profile.leadership_scope,
            pnlResponsibility: profile.pnl_responsibility,
            workAuthorization: profile.work_authorization,
            compensationNotes: profile.compensation_notes,
            availabilityNotes: profile.availability_notes,
            yearsExperience: profile.years_experience,
            noticePeriodDays: profile.notice_period_days,
            workplacePreference: profile.workplace_preference,
          }
        : null,
      experiences: (experiences ?? []).map((row) => ({
        id: row.id,
        company: row.company,
        title: row.title,
        location: row.location,
        startDate: row.start_date,
        endDate: row.end_date,
        isCurrent: row.is_current,
        description: row.description,
      })),
      education: (education ?? []).map((row) => ({
        id: row.id,
        institution: row.institution,
        degree: row.degree,
        fieldOfStudy: row.field_of_study,
      })),
      certifications: (certifications ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        issuingBody: row.issuing_body,
        issuedDate: row.issued_date,
        expiresDate: row.expires_date,
      })),
      skills: (skills ?? []).map((row) => ({
        id: row.id,
        skillName: row.skill_name,
        proficiency: row.proficiency,
        yearsExperience: row.years_experience,
      })),
      extractedFields: (extractedFields ?? []).map((row): CandidateExtractedFieldForEvidence => ({
        id: row.id,
        fieldGroup: row.field_group,
        fieldKey: row.field_key,
        verificationStatus: row.verification_status,
        sourceExcerpt: row.source_excerpt,
        extractedValue: row.extracted_value,
        editedValue: row.edited_value,
      })),
    })

    // Retry-safe matching_runs row: reuse a row already created under this
    // exact idempotency key (a prior attempt at running THIS SAME background
    // job) rather than risk the unique-index violation a second insert would
    // hit (supabase/migrations/0027's matching_runs_org_idempotency_key_idx).
    const { data: existingRun } = await supabase
      .from('matching_runs')
      .select('id')
      .eq('organization_id', context.organizationId)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle()

    let runId: string
    if (existingRun) {
      runId = existingRun.id as string
      await supabase.from('matching_runs').update({ status: 'evaluating_gates' }).eq('id', runId)
    } else {
      const { data: run, error: runInsertError } = await supabase
        .from('matching_runs')
        .insert({
          organization_id: context.organizationId,
          candidate_id: candidateId,
          job_id: jobId,
          recruitment_project_id: job.recruitment_project_id,
          scorecard_id: scorecard.id,
          scorecard_version_id: scorecardVersion.id,
          status: 'queued',
          trigger_reason: triggerReason,
          trigger_note: triggerNote ?? null,
          requested_by: actorId,
          idempotency_key: idempotencyKey,
          started_at: new Date().toISOString(),
        })
        .select('id')
        .single()

      if (runInsertError || !run) {
        throw new Error(
          'candidateEvaluationHandler: could not start the evaluation — it may already be running.',
        )
      }
      runId = run.id as string

      await logAuditEvent(
        {
          organizationId: context.organizationId,
          actorId,
          action: 'candidate_match.evaluation_started',
          entityType: 'matching_runs',
          entityId: runId,
          metadata: { candidateId, jobId, triggerReason },
        },
        supabase,
      )
      await supabase.from('matching_runs').update({ status: 'evaluating_gates' }).eq('id', runId)
    }

    await supabase.from('matching_runs').update({ status: 'assessing_semantic' }).eq('id', runId)

    const result = await runMatchingPipeline({
      jobTitle: job.title,
      requirements,
      candidateEvidence: evidence,
      aiProvider: overrides.aiProvider,
    })

    const { data: aiRun } = await supabase
      .from('ai_runs')
      .insert({
        organization_id: context.organizationId,
        workflow_type: 'candidate_matching',
        model: result.ai.model ?? 'unknown',
        prompt_version: result.ai.promptVersion,
        status: result.ai.status,
        input_ref: `${candidateId}:${jobId}`,
        output_json: result.ai.rawOutput,
        error_message: result.ai.errorMessage,
        confidence: result.deterministic?.weighted.confidence ?? null,
        input_tokens: result.ai.inputTokens,
        output_tokens: result.ai.outputTokens,
        cost_usd: result.ai.costUsd,
        latency_ms: result.ai.latencyMs,
        created_by: actorId,
        idempotency_key: idempotencyKey,
      })
      .select('id')
      .single()

    if (result.status === 'failed' || !result.deterministic) {
      captureMonitoringMessage(
        `Candidate matching AI evaluation failed: ${result.errorKind ?? 'unknown'}`,
        'error',
        {
          category: 'ai_provider',
          organizationId: context.organizationId,
          extra: {
            candidateId,
            jobId,
            errorKind: result.errorKind ?? null,
            model: result.ai.model ?? null,
          },
        },
      )
      await supabase
        .from('matching_runs')
        .update({
          status: 'failed',
          error_kind: result.errorKind,
          error_message: result.errorMessage,
          ai_run_id: aiRun?.id ?? null,
          completed_at: new Date().toISOString(),
        })
        .eq('id', runId)

      // A failed evaluation still surfaces an honest state — never leaves a
      // stale prior result looking current, and never fabricates one either.
      await supabase.from('candidate_role_matches').upsert(
        {
          organization_id: context.organizationId,
          candidate_id: candidateId,
          job_id: jobId,
          recruitment_project_id: job.recruitment_project_id,
          scorecard_version_id: scorecardVersion.id,
          latest_matching_run_id: runId,
          eligibility: 'pending_verification',
          overall_score: null,
          evidence_coverage_pct: 0,
          data_completeness_pct: 0,
          confidence: null,
          review_status: 'pending',
        },
        { onConflict: 'candidate_id,job_id' },
      )

      await logAuditEvent(
        {
          organizationId: context.organizationId,
          actorId,
          action: 'candidate_match.evaluation_failed',
          entityType: 'matching_runs',
          entityId: runId,
          metadata: { errorKind: result.errorKind, errorMessage: result.errorMessage },
        },
        supabase,
      )

      if (result.errorKind && RETRYABLE_ERROR_KINDS.has(result.errorKind)) {
        // Transport/timeout-shaped — worth the job engine's own backoff
        // retry. The domain row above already honestly records 'failed'
        // either way.
        throw new Error(result.errorMessage ?? 'The evaluation could not be completed.')
      }

      return {
        status: 'failed',
        matchingRunId: runId,
        candidateRoleMatchId: null,
        errorMessage: result.errorMessage,
      }
    }

    await supabase.from('matching_runs').update({ status: 'scoring' }).eq('id', runId)

    const det = result.deterministic

    const { data: match, error: matchError } = await supabase
      .from('candidate_role_matches')
      .upsert(
        {
          organization_id: context.organizationId,
          candidate_id: candidateId,
          job_id: jobId,
          recruitment_project_id: job.recruitment_project_id,
          scorecard_version_id: scorecardVersion.id,
          latest_matching_run_id: runId,
          eligibility: det.eligibility,
          overall_score: det.weighted.overallScore,
          evidence_coverage_pct: det.weighted.evidenceCoveragePct,
          data_completeness_pct: det.weighted.dataCompletenessPct,
          confidence: det.weighted.confidence,
          review_status: 'pending',
        },
        { onConflict: 'candidate_id,job_id' },
      )
      .select('id')
      .single()

    if (matchError || !match) {
      await supabase
        .from('matching_runs')
        .update({
          status: 'failed',
          error_kind: 'internal_error',
          error_message: 'Could not store the match result.',
          ai_run_id: aiRun?.id ?? null,
          completed_at: new Date().toISOString(),
        })
        .eq('id', runId)
      throw new Error('candidateEvaluationHandler: could not store the evaluation result.')
    }

    const assessmentByRequirement = new Map(
      result.ai.validated!.assessments.map((assessment) => [assessment.requirementId, assessment]),
    )

    const gateRows = det.gates.map((gate) => {
      const assessment = assessmentByRequirement.get(gate.requirementId)
      return {
        organization_id: context.organizationId,
        matching_run_id: runId,
        candidate_role_match_id: match.id,
        requirement_id: gate.requirementId,
        requirement_name: gate.requirementName,
        deterministic_result: gate.deterministicResult,
        ai_suggested_result: assessment?.gateSuggestion ?? null,
        ai_suggestion_note: assessment?.explanation ?? null,
        risk_notes: assessment?.riskNotes ?? [],
        state: deriveGateState(gate.deterministicResult),
      }
    })
    if (gateRows.length > 0) {
      await supabase.from('mandatory_gate_results').insert(gateRows)
    }

    const evidenceRows = result.ai.validated!.assessments.flatMap((assessment) =>
      assessment.evidenceRefs.map((ref) => ({
        organization_id: context.organizationId,
        matching_run_id: runId,
        candidate_role_match_id: match.id,
        requirement_id: assessment.requirementId,
        candidate_id: candidateId,
        source_kind: ref.sourceKind,
        source_experience_id: ref.sourceKind === 'experience' ? ref.sourceId : null,
        source_education_id: ref.sourceKind === 'education' ? ref.sourceId : null,
        source_certification_id: ref.sourceKind === 'certification' ? ref.sourceId : null,
        source_skill_id: ref.sourceKind === 'skill' ? ref.sourceId : null,
        source_extracted_field_id: ref.sourceKind === 'extracted_field' ? ref.sourceId : null,
        excerpt: ref.excerpt,
        location: ref.location,
        relevance_score: assessment.relevanceScore,
        confidence: assessment.confidence,
        is_direct_statement: ref.isDirectStatement,
      })),
    )
    if (evidenceRows.length > 0) {
      await supabase.from('requirement_evidence').insert(evidenceRows)
    }

    const scoringRows = det.criteria.map((criterion) => {
      const assessment = assessmentByRequirement.get(criterion.requirementId)
      return {
        organization_id: context.organizationId,
        matching_run_id: runId,
        candidate_role_match_id: match.id,
        requirement_id: criterion.requirementId,
        requirement_name: criterion.requirementName,
        weight: criterion.weight,
        raw_score: criterion.rawScore,
        confidence_discount: criterion.confidenceDiscount,
        effective_score: criterion.effectiveScore,
        weighted_contribution: criterion.weightedContribution,
        has_evidence: criterion.hasEvidence,
        risk_notes: assessment?.riskNotes ?? [],
      }
    })
    if (scoringRows.length > 0) {
      await supabase.from('scoring_breakdowns').insert(scoringRows)
    }

    await supabase
      .from('matching_runs')
      .update({
        status: 'completed',
        ai_run_id: aiRun?.id ?? null,
        completed_at: new Date().toISOString(),
      })
      .eq('id', runId)

    await logAuditEvent(
      {
        organizationId: context.organizationId,
        actorId,
        action: 'candidate_match.evaluation_completed',
        entityType: 'candidate_role_matches',
        entityId: match.id,
        metadata: { eligibility: det.eligibility, overallScore: det.weighted.overallScore },
      },
      supabase,
    )

    // Best-effort, same try/catch-and-log pattern the original action used —
    // a notification failure must never mask this handler's own already-
    // recorded, real evaluation result.
    try {
      const { data: candidate } = await supabase
        .from('candidates')
        .select('full_name')
        .eq('id', candidateId)
        .maybeSingle()
      await notifyCandidateAwaitingReview({
        organizationId: context.organizationId,
        actorUserId: actorId,
        candidateRoleMatchId: match.id,
        recruitmentProjectId: job.recruitment_project_id,
        candidateName: (candidate?.full_name as string | undefined) ?? 'A candidate',
        supabase,
      })
    } catch (notifyError) {
      console.error(
        '[matching] notifyCandidateAwaitingReview failed:',
        notifyError instanceof Error ? notifyError.message : notifyError,
      )
    }

    return {
      status: 'completed',
      matchingRunId: runId,
      candidateRoleMatchId: match.id,
      errorMessage: null,
    }
  }
}

/** The registered handler — no provider override, so the live path always resolves the real AI matching provider. */
export const candidateEvaluationHandler: JobHandler<
  CandidateEvaluationPayload,
  CandidateEvaluationResult
> = createCandidateEvaluationHandler()
