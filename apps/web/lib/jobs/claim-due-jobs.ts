/**
 * `claimDueJobs` — the batch-processing entry point a periodic trigger
 * calls (Build Phase 12 brief: "a periodic trigger... that claims `queued`
 * jobs whose `next_attempt_at <= now()` and processes them"). Selects due
 * jobs oldest-first, up to `limit`, and runs each through `executeJob`.
 *
 * WHAT "PERIODIC TRIGGER" MEANS IN THIS DEPLOYMENT (read before wiring a
 * cron route to this function): this Vercel serverless deployment has no
 * persistent worker process and no queue service — see
 * `docs/17-deployment-operations.md` §17.7 and `executor.ts`'s own header
 * note. The realistic shape is a Vercel Cron-invoked API route that calls
 * this function once per invocation. THAT ROUTE (a later wave's job, not
 * built here) must itself run under an authenticated Supabase session that
 * is a member of whichever organization(s) it wants to process — this
 * engine executes using the caller's own session throughout (0032's RLS
 * note: no service-role-only write path exists for `background_jobs`), so
 * there is no way for a single call here to claim jobs across EVERY
 * organization unless the session itself has that membership. Two honest
 * shapes for that later wave to choose between, documented here so it does
 * not have to rediscover the constraint:
 *   (a) one cron invocation per organization, authenticated as a
 *       designated per-org service/admin account, calling this function
 *       with that org's `organizationId`; or
 *   (b) a single elevated account that is an `agency_admin`/equivalent
 *       member of every organization (or a schema change adding a genuine
 *       service-role write path for this table) — a bigger decision this
 *       wave deliberately does not make unilaterally.
 * This function itself is agnostic to which shape is chosen: pass
 * `organizationId` to scope one run to a single org, or omit it to let RLS
 * itself determine what the calling session can see (in practice: whatever
 * that session's own organization is, per `background_jobs_select_oversight`
 * — remember that policy is platform_admin/agency_admin SELECT only, so a
 * plain org-member session cannot even SELECT queued jobs to claim them;
 * the calling identity must itself hold one of those two roles).
 *
 * CONCURRENCY: jobs are processed SEQUENTIALLY, not with bounded
 * concurrency (judgment call, documented per this task's convention).
 * Reasoning: a single serverless invocation already has its own wall-clock
 * budget (a Vercel function timeout) shared across everything it does: N
 * jobs run with any real concurrency would each still need their own
 * `DEFAULT_JOB_TIMEOUT_MS` budget, multiplying the chance ONE invocation
 * blows its own platform-imposed timeout and gets killed mid-batch (which,
 * per `executor.ts`'s own honest-limitations note, leaves a `running` row
 * stranded with no heartbeat) — sequential processing trades throughput for
 * a much smaller blast radius per invocation, appropriate for a job engine
 * that has no reclaim/heartbeat mechanism yet. A later wave can revisit
 * this once real job volume and per-handler latency are actually measured
 * (not guessed here).
 */
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { captureMonitoringMessage } from '@/lib/monitoring/capture'
import { executeJob } from './executor'
import type { JobExecutionOutcome, JobHandlerRegistry } from './types'

export interface ClaimDueJobsParams {
  supabase: SupabaseClient
  organizationId?: string
  /** Maximum jobs to claim and process in this call. Default 20 — small enough to fit comfortably inside a typical serverless function's timeout even in the worst case (every job using its full DEFAULT_JOB_TIMEOUT_MS), large enough that a healthy queue drains in a small number of cron ticks. */
  limit?: number
  handlers: JobHandlerRegistry
}

const DEFAULT_CLAIM_LIMIT = 20

export interface ClaimDueJobsResult {
  outcomes: JobExecutionOutcome[]
  claimedCount: number
}

export async function claimDueJobs(params: ClaimDueJobsParams): Promise<ClaimDueJobsResult> {
  const limit = params.limit ?? DEFAULT_CLAIM_LIMIT
  const nowIso = new Date().toISOString()

  let query = params.supabase
    .from('background_jobs')
    .select('id')
    .eq('status', 'queued')
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
    .order('created_at', { ascending: true })
    .limit(limit)

  if (params.organizationId) {
    query = query.eq('organization_id', params.organizationId)
  }

  const { data: dueJobs, error } = await query
  if (error) {
    throw new Error(`claimDueJobs: could not select due jobs: ${error.message}`)
  }

  const outcomes: JobExecutionOutcome[] = []
  for (const row of (dueJobs ?? []) as { id: string }[]) {
    // Sequential on purpose — see this file's module comment. Each call is
    // independent: one job's thrown/uncaught error (which executeJob
    // itself should never produce for a handler failure, only for a
    // genuine DB/infra error) does not stop the rest of the batch from
    // being attempted.
    try {
      const outcome = await executeJob({
        jobId: row.id,
        supabase: params.supabase,
        handlers: params.handlers,
      })
      outcomes.push(outcome)
    } catch (error) {
      // executeJob only throws for a genuine DB/infra failure (the claim
      // UPDATE or a subsequent status-write itself erroring) — never for a
      // handler's own error, which it always catches internally and turns
      // into failed_will_retry/dead_lettered/no_handler. `failed_permanently`
      // is exactly this "not the job's fault, the engine itself could not
      // progress it" case — the row's own DB status is left whatever it was
      // (most likely still `running` from a claim that succeeded but whose
      // follow-up write then failed), so this is reported distinctly from
      // dead_lettered rather than implying the retry/dead-letter bookkeeping
      // actually ran.
      const errorMessage = error instanceof Error ? error.message : String(error)
      captureMonitoringMessage(
        `Background job engine could not progress job ${row.id}: ${errorMessage}`,
        'error',
        {
          category: 'background_job',
          organizationId: params.organizationId ?? null,
          extra: { jobId: row.id, errorMessage },
        },
      )
      outcomes.push({
        kind: 'failed_permanently',
        jobId: row.id,
        errorMessage,
      })
    }
  }

  return { outcomes, claimedCount: outcomes.length }
}
