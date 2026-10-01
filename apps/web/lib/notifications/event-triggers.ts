import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { NotificationEventType } from '@rqi/types'
import { enqueueJob, type EnqueueJobResult } from '@/lib/jobs/enqueue'

/**
 * Build Phase 12, Wave 4 — one function per Wave-1-allowlisted notification
 * event (0032's exact 8 `event_type` CHECK values). Each function's only
 * job is: figure out WHO should be notified (strictly within the calling
 * `organizationId` — never a cross-tenant recipient), build a short
 * title/body, and enqueue one `notification_dispatch` job per recipient via
 * Wave 2's `enqueueJob`.
 *
 * *** NEVER write directly to `notifications` from here (or from anywhere
 * else) — always through `enqueueJob`, so retries/idempotency/audit stay
 * uniform across the whole system (this wave's own brief constraint). ***
 *
 * IDEMPOTENCY: every call below builds its `idempotencyKey` as
 * `<eventType>:<resourceId>:<recipientUserId>` via `notificationIdempotencyKey`
 * below — mirroring `lib/outreach/idempotency.ts`'s
 * `<outreachMessageId>:<attemptNumber>` convention (a deterministic,
 * human-readable, colon-joined key built from the fields that make one
 * "instance" of this event unique). `enqueueJob`'s own unique index is
 * scoped to `(organizationId, jobType, idempotencyKey)`, so the SAME event
 * firing twice for the same (recipient, event_type, resource_id) — e.g. a
 * caller that retries after a network blip, or an action that
 * double-submits — returns the existing job rather than creating a second
 * `notifications` row. A caller that intentionally wants a fresh
 * notification for a genuinely NEW occurrence of the same event against
 * the same resource (e.g. a candidate responds twice to the same sequence)
 * must pass a `dedupeSuffix` (e.g. a response id) so the key does not
 * collide with a prior, unrelated firing — every function below that can
 * plausibly recur takes one.
 *
 * ACTOR / AUDIT: `enqueueJob` requires a `userId` for its own
 * `job.enqueued` audit row's `actor_id` — every function below takes an
 * `actorUserId` param, which callers (Wave 5's server actions) should pass
 * as the user whose action caused this event (the recruiter who submitted
 * a scorecard, the client who requested changes, etc.), never a
 * synthesized "system" id, so the audit trail honestly reflects who did
 * the thing that produced the notification.
 *
 * WIRING THIS WAVE DOES **NOT** DO: none of these 8 functions is called
 * from anywhere yet, except `notifyIntegrationFailed` (wired from
 * `lib/jobs/handlers/integration-sync.ts`, this wave's own small edit —
 * see that file) and `notifyPocCompleted` (wired from
 * `lib/poc/poc-actions.ts`'s `completePocBenchmarkAction`, also this
 * wave's own small edit). The other six belong in their own domain's
 * server actions (`lib/scorecards/actions.ts`'s submit-for-approval,
 * `lib/matching/matching-actions.ts`'s review-queue entry,
 * `lib/shortlists/verification-actions.ts`'s open-verification-request,
 * `lib/outreach/outreach-actions.ts`'s submit-for-approval and
 * response-recording, `lib/shortlists/*`'s send-to-client) — Wave 5's job,
 * flagged explicitly in this wave's report, not touched here to keep this
 * wave's edits to wave 2/3 files minimal and justified.
 */

export function notificationIdempotencyKey(params: {
  eventType: NotificationEventType
  resourceId: string
  recipientUserId: string
  dedupeSuffix?: string
}): string {
  const base = `${params.eventType}:${params.resourceId}:${params.recipientUserId}`
  return params.dedupeSuffix ? `${base}:${params.dedupeSuffix}` : base
}

interface DispatchOneParams {
  organizationId: string
  actorUserId: string
  recipientUserId: string
  eventType: NotificationEventType
  title: string
  body?: string
  resourceType?: string
  resourceId?: string
  dedupeSuffix?: string
  supabase: SupabaseClient
}

