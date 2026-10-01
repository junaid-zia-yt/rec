/**
 * Per-job-type payload schema registry (Build Phase 12 brief: validate
 * BEFORE insert, never store an unvalidated payload). One Zod schema per
 * `BackgroundJobType`, keyed so `enqueueJob` can look one up generically —
 * `JOB_PAYLOAD_SCHEMAS[jobType].parse(payload)` is the ONLY way a payload
 * reaches `background_jobs.payload`.
 *
 * These shapes are Wave 2's own judgment call (the brief specifies the 7
 * job TYPES, not their payload shapes) — chosen to be the smallest useful
 * envelope each domain plausibly needs, built from identifiers that already
 * exist elsewhere in this schema (candidate/document/job ids,
 * `NotificationEventType`, `IntegrationProvider`) rather than inventing new
 * ones. A later wave that owns a given job type's real handler is free to
 * widen its schema (e.g. add optional fields) — narrowing or removing a
 * field is a breaking change for anything already enqueued with the old
 * shape and should go through a migration-note, not a silent edit here.
 *
 * `payload` itself is untrusted-shaped input (comes from a server action's
 * own validated request, but this module doesn't know that) — every schema
 * is `.strict()` so an unexpected extra field is rejected rather than
 * silently stored, matching this codebase's "AI/external data is always
 * validated" convention (docs/12-security-compliance.md).
 */
import { z } from 'zod'
import { IntegrationProvider, NotificationEventType, type BackgroundJobType } from '@rqi/types'

const uuid = z.string().uuid()

/**
 * `document_processing`: (re-)run the candidate-document text extraction /
 * OCR / parse pipeline (Build Phase 5's `candidate_document_processing_jobs`
 * — see `supabase/migrations/0022`) for one uploaded document.
 *
 * `attemptNo`/`reprocessOfJobId`/`reprocessReason` — ADDED Build Phase 14,
 * Wave 4b (additive, per this module's own header note: widening an
 * existing shape is safe, narrowing is not) — when `lib/candidates/
 * document-processing-actions.ts` was moved onto this job engine, its
 * handler needs the SAME attempt number the action already computes (to
 * rebuild `computeProcessingIdempotencyKey`'s identical value, and to write
 * `candidate_document_processing_jobs.attempt_no` exactly as the pre-job-
 * engine inline code did) rather than recomputing it itself from a second,
 * possibly-racing COUNT query.
 */
export const DocumentProcessingPayloadSchema = z
  .object({
    candidateId: uuid,
    candidateDocumentId: uuid,
    attemptNo: z.number().int().min(1),
    reprocessOfJobId: uuid.nullable().optional(),
    reprocessReason: z.string().trim().max(1000).nullable().optional(),
  })
  .strict()
export type DocumentProcessingPayload = z.infer<typeof DocumentProcessingPayloadSchema>

/**
 * `ai_extraction`: run the requirement/field-extraction AI step (Build Phase
 * 4/5's `extract-requirements.ts`/`parse-candidate-document.ts`) against one
 * already-uploaded source document. `targetType` distinguishes a job
 * description extraction from a candidate document extraction — the two
 * pipelines write to different tables and this is the only field a handler
 * needs to route between them.
 *
 * `jobId`/`recruitmentProjectId` — ADDED Build Phase 14, Wave 4b (additive):
 * `lib/jobs/handlers/ai-extraction.ts` only implements the `job_description`
 * branch (requirement extraction) so far — that branch needs the parent
 * job's own id (to load its title/department/... metadata and to stamp
 * `job_requirements.job_id`) and, optionally, the recruitment project id
 * (to log the human-facing `project_activity` row the pre-job-engine action
 * already wrote on success) — neither of which `targetId` (the
 * `job_descriptions.id`) alone can supply. Both are optional at the schema
 * level because the OTHER branch (`targetType: 'candidate_document'`) has no
 * handler yet and may not need either field once it is built.
 */
export const AiExtractionPayloadSchema = z
  .object({
    targetType: z.enum(['job_description', 'candidate_document']),
    targetId: uuid,
    jobId: uuid.optional(),
    recruitmentProjectId: uuid.optional(),
  })
  .strict()
export type AiExtractionPayload = z.infer<typeof AiExtractionPayloadSchema>

/**
 * `candidate_evaluation`: run the evidence-based matching assessment (Build
 * Phase 6/7's `run-matching-assessment.ts`) for one candidate against one
 * job.
 *
 * `attemptNo`/`triggerReason`/`triggerNote` — ADDED Build Phase 14, Wave 4b
 * (additive): `lib/matching/matching-actions.ts`'s handler needs the same
 * attempt number the action already computes (to rebuild the identical
 * `matching_runs.idempotency_key` value —
 * `${candidateId}:${jobId}:${attemptNo}`, unique per organization at the DB
 * layer per `supabase/migrations/0027`) rather than recomputing it from a
 * second, possibly-racing COUNT query, plus the two fields the original
 * inline action accepted straight from its own form input.
 */
