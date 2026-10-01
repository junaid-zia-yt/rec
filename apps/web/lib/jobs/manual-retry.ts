/**
 * `manuallyRetryJob` — the brief's explicit "manual retry" requirement.
 * Resets a `dead_lettered` (the normal case) or `failed` (a job still
 * mid-automatic-retry that an admin wants to nudge sooner) job back to
 * `queued`, clears `next_attempt_at` (so it is immediately due — the next
 * `claimDueJobs` sweep or an inline retry picks it up right away, not after
 * the automatic backoff delay), and records `manually_retried_by`/`_at`.
 *
 * PERMISSION GATE — why this does NOT call
 * `hasPermission(role, 'background_jobs', 'update')`: the application
 * permission matrix (`packages/types/src/permissions.ts`) gives
 * `background_jobs` only a `'read'` level for `platform_admin`/
 * `agency_admin` (`hasPermission(..., 'background_jobs', 'update')` is
 * `false` for EVERY role — a `'read'` level only ever grants the `'read'`
 * action, per `hasPermission`'s own switch). That matrix's own comment
 * (Build Phase 12 Wave 1) documents why: this resource "exists purely for
 * the 'Job status' oversight UI... rather than as a create/update gate."
 * Manual retry is exactly the kind of specific, non-generic write the
 * `poc_reports` resource comment in that same file already flags this
 * matrix's own convention for — "server actions for those specific writes
 * should check role directly rather than relying solely on
 * `hasPermission`". So this function checks the caller's role directly
 * (`platform_admin`/`agency_admin`, mirroring 0032's
 * `background_jobs_select_oversight` RLS policy exactly, since that is the
 * only RLS this table actually has and this write must succeed under it)
 * rather than going through the generic resource-permission helper.
 *
 * ATTEMPT-COUNT RESET DECISION (judgment call, documented per this task's
 * convention): a manual retry resets `attempt_count` to 0, giving the job
 * a FRESH attempt budget against its existing `max_attempts`, rather than
 * continuing to count against the original budget. Reasoning: automatic
 * retries exist to absorb TRANSIENT failures (a rate limit, a network
 * blip) within one bounded budget; a manual retry is a deliberate human
 * decision made only after looking at `failure_reason`/`last_error` and
 * concluding the underlying cause is now different (a credential was
 * fixed, a bad payload was corrected upstream, an integration came back
 * online) — treating it as a genuinely new attempt sequence is more
 * forgiving and matches how a human actually reasons about "try this
 * again" vs. "this is still the same failing attempt". The tradeoff this
 * creates: a job that keeps failing for a reason a human has NOT actually
 * fixed can be manually retried indefinitely, each time getting a full new
 * budget before dead-lettering again — there is no cap on how many times
 * `manuallyRetryJob` itself may be called. This is an accepted, explicit
 * tradeoff (a human is the one calling it, and every call is itself
 * audited via `job.manually_retried` with `manuallyRetriedBy`/`_at`
 * recorded on the row), not an oversight — flagged here for Wave 5's UI so
 * it can surface the row's manual-retry history rather than treating a
 * dead-lettered job that keeps recurring as a mystery.
 */
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logAuditEvent } from '@/lib/audit/log'
import { canTransitionJobStatus } from './status-transitions'
import type { BackgroundJobStatus } from './types'

const RETRY_ALLOWED_ROLES = ['platform_admin', 'agency_admin'] as const

export interface ManuallyRetryJobParams {
  jobId: string
  userId: string
  supabase: SupabaseClient
}

export type ManuallyRetryJobResult =
  | { status: 'retried'; jobId: string }
  | { status: 'not_found' }
  | { status: 'forbidden' }
  | { status: 'not_retryable'; currentStatus: BackgroundJobStatus }

export async function manuallyRetryJob(
  params: ManuallyRetryJobParams,
): Promise<ManuallyRetryJobResult> {
  const { jobId, userId, supabase } = params

  const { data: job, error: fetchError } = await supabase
    .from('background_jobs')
    .select('id, organization_id, status, correlation_id, job_type')
    .eq('id', jobId)
    .maybeSingle()

  if (fetchError) {
    throw new Error(`manuallyRetryJob: could not load job ${jobId}: ${fetchError.message}`)
  }
  if (!job) {
    return { status: 'not_found' }
  }

  const currentStatus = job.status as BackgroundJobStatus
  if (!canTransitionJobStatus(currentStatus, 'queued')) {
    return { status: 'not_retryable', currentStatus }
  }

  // Role check — see this module's header note for why this is a direct
  // role check, not `hasPermission(role, 'background_jobs', 'update')`.
  const { data: membership, error: membershipError } = await supabase
    .from('organization_memberships')
    .select('role')
    .eq('user_id', userId)
    .eq('organization_id', job.organization_id as string)
    .eq('status', 'active')
    .maybeSingle()

  if (membershipError) {
    throw new Error(
      `manuallyRetryJob: could not load membership for user ${userId}: ${membershipError.message}`,
    )
  }
  const role = membership?.role as (typeof RETRY_ALLOWED_ROLES)[number] | undefined
  if (!role || !RETRY_ALLOWED_ROLES.includes(role)) {
    return { status: 'forbidden' }
  }

  const nowIso = new Date().toISOString()
  const { data: updated, error: updateError } = await supabase
    .from('background_jobs')
    .update({
      status: 'queued',
      attempt_count: 0,
      next_attempt_at: null,
      manually_retried_by: userId,
      manually_retried_at: nowIso,
    })
    .eq('id', jobId)
    // Re-assert the status precondition at the DB layer too, mirroring
    // executeJob's own optimistic-claim pattern — if the row's status
    // changed between the read above and this write (e.g. another admin
    // retried it first, or an automatic retry already requeued it), this
    // WHERE clause simply matches zero rows rather than silently
    // clobbering whatever happened in between.
    .eq('status', currentStatus)
    .select('id')
    .maybeSingle()

  if (updateError) {
    throw new Error(`manuallyRetryJob: could not requeue job ${jobId}: ${updateError.message}`)
  }
  if (!updated) {
    // Lost the race described above — the job is no longer in the status
    // this call observed, so report it the same way an up-front
    // not-retryable check would (re-reading the current status is not
    // essential here: the caller can re-fetch and try again if they want
    // to know exactly what it became).
    return { status: 'not_retryable', currentStatus }
  }

  await logAuditEvent(
    {
      organizationId: job.organization_id as string,
      actorId: userId,
      action: 'job.manually_retried',
      entityType: 'background_jobs',
      entityId: job.correlation_id as string,
      before: { status: currentStatus },
      after: { status: 'queued', attemptCount: 0 },
      metadata: { jobId, jobType: job.job_type },
    },
    supabase,
  )

  return { status: 'retried', jobId }
}