async function dispatchOne(params: DispatchOneParams): Promise<EnqueueJobResult> {
  return enqueueJob({
    organizationId: params.organizationId,
    jobType: 'notification_dispatch',
    payload: {
      recipientUserId: params.recipientUserId,
      eventType: params.eventType,
      title: params.title,
      body: params.body,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
    },
    idempotencyKey: params.resourceId
      ? notificationIdempotencyKey({
          eventType: params.eventType,
          resourceId: params.resourceId,
          recipientUserId: params.recipientUserId,
          dedupeSuffix: params.dedupeSuffix,
        })
      : undefined,
    supabase: params.supabase,
    userId: params.actorUserId,
  })
}

// ---------------------------------------------------------------------------
// Recipient-resolution helpers — every one strictly scoped to
// `organizationId` (and, where relevant, to a specific project/client), so
// an event-trigger function can never resolve a recipient outside the
// correct tenant.
// ---------------------------------------------------------------------------

/** Active members of `organizationId` holding any of `roles` — the org-wide-oversight recipient set (agency_admin/platform_admin) most events fall back to. */
async function resolveOrgRoleUserIds(
  supabase: SupabaseClient,
  organizationId: string,
  roles: string[],
): Promise<string[]> {
  const { data } = await supabase
    .from('organization_memberships')
    .select('user_id')
    .eq('organization_id', organizationId)
    .eq('status', 'active')
    .in('role', roles)
  return [...new Set((data ?? []).map((row) => row.user_id as string))]
}

/** Recruiters (any `assignment_role`) assigned to `recruitmentProjectId` — the sole source of truth for "assigned to this project" (mirrors `is_assigned_to_project()`/`resource-ownership.ts`'s own use of this table). */
async function resolveProjectAssignedUserIds(
  supabase: SupabaseClient,
  recruitmentProjectId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from('project_assignments')
    .select('user_id')
    .eq('recruitment_project_id', recruitmentProjectId)
  return [...new Set((data ?? []).map((row) => row.user_id as string))]
}

/** Active client_decision_maker members of `organizationId` representing `clientId` specifically — mirrors `resource-ownership.ts`'s `fetchCallerClientId` in reverse (client -> users, not user -> client). */
async function resolveClientDecisionMakerUserIds(
  supabase: SupabaseClient,
  organizationId: string,
  clientId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from('organization_memberships')
    .select('user_id')
    .eq('organization_id', organizationId)
    .eq('status', 'active')
    .eq('role', 'client_decision_maker')
    .eq('client_id', clientId)
  return [...new Set((data ?? []).map((row) => row.user_id as string))]
}

// ---------------------------------------------------------------------------
// 1. scorecard_awaiting_approval
// ---------------------------------------------------------------------------

export interface NotifyScorecardAwaitingApprovalParams {
  organizationId: string
  actorUserId: string
  scorecardVersionId: string
  recruitmentProjectId: string
  projectClientId: string
  /** `recruitment_projects.client_can_approve_scorecards` — the same flag `canDecideScorecardApproval` (lib/scorecards/approval-permission.ts) gates the actual approval decision on. */
  projectClientCanApproveScorecards: boolean
  jobTitle: string
  supabase: SupabaseClient
}

/** Recipients: agency_admin/platform_admin (always — `canDecideScorecardApproval` grants them unconditionally) + the project's client_decision_maker(s) ONLY when `projectClientCanApproveScorecards` is true (the same condition that function requires for that role to be able to act at all — notifying a client who cannot approve would be a dead-end, unhelpful notification). */
export async function notifyScorecardAwaitingApproval(
  params: NotifyScorecardAwaitingApprovalParams,
): Promise<EnqueueJobResult[]> {
  const adminIds = await resolveOrgRoleUserIds(params.supabase, params.organizationId, [
    'platform_admin',
    'agency_admin',
  ])
  const clientIds = params.projectClientCanApproveScorecards
    ? await resolveClientDecisionMakerUserIds(
        params.supabase,
        params.organizationId,
        params.projectClientId,
      )
    : []

  const recipients = [...new Set([...adminIds, ...clientIds])].filter(
    (id) => id !== params.actorUserId,
  )

  return Promise.all(
    recipients.map((recipientUserId) =>
      dispatchOne({
        organizationId: params.organizationId,
        actorUserId: params.actorUserId,
        recipientUserId,
        eventType: 'scorecard_awaiting_approval',
        title: `Scorecard awaiting approval: ${params.jobTitle}`,
        body: `A scorecard for "${params.jobTitle}" was submitted and needs your approval.`,
        resourceType: 'scorecard_version',
        resourceId: params.scorecardVersionId,
        supabase: params.supabase,
      }),
    ),
  )
}