export const CandidateEvaluationPayloadSchema = z
  .object({
    candidateId: uuid,
    jobId: uuid,
    attemptNo: z.number().int().min(1),
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
  .strict()
export type CandidateEvaluationPayload = z.infer<typeof CandidateEvaluationPayloadSchema>

/** `notification_dispatch`: create one in-app (and, once a later wave wires Resend, email) notification for one recipient — the exact shape `notifications`' own insertable columns need (0032), minus `organization_id`/`id`/`created_at` which the row itself/the job's own `organization_id` already supply. */
export const NotificationDispatchPayloadSchema = z
  .object({
    recipientUserId: uuid,
    eventType: NotificationEventType,
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().max(2000).optional(),
    resourceType: z.string().trim().min(1).max(100).optional(),
    resourceId: uuid.optional(),
  })
  .strict()
  .refine((v) => (v.resourceType == null) === (v.resourceId == null), {
    message:
      'resourceType and resourceId must be supplied together or not at all (mirrors notifications_resource_pair, 0032)',
  })
export type NotificationDispatchPayload = z.infer<typeof NotificationDispatchPayloadSchema>

/**
 * `email_delivery`: send one email over the existing Resend adapter
 * (`lib/outreach/channels/email.ts`). Two alternative shapes (a plain
 * `z.union`, not `z.discriminatedUnion` — see note below):
 *
 *   - The ORIGINAL Build Phase 9 shape (`outreachMessageId`/
 *     `attemptNumber`): send one already-approved outreach message over
 *     its chosen channel. `attemptNumber` feeds
 *     `generateOutreachIdempotencyKey` exactly as that module documents.
 *     UNCHANGED by this wave — no field was narrowed or removed, so
 *     nothing already enqueued under this shape is broken (this module's
 *     own header note on schema evolution).
 *   - The NEW Build Phase 12 Wave 4 shape (`notificationId`/
 *     `recipientUserId`/`eventType`/`attemptNumber`): send one
 *     already-written `notifications` row's email, enqueued by
 *     `lib/notifications/notification-dispatch-handler.ts` as a follow-on
 *     job once it confirms the recipient's `email_enabled` preference is
 *     on (see that handler's own header note for the full dispatch
 *     chain). `recipientUserId`/`eventType` are carried alongside
 *     `notificationId` so `lib/jobs/handlers/email-delivery.ts` never
 *     needs a second DB round trip just to know who the email is for or
 *     which template to use.
 *
 * A plain `z.union` (not `z.discriminatedUnion`) is used deliberately: the
 * ORIGINAL shape has no discriminant field at all (adding one now would
 * itself be the exact "narrowing an existing shape" breaking change this
 * module's header note warns against) — Zod's plain union tries each
 * branch in order and accepts the first that parses, which works cleanly
 * here since the two shapes' required keys never overlap
 * (`outreachMessageId` vs. `notificationId`). `lib/jobs/handlers/
 * email-delivery.ts` discriminates the parsed result at runtime via
 * `'outreachMessageId' in payload`.
 */
export const OutreachEmailDeliveryPayloadSchema = z
  .object({
    outreachMessageId: uuid,
    attemptNumber: z.number().int().min(1),
  })
  .strict()
export type OutreachEmailDeliveryPayload = z.infer<typeof OutreachEmailDeliveryPayloadSchema>

export const NotificationEmailDeliveryPayloadSchema = z
  .object({
    notificationId: uuid,
    recipientUserId: uuid,
    eventType: NotificationEventType,
    attemptNumber: z.number().int().min(1),
  })
  .strict()
export type NotificationEmailDeliveryPayload = z.infer<
  typeof NotificationEmailDeliveryPayloadSchema
>

export const EmailDeliveryPayloadSchema = z.union([
  OutreachEmailDeliveryPayloadSchema,
  NotificationEmailDeliveryPayloadSchema,
])
export type EmailDeliveryPayload = z.infer<typeof EmailDeliveryPayloadSchema>

/** `integration_sync`: run one sync pass for an `integration_connections` row (Wave 3's adapter clients). `provider` is carried in the payload (not just looked up from `integrationConnectionId`) so a handler's very first move — checking whether this provider/mode combination is even allowed to sync (see 0032's TA Tracker API-mode honesty constraint) — never requires a DB round trip first. */
export const IntegrationSyncPayloadSchema = z
  .object({
    integrationConnectionId: uuid,
    provider: IntegrationProvider,
  })
  .strict()
export type IntegrationSyncPayload = z.infer<typeof IntegrationSyncPayloadSchema>

/** `report_generation`: compute/materialize a report-shaped artifact (e.g. a POC results comparison, Build Phase 10) for one resource. Kept deliberately generic — no dedicated "reports" table exists yet in this schema, so `reportType` is an open string this wave does not allowlist further; a later wave that builds a real report_generation handler should tighten this to a closed enum once it knows the actual report types it supports. */
export const ReportGenerationPayloadSchema = z
  .object({
    reportType: z.string().trim().min(1).max(100),
    resourceId: uuid,
  })
  .strict()
export type ReportGenerationPayload = z.infer<typeof ReportGenerationPayloadSchema>

/** The registry `enqueueJob` validates every payload against, keyed by `BackgroundJobType`. */
export const JOB_PAYLOAD_SCHEMAS = {
  document_processing: DocumentProcessingPayloadSchema,
  ai_extraction: AiExtractionPayloadSchema,
  candidate_evaluation: CandidateEvaluationPayloadSchema,
  notification_dispatch: NotificationDispatchPayloadSchema,
  email_delivery: EmailDeliveryPayloadSchema,
  integration_sync: IntegrationSyncPayloadSchema,
  report_generation: ReportGenerationPayloadSchema,
} satisfies Record<BackgroundJobType, z.ZodType>

/** Validates `payload` against `jobType`'s schema, returning the parsed (and thereby narrowed) payload or throwing the Zod error — `enqueueJob` is the only intended caller; exported separately so a test can exercise validation in isolation. */
export function validateJobPayload(jobType: BackgroundJobType, payload: unknown) {
  return JOB_PAYLOAD_SCHEMAS[jobType].parse(payload)
}
