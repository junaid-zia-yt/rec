import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { BackgroundJobStatus, BackgroundJobType } from '@rqi/types'

/**
 * Build Phase 12, Wave 5 (Task C) — `background_jobs` read loader for the
 * admin-only "Job status" screen. `platform_admin`/`agency_admin` only
 * (0032's `background_jobs_select_oversight` RLS — the caller must gate
 * the page itself on this same role pair; this loader does not re-check
 * it, matching `lib/poc/load.ts`'s own precedent of leaving the
 * permission check to the page/action layer).
 *
 * NEVER SURFACES `payload`/`last_error`'S FULL CONTENTS — per the brief's
 * "no sensitive payloads in ordinary logs" discipline extended to the UI:
 * this loader deliberately does not select `payload` at all, and reduces
 * `last_error` (a `Record<string, unknown>` column) to a single short,
 * structured `failureSummary` string (its own `message` field, if present,
 * else a generic fallback) — never the raw JSON blob.
 */

export interface JobListRow {
  id: string
  jobType: BackgroundJobType
  status: BackgroundJobStatus
  attemptCount: number
  maxAttempts: number
  correlationId: string
  failureReason: string | null
  failureSummary: string | null
  nextAttemptAt: string | null
  deadLetteredAt: string | null
  manuallyRetriedBy: string | null
  manuallyRetriedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface LoadJobsFilter {
  status?: BackgroundJobStatus
  jobType?: BackgroundJobType
  limit?: number
}

function summarizeLastError(lastError: Record<string, unknown> | null): string | null {
  if (!lastError) return null
  const message = lastError.message
  if (typeof message === 'string' && message.trim().length > 0) {
    return message.length > 300 ? `${message.slice(0, 300)}…` : message
  }
  return 'An error was recorded for this attempt.'
}

/** Most-recent-first, optionally filtered by status/type — the admin job-status list. */
export async function loadJobs(
  organizationId: string,
  supabase: SupabaseClient,
  filter: LoadJobsFilter = {},
): Promise<JobListRow[]> {
  let query = supabase
    .from('background_jobs')
    .select(
      'id, job_type, status, attempt_count, max_attempts, correlation_id, failure_reason, last_error, next_attempt_at, dead_lettered_at, manually_retried_by, manually_retried_at, created_at, updated_at',
    )
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(filter.limit ?? 100)

  if (filter.status) query = query.eq('status', filter.status)
  if (filter.jobType) query = query.eq('job_type', filter.jobType)

  const { data, error } = await query
  if (error) {
    throw new Error(`loadJobs: could not load jobs: ${error.message}`)
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    jobType: row.job_type as BackgroundJobType,
    status: row.status as BackgroundJobStatus,
    attemptCount: row.attempt_count as number,
    maxAttempts: row.max_attempts as number,
    correlationId: row.correlation_id as string,
    failureReason: (row.failure_reason as string | null) ?? null,
    failureSummary: summarizeLastError((row.last_error as Record<string, unknown> | null) ?? null),
    nextAttemptAt: (row.next_attempt_at as string | null) ?? null,
    deadLetteredAt: (row.dead_lettered_at as string | null) ?? null,
    manuallyRetriedBy: (row.manually_retried_by as string | null) ?? null,
    manuallyRetriedAt: (row.manually_retried_at as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }))
}

export interface JobStatusCounts {
  queued: number
  running: number
  succeeded: number
  failed: number
  deadLettered: number
  cancelled: number
}

/** Small counts-by-status summary for the job-status screen's header tiles. */
export async function loadJobStatusCounts(
  organizationId: string,
  supabase: SupabaseClient,
): Promise<JobStatusCounts> {
  const { data, error } = await supabase
    .from('background_jobs')
    .select('status')
    .eq('organization_id', organizationId)
  if (error) {
    throw new Error(`loadJobStatusCounts: could not load job counts: ${error.message}`)
  }

  const counts: JobStatusCounts = {
    queued: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    deadLettered: 0,
    cancelled: 0,
  }
  for (const row of data ?? []) {
    switch (row.status as BackgroundJobStatus) {
      case 'queued':
        counts.queued += 1
        break
      case 'running':
        counts.running += 1
        break
      case 'succeeded':
        counts.succeeded += 1
        break
      case 'failed':
        counts.failed += 1
        break
      case 'dead_lettered':
        counts.deadLettered += 1
        break
      case 'cancelled':
        counts.cancelled += 1
        break
    }
  }
  return counts
}