// ---------------------------------------------------------------------------
// 2. candidate_awaiting_review
// ---------------------------------------------------------------------------

export interface NotifyCandidateAwaitingReviewParams {
  organizationId: string
  actorUserId: string
  candidateRoleMatchId: string
  recruitmentProjectId: string
  candidateName: string
  supabase: SupabaseClient
}

/** Recipients: the recruiter(s) assigned to the match's project (the quality-review queue, `lib/shortlists/queue.ts`, is itself project-scoped — every recruiter who can see that project's queue is a legitimate reviewer for a candidate newly entering it). No org-wide admin fan-out here on purpose: this event fires once per candidate entering review, potentially at real volume, and an assigned recruiter — not every agency_admin in the org — is the brief's stated recipient. */
export async function notifyCandidateAwaitingReview(
  params: NotifyCandidateAwaitingReviewParams,
): Promise<EnqueueJobResult[]> {
  const recipients = (
    await resolveProjectAssignedUserIds(params.supabase, params.recruitmentProjectId)
  ).filter((id) => id !== params.actorUserId)

  return Promise.all(
    recipients.map((recipientUserId) =>
      dispatchOne({
        organizationId: params.organizationId,
        actorUserId: params.actorUserId,
        recipientUserId,
        eventType: 'candidate_awaiting_review',
        title: `${params.candidateName} is awaiting review`,
        body: `${params.candidateName} has an evaluation ready for quality review.`,
        resourceType: 'candidate_role_match',
        resourceId: params.candidateRoleMatchId,
        supabase: params.supabase,
      }),
    ),
  )
}

// ---------------------------------------------------------------------------
// 3. verification_requested
// ---------------------------------------------------------------------------

export interface NotifyVerificationRequestedParams {
  organizationId: string
  actorUserId: string
  verificationRequestId: string
  recruitmentProjectId: string
  candidateName: string
  supabase: SupabaseClient
}

/** Recipients: the project's assigned recruiter(s) + agency_admin/platform_admin — the same role set `resolveVerificationRequestAction` gates its `human_reviews`/`update` permission check on (agency_admin/recruiter 'full'), narrowed to recruiters actually assigned to this candidate's project rather than every recruiter org-wide. */
export async function notifyVerificationRequested(
  params: NotifyVerificationRequestedParams,
): Promise<EnqueueJobResult[]> {
  const [recruiterIds, adminIds] = await Promise.all([
    resolveProjectAssignedUserIds(params.supabase, params.recruitmentProjectId),
    resolveOrgRoleUserIds(params.supabase, params.organizationId, [
      'platform_admin',
      'agency_admin',
    ]),
  ])
  const recipients = [...new Set([...recruiterIds, ...adminIds])].filter(
    (id) => id !== params.actorUserId,
  )

  return Promise.all(
    recipients.map((recipientUserId) =>
      dispatchOne({
        organizationId: params.organizationId,
        actorUserId: params.actorUserId,
        recipientUserId,
        eventType: 'verification_requested',
        title: `Verification requested: ${params.candidateName}`,
        body: `A verification request was opened for ${params.candidateName}.`,
        resourceType: 'verification_request',
        resourceId: params.verificationRequestId,
        supabase: params.supabase,
      }),
    ),
  )
}

// ---------------------------------------------------------------------------
// 4. outreach_awaiting_approval
// ---------------------------------------------------------------------------

