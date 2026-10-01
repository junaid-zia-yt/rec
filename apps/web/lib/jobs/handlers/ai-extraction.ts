/**
 * `ai_extraction` job handler — Build Phase 14, Wave 4b. Fills one of the
 * registry slots `handlers/index.ts`'s own header note lists as
 * deliberately empty ("wrap EXISTING synchronous pipelines... that migration
 * belongs to whichever wave owns that domain").
 *
 * WHY THIS WAVE, AND WHAT IT MOVES: `docs/performance-report.md` flagged (as
 * Critical) that `lib/requirements/actions.ts`'s
 * `runRequirementExtractionAction` ran the requirement-extraction AI call
 * (`lib/ai/extract-requirements.ts`'s `runRequirementExtraction` — a real
 * Anthropic round trip, with its own retry-once-on-invalid-output policy)
 * synchronously inline inside a `'use server'` action, with none of the
 * durable job engine's retry/backoff/dead-letter machinery around it. This
 * handler is that DB-writing body, moved here UNCHANGED IN SUBSTANCE — every
 * write below (`ai_runs`, `job_requirements`, `requirement_extraction_
 * results`, the `audit_events`/`project_activity` rows) is the exact same
 * write the action used to perform inline; only the invocation mechanism
 * changed (see `job-payload-schemas.ts`'s note on the two additive payload
 * fields this move needed).
 *
 * SCOPE: only `targetType: 'job_description'` (requirement extraction) is
 * implemented — `targetType: 'candidate_document'` throws a clear, typed
 * error and is left for whichever future wave builds that handler, exactly
 * the same "implement the branch this wave actually owns, throw honestly
 * for the other" pattern `handlers/email-delivery.ts` already established
 * for its own two-branch payload.
 *
 * NOT_CONFIGURED IS A VALUE, NOT A RETRY: when no Anthropic key is
 * configured, `runRequirementExtraction` returns `not_configured` without
 * ever calling the model — this is a deterministic environment state that
 * retrying will never fix on its own (mirrors `integration-sync.ts`'s own
 * "an honest `failed` outcome reported as a VALUE, never an exception, for a
 * provider that cannot possibly succeed here" convention). The original
 * action wrote NO `ai_runs` row for this case (no AI call was made to
 * audit) — preserved here exactly.
 *
 * A genuine transport/validation failure (`outcome.status === 'error'` or
 * `'rejected_by_validation'`) IS still recorded as a complete `ai_runs` +
 * `requirement_extraction_results` row (per the project's "every AI action
 * must be auditable" rule, unchanged from the original action) but is
 * returned as a value too, not thrown — a `rejected_by_validation` result
 * already reflects `runRequirementExtraction`'s own retry-once policy having
 * already run its course, and an `error` status has no reliable way here to
 * distinguish "transient" from "will never succeed" (the orchestration layer
 * does not preserve that distinction on its `ExtractionOutcome` type), so
 * this handler does not invent a false confidence about which failures are
 * worth an automatic backoff retry versus which are not.
 */
import 'server-only'
import { logAuditEvent } from '@/lib/audit/log'
import { logProjectActivity } from '@/lib/audit/activity'
import { captureMonitoringMessage } from '@/lib/monitoring/capture'
import { runRequirementExtraction } from '@/lib/ai/extract-requirements'
import type { AIProvider } from '@/lib/ai/provider'
import type { AiExtractionPayload } from '../job-payload-schemas'
import type { JobExecutionContext, JobHandler } from '../types'

export interface AiExtractionResult {
  status: 'success' | 'error' | 'rejected_by_validation' | 'not_configured'
  requirementCount: number
  /** Mirrors the original action's own user-facing ActionResult.message exactly, so the calling action can hand it straight back. */
  message: string
}

/**
 * Factory, not a bare handler — mirrors `runRequirementExtraction`'s own
 * `provider?: AIProvider` injection seam (`lib/ai/extract-requirements.ts`):
 * the registered `aiExtractionHandler` below calls it with no override (the
 * live path always resolves the real AnthropicProvider, gated by
 * `anthropicConfigured`), while a test supplies the deterministic
 * `TestAIProvider` already established by `lib/ai/extract-requirements.test.ts`
 * — this handler needs the identical seam, not a second, parallel one.
 */
