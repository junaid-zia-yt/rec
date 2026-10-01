/**
 * Build Phase 12, Wave 2 — the durable job engine's core types.
 *
 * `BackgroundJobType`/`BackgroundJobStatus`/`BackgroundJob` are NOT
 * redefined here: they already exist in `@rqi/types` (added by Wave 1
 * against `supabase/migrations/0032_integrations_jobs_notifications.sql`)
 * and are re-exported below so every file in this directory has one import
 * source. Note the deliberate NAME COLLISION this avoids: `@rqi/types`
 * already exports an unrelated `JobStatus` (`'open' | 'filled' |
 * 'cancelled'`, a recruitment job posting's status — see
 * `packages/types/src/index.ts` line ~157). This engine never imports or
 * re-exports that one; every symbol here is prefixed `BackgroundJob*` to
 * keep the two worlds unambiguous at every call site.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { BackgroundJob, BackgroundJobStatus, BackgroundJobType } from '@rqi/types'

export type { BackgroundJob, BackgroundJobStatus, BackgroundJobType }
export {
  BackgroundJobSchema,
  BackgroundJobStatus as BackgroundJobStatusEnum,
  BackgroundJobType as BackgroundJobTypeEnum,
} from '@rqi/types'

/**
 * Everything a job handler receives beyond its own validated payload.
 *
 * - `organizationId`/`correlationId` are pulled straight off the claimed
 *   `background_jobs` row — a handler never has to re-derive them.
 * - `signal` fires when the executor's wall-clock timeout (or an outer
 *   cancellation) elapses, mirroring `run-copilot-turn.ts`'s
 *   `AbortController`/`Promise.race` pattern (Build Phase 11) exactly. A
 *   handler that performs real I/O (an HTTP call, an Anthropic request)
 *   should pass this signal through to that call so the underlying request
 *   is actually aborted, not just abandoned — the same "cooperative
 *   checking is not enough on its own" caveat that file documents.
 * - `supabase` is the SAME client the executor itself is running under —
 *   per Wave 1's RLS note (0032: no service-role-only write path exists for
 *   `background_jobs`), every write this engine makes, including a
 *   handler's own domain writes, happens through the caller's own
 *   authenticated session. A handler must never construct its own
 *   Supabase client.
 */
export interface JobExecutionContext {
  organizationId: string
  correlationId: string
  jobId: string
  attemptCount: number
  signal: AbortSignal
  /** The real `SupabaseClient` type. `test-fake-supabase.ts`'s fake (Build Phase 11) is cast `as unknown as SupabaseClient` at its own construction site, so a handler under test still sees this exact type — no separate test-only type needed here. */
  supabase: SupabaseClient
}

/**
 * A registered handler for one `BackgroundJobType`. `TPayload` is that job
 * type's validated payload shape (from `job-payload-schemas.ts`); `TResult`
 * is whatever JSON-serializable result the handler wants recorded (never
 * required to be meaningful — most handlers can return `void`/`null`).
 *
 * Contract (enforced by `executor.ts`, not by this type alone): a handler
 * may throw, reject, or return normally — the executor treats ALL THREE the
 * same way for a thrown/rejected error (caught, turned into a `failed`
 * transition, never allowed to crash the caller). A handler should NOT
 * catch its own errors just to swallow them; let them propagate so the
 * executor's retry/dead-letter bookkeeping actually runs.
 */
export type JobHandler<TPayload = unknown, TResult = unknown> = (
  payload: TPayload,
  context: JobExecutionContext,
) => Promise<TResult>

/** A type-erased handler, as stored in the `handlers` registry `executeJob` is given (each entry's payload has already been validated against that job type's schema by `enqueueJob`, so the registry can safely widen to `unknown` here). */
export type AnyJobHandler = JobHandler<unknown, unknown>

/** `Partial` on purpose — Wave 2 ships an EMPTY registry save for `notification_dispatch` (see `handlers/index.ts`); later waves add their own job type's entry without needing to touch every other one. */
export type JobHandlerRegistry = Partial<Record<BackgroundJobType, AnyJobHandler>>

/**
 * The result `executeJob` returns to its own caller (a cron route, a
 * fire-and-await inline caller) — distinct from the DB row's `status`
 * column, which only has 6 values; this is richer because the caller
 * often needs to know WHY a `failed` row ended up `queued` again vs.
 * `dead_lettered` without a second query.
 */
export type JobExecutionOutcome =
  | { kind: 'succeeded'; jobId: string; result: unknown }
  | {
      kind: 'failed_will_retry'
      jobId: string
      attemptCount: number
      nextAttemptAt: string
      errorMessage: string
    }
  /** NOT the same thing as `dead_lettered`: this is `claim-due-jobs.ts`'s outcome for a job whose retry/dead-letter bookkeeping never even ran because `executeJob` itself threw (a genuine DB/infra error — the claim UPDATE or a status-write failing), as opposed to the handler failing normally. The row's own DB status is left whatever it was when the throw happened, most likely still `running`. */
  | { kind: 'failed_permanently'; jobId: string; errorMessage: string }
  | { kind: 'dead_lettered'; jobId: string; errorMessage: string }
  | { kind: 'cancelled'; jobId: string }
  /** The optimistic claim (`queued` -> `running`) did not land — another caller already claimed it, or it was no longer `queued` for some other reason. Not an error: this is the expected, harmless outcome of two callers racing to claim the same due job. */
  | { kind: 'not_claimed'; jobId: string }
  /** No handler is registered for this job's `job_type` yet (a later wave owns it) — the job is left exactly as claimed (`running`) is NOT entered; the claim is released back to `queued` so a future run (once a handler exists) can pick it up, rather than silently stranding it. */
  | { kind: 'no_handler'; jobId: string; jobType: BackgroundJobType }