export interface NotifyOutreachAwaitingApprovalParams {
  organizationId: string
  actorUserId: string
  outreachMessageId: string
  recruitmentProjectId: string
  candidateName: string
  supabase: SupabaseClient
}

/** Recipients: the project's assigned recruiter(s) + agency_admin/platform_admin — mirrors the exact role set `hasPermission(role, 'outreach', 'update')` grants ('full' for both), narrowed to the message's own project for the recruiter side. */
export async function notifyOutreachAwaitingApproval(
  params: NotifyOutreachAwaitingApprovalParams,
): Promise<EnqueueJobResult[]> {
  const [recruiterIds, adminIds] = await Promise.all([
    resolveProjectAssignedUserIds(params.supabase, params.recruitmentProjectId),
    resolveOrgRoleUserIds(params.supabase, params.organizationId, [
      'platform_admin',
      'agency_admin',
    ]),
  ])
  const recipients = [...new Set([...recruiterIds, ...adminIds])].filter(
    (id) => id !== params.actorUserId,
  )

  return Promise.all(
    recipients.map((recipientUserId) =>
      dispatchOne({
        organizationId: params.organizationId,
        actorUserId: params.actorUserId,
        recipientUserId,
        eventType: 'outreach_awaiting_approval',
        title: `Outreach draft awaiting approval: ${params.candidateName}`,
        body: `An outreach message to ${params.candidateName} needs your approval before it can be sent.`,
        resourceType: 'outreach_message',
        resourceId: params.outreachMessageId,
        supabase: params.supabase,
      }),
    ),
  )
}

// ---------------------------------------------------------------------------
// 5. candidate_responded
// ---------------------------------------------------------------------------

export interface NotifyCandidateRespondedParams {
  organizationId: string
  /** The user whose action produced this event — for a genuinely inbound candidate reply there usually isn't one (no human "did" this); callers recording a response via a server action should pass that action's own caller (the recruiter who logged the reply), never a synthesized id. */
  actorUserId: string
  outreachMessageId: string
  /** `outreach_sequences.started_by` — "the recruiter who owns that outreach sequence" (this wave's brief). Nullable at the DB layer; when null, this function has no single owning recruiter to notify and returns an empty result rather than guessing a fallback recipient. */
  sequenceStartedBy: string | null
  candidateName: string
  /** Distinguishes one response occurrence from another for the SAME outreach message (this event can legitimately recur — a candidate can reply more than once) — pass e.g. the `communication_events` row id so each reply gets its own notification rather than being deduped away by an earlier one's idempotency key. */
  responseEventId: string
  supabase: SupabaseClient
}

export async function notifyCandidateResponded(
  params: NotifyCandidateRespondedParams,
): Promise<EnqueueJobResult[]> {
  if (!params.sequenceStartedBy || params.sequenceStartedBy === params.actorUserId) return []

  return [
    await dispatchOne({
      organizationId: params.organizationId,
      actorUserId: params.actorUserId,
      recipientUserId: params.sequenceStartedBy,
      eventType: 'candidate_responded',
      title: `${params.candidateName} responded`,
      body: `${params.candidateName} replied to your outreach message.`,
      resourceType: 'outreach_message',
      resourceId: params.outreachMessageId,
      dedupeSuffix: params.responseEventId,
      supabase: params.supabase,
    }),
  ]
}

// ---------------------------------------------------------------------------
// 6. shortlist_awaiting_client_decision
// ---------------------------------------------------------------------------

export interface NotifyShortlistAwaitingClientDecisionParams {
  organizationId: string
  actorUserId: string
  shortlistId: string
  clientId: string
  jobTitle: string
  supabase: SupabaseClient
}

