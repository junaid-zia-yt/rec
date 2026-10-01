/**
 * The `JobHandlerRegistry` Wave 2 ships. Deliberately near-empty: only
 * `notification_dispatch` has a real handler this wave (see
 * `notification-dispatch.ts`'s own header note for why that one and not
 * the other six). `document_processing`, `ai_extraction`,
 * `candidate_evaluation`, `email_delivery`, and
 * `report_generation` have NO entry here — calling `executeJob` for a job
 * of one of those types today produces a `no_handler` outcome (see
 * `executor.ts`), which retries with backoff like any other failure and
 * eventually dead-letters if nothing ever registers a handler; that is the
 * correct, honest behavior for "the type exists in the schema but no wave
 * has built its real handler yet" — an empty slot here, not a placeholder
 * that pretends to do the work.
 *
 * Build Phase 12 Wave 3 adds ONE more entry: `integration_sync` (see
 * `integration-sync.ts`) — the first (and, this wave, only) slot filled in
 * after Wave 2, following the exact one-line pattern this file's own next
 * paragraph documents.
 *
 * Build Phase 12 Wave 4 adds TWO more changes:
 *   - `email_delivery` (see `email-delivery.ts`) — the last of Wave 2's
 *     originally-empty slots this wave fills.
 *   - `notification_dispatch` is RE-POINTED (not left as Wave 2's own
 *     `notificationDispatchHandler`) at
 *     `lib/notifications/notification-dispatch-handler.ts`'s
 *     `notificationDispatchWithEmailHandler` — a thin wrapper that calls
 *     Wave 2's original handler first (unmodified) and then adds the
 *     "also enqueue an `email_delivery` job when the recipient's
 *     `email_enabled` preference is on" decision that handler's own
 *     header note explicitly left for this wave. This is the SAME
 *     one-line-substitution extension point this file's next paragraph
 *     describes for a brand-new job type, just applied to an
 *     already-filled slot instead of an empty one.
 *
 * Build Phase 14, Wave 4b (security hardening / release candidate) fills
 * the THREE remaining originally-empty slots — `document_processing`,
 * `ai_extraction`, `candidate_evaluation` — closing out the Critical
 * performance-review finding that these three AI-heavy pipelines ran
 * synchronously inline inside their own `'use server'` actions instead of
 * through this engine. See each handler's own header note for exactly what
 * DB writes it moves (unchanged in substance) from which action file.
 *
 * HOW A LATER WAVE REGISTERS ITS OWN HANDLER (read this before adding one):
 * add your handler's own file next to this one (e.g.
 * `handlers/document-processing.ts`), export a `JobHandler<YourPayload,
 * YourResult>` from it exactly like `notification-dispatch.ts` does, then
 * add ONE line to `DEFAULT_JOB_HANDLERS` below: `document_processing:
 * documentProcessingHandler`. Nothing else in this directory needs to
 * change — `executor.ts`/`claim-due-jobs.ts` both take `handlers` as a
 * plain parameter (never import this file directly), so a caller
 * (typically a server action doing the inline "enqueue and try to run now"
 * path, or the future cron route) is the one that decides which registry
 * to pass. Most call sites should just import and pass
 * `DEFAULT_JOB_HANDLERS` from here so every caller stays in sync as the
 * registry grows; a test that wants to exercise one handler in isolation
 * can instead pass a narrower literal `{ document_processing: myHandler }`
 * without touching this file at all.
 */
import type { AnyJobHandler, JobHandlerRegistry } from '../types'
import { integrationSyncHandler } from './integration-sync'
import { emailDeliveryHandler } from './email-delivery'
import { documentProcessingHandler } from './document-processing'
import { aiExtractionHandler } from './ai-extraction'
import { candidateEvaluationHandler } from './candidate-evaluation'
import { notificationDispatchWithEmailHandler } from '@/lib/notifications/notification-dispatch-handler'

export const DEFAULT_JOB_HANDLERS: JobHandlerRegistry = {
  // Cast to AnyJobHandler is required (not a laziness shortcut): each
  // handler's real type is narrower than `(payload: unknown, ctx) =>
  // Promise<unknown>` (e.g. `JobHandler<NotificationDispatchPayload,
  // NotificationDispatchResult>`), and TypeScript's contravariant
  // parameter checking correctly refuses to widen a function's parameter
  // type implicitly. This is SAFE at runtime because `executor.ts` only
  // ever invokes the handler keyed under the SAME `job_type` whose payload
  // was validated against that exact type's schema in `enqueue.ts` — the
  // registry key is what keeps payload and handler in sync, not the type
  // system. Every later wave's own registry entry follows this identical
  // one-line pattern.
  //
  // Wave 4: `notification_dispatch` now points at
  // `notificationDispatchWithEmailHandler` (a wrapper around Wave 2's
  // original `notificationDispatchHandler`, still imported and called
  // unmodified from inside it) rather than that original handler directly
  // — see this file's own header note and
  // `lib/notifications/notification-dispatch-handler.ts`'s.
  notification_dispatch: notificationDispatchWithEmailHandler as AnyJobHandler,
  integration_sync: integrationSyncHandler as AnyJobHandler,
  email_delivery: emailDeliveryHandler as AnyJobHandler,
  document_processing: documentProcessingHandler as AnyJobHandler,
  ai_extraction: aiExtractionHandler as AnyJobHandler,
  candidate_evaluation: candidateEvaluationHandler as AnyJobHandler,
}
