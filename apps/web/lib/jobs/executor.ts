/**
 * `executeJob` — claims ONE `background_jobs` row and runs it through its
 * registered handler (Build Phase 12 brief). This is the engine's core: the
 * optimistic claim, the wall-clock timeout, the never-throws error
 * boundary around the handler, and the retry/dead-letter decision all live
 * here.
 *
 * THE OPTIMISTIC CLAIM — HONEST LIMITATIONS (read before relying on this):
 * there is no queue broker in this deployment (Vercel serverless, no
 * Redis/SQS — see this wave's brief) doing exclusive delivery for us, so
 * "claiming" a job is a single `UPDATE ... WHERE id = $1 AND status =
 * 'queued'` that only succeeds (returns a row) if the job was STILL queued
 * at the instant Postgres evaluated the WHERE clause. This is a
 * BEST-EFFORT claim under RLS-scoped, row-level atomicity — it is NOT a
 * true distributed lock, and it has real, honest risk windows:
 *   1. Postgres's own single-row UPDATE is atomic against another
 *      concurrent UPDATE of the SAME row — two callers racing to claim the
 *      same job cannot both succeed, which is the actual guarantee this
 *      mechanism provides and the one that matters most (no double
 *      processing of one job).
 *   2. It provides NO protection once a job has been claimed: if the
 *      claiming process is killed mid-handler (a Vercel function timeout,
 *      a crash, a deploy) the row is left `running` forever with no
 *      heartbeat and no lease expiry — nothing in this wave detects or
 *      reclaims a stuck `running` row. `claimDueJobs` only ever selects
 *      `queued` rows, so a stuck `running` job is invisible to it. This is
 *      the single biggest gap an operator/later wave should know about: a
 *      `running` row with `updated_at` far in the past is a crash symptom,
 *      and a stale-running sweep (e.g. "any `running` row whose
 *      `updated_at` is older than N minutes gets forced back to `failed`
 *      so the normal retry/dead-letter logic can take over") is a natural
 *      Wave 5 addition this wave deliberately does not build (no evidence
 *      yet of how long a real handler legitimately runs in this
 *      deployment, and inventing a guessed threshold now would be exactly
 *      the kind of unverified claim project conventions forbid).
 *   3. This engine executes using the CALLER's own authenticated Supabase
 *      session (per 0032's RLS note: no service-role-only write path
 *      exists for `background_jobs`) — so `executeJob`/`claimDueJobs` can
 *      only ever claim and progress jobs belonging to organizations the
 *      calling session is actually a member of. A true cross-org cron
 *      sweep is not possible without a session that is itself a member of
 *      every org (or one invocation per org) — see `claim-due-jobs.ts`'s
 *      own header note.
 *
 * NEVER LOGS PAYLOAD: nothing in this file writes `payload` or the full
 * `lastError` object to console/stdout — only job id/type/correlationId
 * and a short, structured error summary ever reach a log line, matching
 * the brief's "no sensitive payloads in ordinary logs" requirement.
 */
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logAuditEvent } from '@/lib/audit/log'
import { captureMonitoringMessage } from '@/lib/monitoring/capture'
import { calculateNextAttemptAt } from './backoff'
import { canTransitionJobStatus } from './status-transitions'
import type {
  AnyJobHandler,
  BackgroundJobType,
  JobExecutionOutcome,
  JobHandlerRegistry,
} from './types'

/** Default wall-clock budget for one handler invocation. Mirrors `run-copilot-turn.ts`'s `DEFAULT_TURN_TIMEOUT_MS` pattern (a named constant, overridable per call, never a bare magic number). 60s: generous enough for a real AI/document-processing call, short enough that a genuinely hung handler doesn't tie up a serverless invocation indefinitely. */
export const DEFAULT_JOB_TIMEOUT_MS = 60_000

/** Thrown internally when `handlers` has no entry for the claimed job's `job_type` — caught by the same error-handling path as any handler-thrown error (see this file's module comment), so a job with no registered handler simply retries/dead-letters like any other failure, and the outcome the caller sees is still distinguishable via `JobExecutionOutcome`'s `kind: 'no_handler'`. */
class NoHandlerRegisteredError extends Error {
  constructor(public readonly jobType: BackgroundJobType) {
    super(`No handler registered for job type "${jobType}"`)
    this.name = 'NoHandlerRegisteredError'
  }
}