/** Recipients: the shortlist's client's client_decision_maker(s) only — an internal (agency_admin/recruiter) fan-out is not this event's point (they already know they just sent it); mirrors `shortlists` resource's `client_decision_maker: 'approve'` matrix row exactly. */
export async function notifyShortlistAwaitingClientDecision(
  params: NotifyShortlistAwaitingClientDecisionParams,
): Promise<EnqueueJobResult[]> {
  const recipients = (
    await resolveClientDecisionMakerUserIds(params.supabase, params.organizationId, params.clientId)
  ).filter((id) => id !== params.actorUserId)

  return Promise.all(
    recipients.map((recipientUserId) =>
      dispatchOne({
        organizationId: params.organizationId,
        actorUserId: params.actorUserId,
        recipientUserId,
        eventType: 'shortlist_awaiting_client_decision',
        title: `Shortlist ready for your decision: ${params.jobTitle}`,
        body: `A shortlist for "${params.jobTitle}" is ready for your review and decision.`,
        resourceType: 'shortlist',
        resourceId: params.shortlistId,
        supabase: params.supabase,
      }),
    ),
  )
}

// ---------------------------------------------------------------------------
// 7. integration_failed
// ---------------------------------------------------------------------------

export interface NotifyIntegrationFailedParams {
  organizationId: string
  actorUserId: string
  integrationConnectionId: string
  provider: string
  errorMessage: string
  supabase: SupabaseClient
  /** Distinguishes one failure occurrence from another for the SAME connection (a connection can fail repeatedly) — callers should pass something that changes per attempt (e.g. the `background_jobs.id` or `correlation_id` of the failing sync) so a recurring failure keeps notifying rather than being deduped away by the first one's idempotency key forever. */
  dedupeSuffix?: string
}

/** Recipients: agency_admin/platform_admin only — mirrors `integration_connections`' own RLS (`integration_connections_select_admin_or_oversight`) and this module's own `resource-link.ts` access check exactly; no other role has any visibility into this table. */
export async function notifyIntegrationFailed(
  params: NotifyIntegrationFailedParams,
): Promise<EnqueueJobResult[]> {
  const recipients = (
    await resolveOrgRoleUserIds(params.supabase, params.organizationId, [
      'platform_admin',
      'agency_admin',
    ])
  ).filter((id) => id !== params.actorUserId)

  return Promise.all(
    recipients.map((recipientUserId) =>
      dispatchOne({
        organizationId: params.organizationId,
        actorUserId: params.actorUserId,
        recipientUserId,
        eventType: 'integration_failed',
        title: `Integration sync failed: ${params.provider}`,
        body: params.errorMessage,
        resourceType: 'integration_connection',
        resourceId: params.integrationConnectionId,
        dedupeSuffix: params.dedupeSuffix,
        supabase: params.supabase,
      }),
    ),
  )
}

// ---------------------------------------------------------------------------
// 8. poc_completed
// ---------------------------------------------------------------------------

export interface NotifyPocCompletedParams {
  organizationId: string
  actorUserId: string
  pocBenchmarkId: string
  clientId: string
  benchmarkName: string
  supabase: SupabaseClient
}

/** Recipients: agency_admin/platform_admin + the benchmark's client's client_decision_maker(s) — mirrors `poc_reports`' matrix row (`agency_admin: 'full'`, `client_decision_maker: 'read'`) and docs/14-poc-specification.md §14.17's "reviewed jointly" framing: both sides need to know the comparison report is ready. */
export async function notifyPocCompleted(
  params: NotifyPocCompletedParams,
): Promise<EnqueueJobResult[]> {
  const [adminIds, clientIds] = await Promise.all([
    resolveOrgRoleUserIds(params.supabase, params.organizationId, [
      'platform_admin',
      'agency_admin',
    ]),
    resolveClientDecisionMakerUserIds(params.supabase, params.organizationId, params.clientId),
  ])
  const recipients = [...new Set([...adminIds, ...clientIds])].filter(
    (id) => id !== params.actorUserId,
  )

  return Promise.all(
    recipients.map((recipientUserId) =>
      dispatchOne({
        organizationId: params.organizationId,
        actorUserId: params.actorUserId,
        recipientUserId,
        eventType: 'poc_completed',
        title: `POC completed: ${params.benchmarkName}`,
        body: `The proof-of-concept benchmark "${params.benchmarkName}" is complete and ready to review.`,
        resourceType: 'poc_benchmark',
        resourceId: params.pocBenchmarkId,
        supabase: params.supabase,
      }),
    ),
  )
}
