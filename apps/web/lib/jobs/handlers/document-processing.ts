/**
 * `document_processing` job handler — Build Phase 14, Wave 4b. Fills the
 * registry slot `handlers/index.ts`'s own header note lists as deliberately
 * empty.
 *
 * WHAT THIS MOVES: `lib/candidates/document-processing-actions.ts`'s shared
 * `runProcessingJob` helper's OWN header comment said it plainly: "Runs the
 * pipeline inline and synchronously... a future phase can move the pipeline
 * body into an actual background worker without changing this action's
 * contract." This handler is that move — every DB write below (the
 * `candidate_document_processing_jobs` status walk `queued` ->
 * `extracting_text` -> `parsing` -> a terminal status, the storage download,
 * the AI pipeline call, the `candidate_extracted_fields` insert, the audit
 * row) is the EXACT SAME write `runProcessingJob` used to perform inline,
 * moved here unchanged in substance. The calling action's contract really is
 * unchanged: `startCandidateDocumentProcessingAction`/
 * `reprocessCandidateDocumentAction` still return the same `ActionResult`
 * shape, computed from this handler's result via the job engine's "enqueue
 * and try now" pattern (`enqueueJob` immediately followed by `executeJob` in
 * the same request — see `matching-actions.ts`'s identical pattern for the
 * `candidate_evaluation` job type).
 *
 * RETRY-SAFETY OF THE JOB ROW ITSELF: `candidate_document_processing_jobs`
 * already has its own idempotency key
 * (`computeProcessingIdempotencyKey(candidateDocumentId, attemptNo)`,
 * unique per migration 0022) that this handler reuses byte-for-byte (via
 * `payload.attemptNo`, not a re-derived count — see `job-payload-schemas.ts`'s
 * note on why). A background-job-level RETRY of this exact job (same
 * `attemptNo`, hence the same idempotency key) must therefore never attempt
 * a second INSERT of that row — it looks up any row already created under
 * this key first and reuses/advances it, exactly like `enqueueJob` itself
 * looks up an existing `background_jobs` row before inserting.
 */
import 'server-only'
import { logAuditEvent } from '@/lib/audit/log'
import { captureMonitoringMessage } from '@/lib/monitoring/capture'
import { downloadDocumentBytes } from '@/lib/files/storage'
import { runCandidateDocumentProcessingPipeline } from '@/lib/candidates/document-processing-pipeline'
import {
  computeProcessingIdempotencyKey,
  mapExtractionOutputToFieldRows,
} from '@/lib/candidates/document-processing'
import type { CandidateAIProvider } from '@/lib/ai/candidate-provider'
import type { OcrAdapter } from '@/lib/candidates/ocr-adapter'
import type { DocumentProcessingPayload } from '../job-payload-schemas'
import type { JobExecutionContext, JobHandler } from '../types'

export interface DocumentProcessingResult {
  jobStatus: 'awaiting_review' | 'needs_ocr' | 'failed'
  processingJobId: string
  errorMessage: string | null
}

/** Transport/timeout-shaped error kinds worth an automatic job-engine retry — mirrors `matching-pipeline`'s own retryable/non-retryable split (see `candidate-evaluation.ts`). Everything else (`corrupted_file`, `ocr_not_configured`, `ai_not_configured`, `validation_failed`) is a deterministic outcome that retrying cannot change. */
const RETRYABLE_ERROR_KINDS = new Set(['timeout', 'network', 'provider_error'])

/**
 * Factory, not a bare handler — mirrors `runCandidateDocumentProcessingPipeline`'s
 * own `aiProvider`/`ocrAdapter` injection seam
 * (`lib/candidates/document-processing-pipeline.ts`): the registered
 * `documentProcessingHandler` below calls it with no override, while a test
 * supplies the deterministic test doubles already established by
 * `document-processing-pipeline.test.ts`.
 */