/** Races `work` against `signal` firing — necessary because neither a handler's own async body nor an in-flight fetch is guaranteed to notice `AbortSignal.abort()` on its own; mirrors `run-copilot-turn.ts`'s `raceAgainstAbort` exactly. The loser is abandoned (never awaited further); any writes it already made stay exactly as they are. */
function raceAgainstAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error('__job_timeout__'))
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

interface JobRow {
  id: string
  organization_id: string
  job_type: BackgroundJobType
  payload: Record<string, unknown>
  correlation_id: string
  attempt_count: number
  max_attempts: number
}

export interface ExecuteJobParams {
  jobId: string
  supabase: SupabaseClient
  handlers: JobHandlerRegistry
  timeoutMs?: number
}

/** Structured, non-sensitive error summary for `last_error`/audit metadata — deliberately excludes anything from the job's own `payload` and truncates a handler error's message so an unexpectedly huge thrown value never balloons the column. */
function summarizeError(error: unknown): { message: string; errorClass: string } {
  if (error instanceof Error) {
    return { message: error.message.slice(0, 1000), errorClass: error.name }
  }
  return { message: String(error).slice(0, 1000), errorClass: 'UnknownError' }
}

export async function executeJob(params: ExecuteJobParams): Promise<JobExecutionOutcome> {
  const { jobId, supabase, handlers } = params

  // ---- Step 1: optimistic claim (queued -> running) --------------------
  // See this file's module comment for the exact guarantee/limitation this
  // provides. `updated_at` is bumped by the table's own `set_updated_at`
  // trigger — no need to set it explicitly here.
  const claimResult = await supabase
    .from('background_jobs')
    .update({ status: 'running' })
    .eq('id', jobId)
    .eq('status', 'queued')
    .select('id, organization_id, job_type, payload, correlation_id, attempt_count, max_attempts')
    .maybeSingle()

  if (claimResult.error) {
    throw new Error(`executeJob: claim failed for job ${jobId}: ${claimResult.error.message}`)
  }
  const job = claimResult.data as JobRow | null
  if (!job) {
    return { kind: 'not_claimed', jobId }
  }

  const { data: authData } = await supabase.auth.getUser()
  const actorId = authData?.user?.id ?? null

  if (actorId) {
    await logAuditEvent(
      {
        organizationId: job.organization_id,
        actorId,
        action: 'job.started',
        entityType: 'background_jobs',
        entityId: job.correlation_id,
        after: { status: 'running' },
        metadata: { jobId: job.id, jobType: job.job_type, attemptCount: job.attempt_count },
      },
      supabase,
    )
  }

  // ---- Step 2: run the handler under a hard wall-clock timeout ---------
  const handler: AnyJobHandler | undefined = handlers[job.job_type]

  const controller = new AbortController()
  const timeoutMs = params.timeoutMs ?? DEFAULT_JOB_TIMEOUT_MS
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs)

  let handlerError: unknown = null
  let handlerResult: unknown = undefined
  try {
    if (!handler) {
      throw new NoHandlerRegisteredError(job.job_type)
    }
    handlerResult = await raceAgainstAbort(
      handler(job.payload, {
        organizationId: job.organization_id,
        correlationId: job.correlation_id,
        jobId: job.id,
        attemptCount: job.attempt_count + 1,
        signal: controller.signal,
        supabase,
      }),
      controller.signal,
    )
  } catch (error) {
    // Never let a handler crash the executor (brief requirement) — every
    // thrown/rejected error, including the timeout's own synthetic one
    // above, is caught here and turned into a typed failure outcome.
    handlerError = error
  } finally {
    clearTimeout(timeoutHandle)
  }

  // ---- Step 3a: success --------------------------------------------------
  if (!handlerError) {
    if (!canTransitionJobStatus('running', 'succeeded')) {
      // Structurally unreachable given status-transitions.ts's graph, but
      // guarded rather than assumed, per this codebase's convention of
      // never writing a status update the graph itself would reject.
      throw new Error('executeJob: running -> succeeded is not a legal transition')
    }
    const { error: updateError } = await supabase
      .from('background_jobs')
      .update({ status: 'succeeded' })
      .eq('id', job.id)
    if (updateError) {
      throw new Error(`executeJob: could not mark job ${job.id} succeeded: ${updateError.message}`)
    }
    if (actorId) {
      await logAuditEvent(
        {
          organizationId: job.organization_id,
          actorId,
          action: 'job.completed',
          entityType: 'background_jobs',
          entityId: job.correlation_id,
          after: { status: 'succeeded' },
          metadata: { jobId: job.id, jobType: job.job_type },
        },
        supabase,
      )
    }
    return { kind: 'succeeded', jobId: job.id, result: handlerResult }
  }

  // ---- Step 3b: failure — decide retry vs. dead-letter -------------------
  const isTimeout = handlerError instanceof Error && handlerError.message === '__job_timeout__'
  const isNoHandler = handlerError instanceof NoHandlerRegisteredError
  const { message, errorClass } = isTimeout
    ? {
        message: `Handler exceeded the ${timeoutMs}ms wall-clock timeout`,
        errorClass: 'JobTimeoutError',
      }
    : summarizeError(handlerError)

  const newAttemptCount = job.attempt_count + 1
  const exhausted = newAttemptCount >= job.max_attempts

  if (!canTransitionJobStatus('running', 'failed')) {
    throw new Error('executeJob: running -> failed is not a legal transition')
  }

  if (exhausted) {
    if (!canTransitionJobStatus('failed', 'dead_lettered')) {
      throw new Error('executeJob: failed -> dead_lettered is not a legal transition')
    }
    const nowIso = new Date().toISOString()
    const { error: updateError } = await supabase
      .from('background_jobs')
      .update({
        status: 'dead_lettered',
        attempt_count: newAttemptCount,
        failure_reason: message,
        last_error: { errorClass, message, timedOut: isTimeout },
        dead_lettered_at: nowIso,
        next_attempt_at: null,
      })
      .eq('id', job.id)
    if (updateError) {
      throw new Error(`executeJob: could not dead-letter job ${job.id}: ${updateError.message}`)
    }
    captureMonitoringMessage(
      `Background job dead-lettered after ${newAttemptCount} attempt(s): ${job.job_type}`,
      'error',
      {
        category: 'background_job',
        organizationId: job.organization_id,
        extra: {
          jobId: job.id,
          jobType: job.job_type,
          attemptCount: newAttemptCount,
          errorClass,
          timedOut: isTimeout,
        },
      },
    )
    if (actorId) {
      await logAuditEvent(
        {
          organizationId: job.organization_id,
          actorId,
          action: 'job.dead_lettered',
          entityType: 'background_jobs',
          entityId: job.correlation_id,
          after: { status: 'dead_lettered', attemptCount: newAttemptCount },
          metadata: { jobId: job.id, jobType: job.job_type, errorClass },
        },
        supabase,
      )
    }
    return isNoHandler
      ? { kind: 'no_handler', jobId: job.id, jobType: job.job_type }
      : { kind: 'dead_lettered', jobId: job.id, errorMessage: message }
  }

  // Still has attempts left — schedule the next one via backoff.
  const nextAttemptAt = calculateNextAttemptAt(newAttemptCount)
  const { error: updateError } = await supabase
    .from('background_jobs')
    .update({
      status: 'queued',
      attempt_count: newAttemptCount,
      failure_reason: message,
      last_error: { errorClass, message, timedOut: isTimeout },
      next_attempt_at: nextAttemptAt.toISOString(),
    })
    .eq('id', job.id)
  if (updateError) {
    throw new Error(
      `executeJob: could not requeue job ${job.id} after failure: ${updateError.message}`,
    )
  }
  if (actorId) {
    await logAuditEvent(
      {
        organizationId: job.organization_id,
        actorId,
        action: 'job.failed',
        entityType: 'background_jobs',
        entityId: job.correlation_id,
        after: {
          status: 'queued',
          attemptCount: newAttemptCount,
          nextAttemptAt: nextAttemptAt.toISOString(),
        },
        metadata: { jobId: job.id, jobType: job.job_type, errorClass },
      },
      supabase,
    )
  }
  return isNoHandler
    ? { kind: 'no_handler', jobId: job.id, jobType: job.job_type }
    : {
        kind: 'failed_will_retry',
        jobId: job.id,
        attemptCount: newAttemptCount,
        nextAttemptAt: nextAttemptAt.toISOString(),
        errorMessage: message,
      }
}
