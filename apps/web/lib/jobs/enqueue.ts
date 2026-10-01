/**
 * `enqueueJob` — the one way a `background_jobs` row is ever created (Build
 * Phase 12 brief). Validates the payload, checks for an existing row with
 * the same `(organizationId, jobType, idempotencyKey)` first (idempotent
 * enqueue, mirroring `lib/outreach/idempotency.ts`'s convention: a
 * duplicate enqueue returns the existing job rather than erroring or
 * inserting a second row), then inserts with `status: 'queued'`.
 *
 * CORRELATION ID <-> AUDIT_EVENTS LINKAGE (documented here since Wave 1
 * flagged this as the literal mechanism behind the brief's "correlation
 * ID" requirement, and it isn't obvious from either table's schema alone):
 * `background_jobs.correlation_id` is a single UUID generated once per job
 * (here, if the caller doesn't supply one) and stored on the job row.
 * `audit_events.id` is its OWN primary key (auto-generated per row) — it
 * cannot be reused across the several audit rows one job's lifecycle
 * produces (enqueued, started, completed/failed, retried, dead_lettered).
 * The field that CAN be shared across multiple audit_events rows is
 * `entity_id` (plain text, not unique) — so every `job.*` audit event this
 * engine writes uses `entityId: correlationId`, never `entityId: jobId`.
 * Querying `audit_events where entity_type = 'background_jobs' and
 * entity_id = <correlationId>` then returns the FULL audit trail for one
 * job's entire lifecycle in one query, ordered by `created_at`. A job's own
 * `id` is still recorded, just in `metadata.jobId`, not `entity_id`.
 *
 * No service-role client is used anywhere in this module — per 0032's RLS
 * note (no service-role-only write path exists for `background_jobs` in
 * this schema), every insert here runs through the CALLER's own
 * authenticated Supabase session, exactly like `ai_runs`/`outreach_messages`
 * already do.
 */
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import type { BackgroundJobType } from '@rqi/types'
import { logAuditEvent } from '@/lib/audit/log'
import { JOB_PAYLOAD_SCHEMAS } from './job-payload-schemas'
import type { BackgroundJob } from './types'

export interface EnqueueJobParams {
  organizationId: string
  jobType: BackgroundJobType
  /** Validated against `JOB_PAYLOAD_SCHEMAS[jobType]` before anything is written — an invalid payload throws the Zod error and nothing is inserted. */
  payload: unknown
  /** Caller-supplied idempotency key. Required in practice for any job a duplicate enqueue is plausible for (a webhook retry, a UI double-submit) — nullable at the DB layer for job types that genuinely have no natural key, but every real call site should supply one where it can. */
  idempotencyKey?: string | null
  /** Reused across every audit_events row this job's execution produces (see this module's header note). Generated fresh when omitted. */
  correlationId?: string
  maxAttempts?: number
  supabase: SupabaseClient
  /** The authenticated user on whose behalf this job is being enqueued — required for the `job.enqueued` audit row's `actor_id` (never nullable there; `logAuditEvent`'s own type requires it). */
  userId: string
}

export interface EnqueueJobResult {
  job: BackgroundJob
  /** True when an existing row with the same (organizationId, jobType, idempotencyKey) was found and returned as-is — no insert, no new audit row, was written for this call. */
  wasExisting: boolean
}

function rowToBackgroundJob(row: Record<string, unknown>): BackgroundJob {
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    jobType: row.job_type as BackgroundJob['jobType'],
    status: row.status as BackgroundJob['status'],
    payload: (row.payload as BackgroundJob['payload']) ?? {},
    correlationId: row.correlation_id as string,
    idempotencyKey: (row.idempotency_key as string | null) ?? null,
    attemptCount: row.attempt_count as number,
    maxAttempts: row.max_attempts as number,
    nextAttemptAt: (row.next_attempt_at as string | null) ?? null,
    failureReason: (row.failure_reason as string | null) ?? null,
    lastError: (row.last_error as BackgroundJob['lastError']) ?? null,
    deadLetteredAt: (row.dead_lettered_at as string | null) ?? null,
    manuallyRetriedBy: (row.manually_retried_by as string | null) ?? null,
    manuallyRetriedAt: (row.manually_retried_at as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

export async function enqueueJob(params: EnqueueJobParams): Promise<EnqueueJobResult> {
  // Validate BEFORE any DB I/O — an invalid payload must never reach the
  // idempotency check or the insert (brief: "validate ... never store an
  // unvalidated payload").
  const validatedPayload = JOB_PAYLOAD_SCHEMAS[params.jobType].parse(params.payload)

  if (params.idempotencyKey) {
    const { data: existing, error: lookupError } = await params.supabase
      .from('background_jobs')
      .select('*')
      .eq('organization_id', params.organizationId)
      .eq('job_type', params.jobType)
      .eq('idempotency_key', params.idempotencyKey)
      .maybeSingle()

    if (lookupError) {
      throw new Error(`enqueueJob: could not check for an existing job: ${lookupError.message}`)
    }
    if (existing) {
      return { job: rowToBackgroundJob(existing), wasExisting: true }
    }
  }

  const correlationId = params.correlationId ?? randomUUID()

  const { data: inserted, error: insertError } = await params.supabase
    .from('background_jobs')
    .insert({
      organization_id: params.organizationId,
      job_type: params.jobType,
      status: 'queued',
      payload: validatedPayload,
      correlation_id: correlationId,
      idempotency_key: params.idempotencyKey ?? null,
      // Explicit rather than relying on the DB column's own `default 0` —
      // this insert is meant to be readable as the complete, intended
      // starting state of a job row on its own, and it keeps this code's
      // behavior identical whether it runs against a real Supabase project
      // or a test fake that does not simulate column defaults.
      attempt_count: 0,
      max_attempts: params.maxAttempts ?? 5,
    })
    .select('*')
    .single()

  if (insertError || !inserted) {
    // A unique-violation on (organization_id, job_type, idempotency_key)
    // here means a concurrent caller won the race between this call's own
    // lookup above and its insert — re-fetch and return the winner's row
    // rather than surfacing a spurious duplicate-key error to this caller.
    if (insertError?.code === '23505' && params.idempotencyKey) {
      const { data: raced } = await params.supabase
        .from('background_jobs')
        .select('*')
        .eq('organization_id', params.organizationId)
        .eq('job_type', params.jobType)
        .eq('idempotency_key', params.idempotencyKey)
        .maybeSingle()
      if (raced) return { job: rowToBackgroundJob(raced), wasExisting: true }
    }
    throw new Error(
      `enqueueJob: could not create the job: ${insertError?.message ?? 'unknown error'}`,
    )
  }

  const job = rowToBackgroundJob(inserted)

  await logAuditEvent(
    {
      organizationId: params.organizationId,
      actorId: params.userId,
      action: 'job.enqueued',
      entityType: 'background_jobs',
      // See this module's header note: entity_id carries the CORRELATION
      // id (shared across every audit row this job's lifecycle produces),
      // not the job's own row id — that lives in metadata.jobId instead.
      entityId: correlationId,
      after: { jobType: params.jobType, status: 'queued' },
      metadata: { jobId: job.id, jobType: params.jobType },
    },
    params.supabase,
  )

  return { job, wasExisting: false }
}