export function createDocumentProcessingHandler(
  overrides: { aiProvider?: CandidateAIProvider; ocrAdapter?: OcrAdapter } = {},
): JobHandler<DocumentProcessingPayload, DocumentProcessingResult> {
  return async (payload, context: JobExecutionContext) => {
    const supabase = context.supabase
    const idempotencyKey = computeProcessingIdempotencyKey(
      payload.candidateDocumentId,
      payload.attemptNo,
    )

    const { data: authData } = await supabase.auth.getUser()
    const actorId = authData?.user?.id ?? null
    if (!actorId) {
      throw new Error('documentProcessingHandler: no authenticated user on this execution context.')
    }

    // Retry-safe job-row creation: reuse an existing row under this exact
    // idempotency key (a prior attempt at running THIS SAME job) rather than
    // risk a unique-constraint violation on a second insert.
    const { data: existingJob } = await supabase
      .from('candidate_document_processing_jobs')
      .select('id')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle()

    let processingJobId: string
    if (existingJob) {
      processingJobId = existingJob.id as string
    } else {
      const { data: inserted, error: jobInsertError } = await supabase
        .from('candidate_document_processing_jobs')
        .insert({
          organization_id: context.organizationId,
          candidate_id: payload.candidateId,
          candidate_document_id: payload.candidateDocumentId,
          status: 'queued',
          idempotency_key: idempotencyKey,
          attempt_no: payload.attemptNo,
          reprocess_of_job_id: payload.reprocessOfJobId ?? null,
          reprocess_reason: payload.reprocessReason ?? null,
          requested_by: actorId,
        })
        .select('id')
        .single()

      if (jobInsertError || !inserted) {
        throw new Error(
          `documentProcessingHandler: could not create the processing job row: ${jobInsertError?.message ?? 'unknown error'}`,
        )
      }
      processingJobId = inserted.id as string
    }

    const { data: candidateDocument } = await supabase
      .from('candidate_documents')
      .select('document_upload_id')
      .eq('id', payload.candidateDocumentId)
      .single()

    const { data: upload } = candidateDocument
      ? await supabase
          .from('document_uploads')
          .select('storage_path, mime_type')
          .eq('id', candidateDocument.document_upload_id)
          .single()
      : { data: null }

    if (!upload) {
      await supabase
        .from('candidate_document_processing_jobs')
        .update({
          status: 'failed',
          error_kind: 'corrupted_file',
          error_message: 'The source document could not be found.',
          completed_at: new Date().toISOString(),
        })
        .eq('id', processingJobId)
      await logAuditEvent(
        {
          organizationId: context.organizationId,
          actorId,
          action: 'candidate.document_processing_failed',
          entityType: 'candidate_document_processing_jobs',
          entityId: processingJobId,
          metadata: {
            candidateDocumentId: payload.candidateDocumentId,
            attemptNo: payload.attemptNo,
            errorKind: 'corrupted_file',
          },
        },
        supabase,
      )
      return {
        jobStatus: 'failed',
        processingJobId,
        errorMessage: 'The source document could not be found.',
      }
    }

    await supabase
      .from('candidate_document_processing_jobs')
      .update({ status: 'extracting_text' })
      .eq('id', processingJobId)

    let bytes: Uint8Array
    try {
      const downloaded = await downloadDocumentBytes(supabase, upload.storage_path)
      bytes = downloaded.bytes
    } catch {
      await supabase
        .from('candidate_document_processing_jobs')
        .update({
          status: 'failed',
          error_kind: 'corrupted_file',
          error_message: 'The source document could not be read from storage.',
          completed_at: new Date().toISOString(),
        })
        .eq('id', processingJobId)
      await logAuditEvent(
        {
          organizationId: context.organizationId,
          actorId,
          action: 'candidate.document_processing_failed',
          entityType: 'candidate_document_processing_jobs',
          entityId: processingJobId,
          metadata: {
            candidateDocumentId: payload.candidateDocumentId,
            attemptNo: payload.attemptNo,
            errorKind: 'corrupted_file',
          },
        },
        supabase,
      )
      return {
        jobStatus: 'failed',
        processingJobId,
        errorMessage: 'The source document could not be read from storage.',
      }
    }

    await supabase
      .from('candidate_document_processing_jobs')
      .update({ status: 'parsing' })
      .eq('id', processingJobId)

    const result = await runCandidateDocumentProcessingPipeline({
      bytes,
      mimeType: upload.mime_type,
      aiProvider: overrides.aiProvider,
      ocrAdapter: overrides.ocrAdapter,
    })

    await supabase
      .from('candidate_document_processing_jobs')
      .update({
        status: result.jobStatus,
        text_extraction_method: result.textExtractionMethod,
        // Untrusted document content, written only to this RLS-protected,
        // never-client-visible, org-scoped row — never to logs.
        extracted_text: result.extractedText,
        extracted_char_count: result.extractedCharCount,
        error_kind: result.errorKind,
        error_message: result.errorMessage,
        ai_run_id: null,
        prompt_version: result.ai?.promptVersion ?? null,
        model: result.ai?.model ?? null,
        retried: result.ai?.retried ?? false,
        completed_at: new Date().toISOString(),
      })
      .eq('id', processingJobId)

    if (
      result.jobStatus === 'failed' &&
      result.errorKind &&
      ['timeout', 'network', 'provider_error', 'ai_not_configured'].includes(result.errorKind)
    ) {
      // An AI-provider-shaped failure (see RETRYABLE_ERROR_KINDS above for the
      // retryable subset — this also covers `ai_not_configured`, which is
      // deterministic and never retried, but is still an AI-failure-surface
      // event worth reporting).
      captureMonitoringMessage(
        `Candidate document AI processing failed: ${result.errorKind}`,
        'error',
        {
          category: 'ai_provider',
          organizationId: context.organizationId,
          extra: {
            candidateDocumentId: payload.candidateDocumentId,
            errorKind: result.errorKind,
            model: result.ai?.model ?? null,
          },
        },
      )
    }

    if (
      result.jobStatus === 'awaiting_review' &&
      result.ai?.status === 'success' &&
      result.ai.validated
    ) {
      const fieldRows = mapExtractionOutputToFieldRows(result.ai.validated)
      if (fieldRows.length > 0) {
        await supabase.from('candidate_extracted_fields').insert(
          fieldRows.map((row) => ({
            organization_id: context.organizationId,
            candidate_id: payload.candidateId,
            processing_job_id: processingJobId,
            field_group: row.fieldGroup,
            field_key: row.fieldKey,
            item_index: row.itemIndex,
            extracted_value: row.extractedValue,
            has_evidence: row.hasEvidence,
            source_document_id: payload.candidateDocumentId,
            source_location: row.sourceLocation,
            source_excerpt: row.sourceExcerpt,
            confidence: row.confidence,
            verification_status: 'pending',
          })),
        )
      }
    }

    await logAuditEvent(
      {
        organizationId: context.organizationId,
        actorId,
        action:
          result.jobStatus === 'awaiting_review'
            ? 'candidate.document_processing_completed'
            : result.jobStatus === 'needs_ocr'
              ? 'candidate.document_processing_needs_ocr'
              : 'candidate.document_processing_failed',
        entityType: 'candidate_document_processing_jobs',
        entityId: processingJobId,
        metadata: {
          candidateDocumentId: payload.candidateDocumentId,
          attemptNo: payload.attemptNo,
          reprocessReason: payload.reprocessReason ?? null,
          errorKind: result.errorKind,
        },
      },
      supabase,
    )

    if (
      result.jobStatus === 'failed' &&
      result.errorKind &&
      RETRYABLE_ERROR_KINDS.has(result.errorKind)
    ) {
      // A transport/timeout-shaped failure — the domain row above already
      // honestly records 'failed' (never left stale/fabricated), but this is
      // still worth the job engine's own backoff retry, so let it propagate.
      throw new Error(result.errorMessage ?? 'Processing failed.')
    }

    return { jobStatus: result.jobStatus, processingJobId, errorMessage: result.errorMessage }
  }
}

/** The registered handler — no overrides, so the live path always resolves the real AI provider / OCR adapter selection logic. */
export const documentProcessingHandler: JobHandler<
  DocumentProcessingPayload,
  DocumentProcessingResult
> = createDocumentProcessingHandler()