export function createAiExtractionHandler(
  overrides: { provider?: AIProvider } = {},
): JobHandler<AiExtractionPayload, AiExtractionResult> {
  return async (payload, context: JobExecutionContext) => {
    if (payload.targetType !== 'job_description') {
      throw new Error(
        `aiExtractionHandler: targetType '${payload.targetType}' has no handler implementation yet — only 'job_description' (requirement extraction) is wired this wave. See this file's own header note.`,
      )
    }
    if (!payload.jobId) {
      throw new Error(
        'aiExtractionHandler: payload.jobId is required for a job_description extraction (job metadata + job_requirements.job_id both need it).',
      )
    }

    const supabase = context.supabase
    const { data: authData } = await supabase.auth.getUser()
    const actorId = authData?.user?.id ?? null
    if (!actorId) {
      throw new Error(
        'aiExtractionHandler: no authenticated user on this execution context — cannot attribute the ai_runs/job_requirements rows this handler writes.',
      )
    }

    const [{ data: job }, { data: jobDescription }] = await Promise.all([
      supabase
        .from('jobs')
        .select('title, department, industry, employment_type, workplace_arrangement, location')
        .eq('id', payload.jobId)
        .single(),
      supabase.from('job_descriptions').select('raw_text').eq('id', payload.targetId).single(),
    ])

    if (!job) {
      throw new Error('aiExtractionHandler: the job for this extraction could not be found.')
    }
    if (!jobDescription?.raw_text) {
      throw new Error(
        'aiExtractionHandler: this job description has no extractable text yet — an uploaded file needs its text extracted first, which is not available in this environment.',
      )
    }

    const outcome = await runRequirementExtraction({
      jobMetadata: {
        title: job.title,
        department: job.department,
        industry: job.industry,
        employmentType: job.employment_type,
        workplaceArrangement: job.workplace_arrangement,
        location: job.location,
      },
      documentText: jobDescription.raw_text,
      provider: overrides.provider,
    })

    if (outcome.status === 'not_configured') {
      return {
        status: 'not_configured',
        requirementCount: 0,
        message:
          outcome.errorMessage ?? 'AI requirement extraction is not available in this environment.',
      }
    }

    if (outcome.status === 'error') {
      // A genuine transport/provider failure (AIProviderError path — see
      // extract-requirements.ts's `attempt()`), not the deterministic
      // `not_configured` value above or a `rejected_by_validation` model-
      // output issue. Worth a monitoring event distinct from either.
      captureMonitoringMessage(
        `AI requirement extraction failed: ${outcome.errorMessage ?? 'unknown error'}`,
        'error',
        {
          category: 'ai_provider',
          organizationId: context.organizationId,
          extra: {
            workflowType: 'requirement_extraction',
            model: outcome.model,
            retried: outcome.retried,
          },
        },
      )
    }

    const { data: aiRun } = await supabase
      .from('ai_runs')
      .insert({
        organization_id: context.organizationId,
        workflow_type: 'requirement_extraction',
        model: outcome.model ?? 'unknown',
        prompt_version: outcome.promptVersion,
        status: outcome.status,
        input_ref: payload.targetId,
        output_json: outcome.rawOutput,
        error_message: outcome.errorMessage,
        confidence: null,
        input_tokens: outcome.inputTokens,
        output_tokens: outcome.outputTokens,
        cost_usd: outcome.costUsd,
        latency_ms: outcome.latencyMs,
        created_by: actorId,
      })
      .select('id')
      .single()

    let requirementCount = 0
    if (outcome.status === 'success' && outcome.validated) {
      const rows = outcome.validated.requirements.map((requirement) => ({
        organization_id: context.organizationId,
        job_id: payload.jobId,
        job_description_id: payload.targetId,
        name: requirement.name,
        description: requirement.description,
        category: requirement.category,
        type: requirement.type,
        weight: requirement.type === 'preferred' ? requirement.weight : null,
        evidence_expected: requirement.evidenceExpected,
        source_text: requirement.sourceText,
        source_location: requirement.sourceLocation,
        confidence: requirement.confidence,
        verification_status: 'unverified',
        status: 'proposed',
        ai_generated: true,
        created_by: actorId,
      }))

      if (rows.length > 0) {
        const { data: inserted, error: insertError } = await supabase
          .from('job_requirements')
          .insert(rows)
          .select('id')
        if (insertError) {
          throw new Error(
            'aiExtractionHandler: AI extraction succeeded, but saving the proposed requirements failed — nothing was recorded as reviewable.',
          )
        }
        requirementCount = inserted?.length ?? 0
      }
    }

    const extractionResultStatus =
      outcome.status === 'success'
        ? 'completed'
        : outcome.status === 'rejected_by_validation'
          ? 'failed_validation'
          : 'error'

    await supabase.from('requirement_extraction_results').insert({
      organization_id: context.organizationId,
      job_description_id: payload.targetId,
      ai_run_id: aiRun?.id ?? null,
      status: extractionResultStatus,
      requirement_count: requirementCount,
    })

    await logAuditEvent(
      {
        organizationId: context.organizationId,
        actorId,
        action:
          outcome.status === 'success' ? 'requirement.extracted' : 'requirement.extraction_failed',
        entityType: 'job_descriptions',
        entityId: payload.targetId,
        metadata: { status: outcome.status, requirementCount, retried: outcome.retried },
      },
      supabase,
    )

    if (outcome.status === 'success' && payload.recruitmentProjectId) {
      await logProjectActivity(
        {
          organizationId: context.organizationId,
          recruitmentProjectId: payload.recruitmentProjectId,
          actorId,
          action: 'requirement.extracted',
          summary: `AI proposed ${requirementCount} requirement(s) for review.`,
        },
        supabase,
      )
    }

    return {
      status: outcome.status,
      requirementCount,
      message:
        outcome.status === 'success'
          ? `Extracted ${requirementCount} requirement(s) for review.`
          : outcome.status === 'rejected_by_validation'
            ? 'The AI response did not match the required structure and was rejected — nothing was added automatically. You can add requirements manually below.'
            : 'AI extraction failed. You can add requirements manually below.',
    }
  }
}

/** The registered handler — no provider override, so the live path always resolves the real, `anthropicConfigured`-gated AnthropicProvider. */
export const aiExtractionHandler: JobHandler<AiExtractionPayload, AiExtractionResult> =
  createAiExtractionHandler()
