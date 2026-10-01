import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Role } from '@rqi/types'
import {
  assertResourceOwnership,
  ResourceOwnershipError,
  type CopilotResourceType,
} from '@/lib/copilot/resource-ownership'

/**
 * Build Phase 12, Wave 4 — the permission-safe deep-link resolver
 * `notifications.resource_type`/`resource_id` exists for (0032's own header
 * note: "PERMISSION-SAFE DEEP LINKS").
 *
 * *** MUST BE CALLED AT RENDER/CLICK TIME, NEVER PRECOMPUTED OR STORED. ***
 * A notification row can sit unread for weeks; the recipient's access to
 * its underlying resource can change in that window (removed from a
 * project, a client relationship ended, a role downgrade). Calling this at
 * insert time (or caching its result anywhere) would silently reintroduce
 * exactly the stale-link risk 0032's migration deliberately designed the
 * schema to prevent by never storing a raw `action_url` in the first
 * place. Every caller — the in-app notification center list (Wave 5), an
 * API route backing it, anything else that turns a `notifications` row
 * into a clickable link — MUST call this function fresh, under the
 * CURRENT viewer's live session, every time it renders that row, not once
 * when the row was created.
 *
 * MECHANISM: re-validates the viewer's CURRENT access to
 * `(resourceType, resourceId)` using the exact same pattern
 * `lib/copilot/resource-ownership.ts` already established for copilot tool
 * calls (`assertResourceOwnership`) — reused directly, not reimplemented,
 * for every resource type that module already covers
 * (`scorecard_version`, `candidate_role_match`, `outreach_message`,
 * `shortlist`, `poc_benchmark`). Two resource kinds notifications reference
 * that copilot tools never touch are handled by this module's own checks
 * below, following that same module's pattern exactly (own org first,
 * then role-scoped access):
 *   - `verification_request` (Phase 8's `verification_requests` table —
 *     no copilot tool ever reads/writes one, so `resource-ownership.ts`
 *     has no case for it).
 *   - `integration_connection` (this phase's own table — copilot has no
 *     integration-touching tool at all).
 *
 * On success, returns a real in-app route path (never a full origin — the
 * caller renders it as a same-app `<a href>`/`Link`, consistent with every
 * other in-app link in this codebase). On failure — resource not found,
 * cross-tenant, or the viewer's current role/assignment no longer grants
 * access — returns `{ accessible: false }`, NEVER a stale/blind URL; the
 * caller (Wave 5's notification-center UI) is expected to render that
 * notification's text as plain, unlinked content with a short
 * "no longer accessible" affordance rather than a broken or
 * silently-wrong link.
 */

/** The full set of resource kinds a `notifications` row can reference — a superset of `CopilotResourceType`, since notifications point at a couple of resource kinds no copilot tool ever touches (see this module's header note). Kept as a standalone union (not literally `CopilotResourceType | ...`) so this module's own exhaustiveness check below is independent of copilot's tool surface ever changing shape. */
export const NotificationResourceType = [
  'scorecard_version',
  'candidate_role_match',
  'verification_request',
  'outreach_message',
  'shortlist',
  'poc_benchmark',
  'integration_connection',
] as const
export type NotificationResourceType = (typeof NotificationResourceType)[number]

/** The subset of `NotificationResourceType` that `resource-ownership.ts`'s `assertResourceOwnership` already covers verbatim — reused, never reimplemented. A type-guard (not a bare `Set.has()`) so TypeScript actually narrows `resourceType` on both branches — a plain `Set<NotificationResourceType>.has()` call is not itself a type guard and would leave this module's own final exhaustiveness check unable to prove every case is handled. */
const COPILOT_COVERED_TYPES = new Set<NotificationResourceType>([
  'scorecard_version',
  'candidate_role_match',
  'outreach_message',
  'shortlist',
  'poc_benchmark',
])
function isCopilotCoveredResourceType(
  resourceType: NotificationResourceType,
): resourceType is Extract<NotificationResourceType, CopilotResourceType> {
  return COPILOT_COVERED_TYPES.has(resourceType)
}

export interface BuildPermissionSafeDeepLinkParams {
  resourceType: NotificationResourceType
  resourceId: string
  viewerUserId: string
  /** The viewer's CURRENT role, re-fetched THIS turn (never a cached/stored value) — same requirement `assertResourceOwnership` itself documents. */
  viewerRole: Role
  organizationId: string
  supabase: SupabaseClient
}

export type DeepLinkResult =
  | { accessible: true; path: string }
  | { accessible: false; reason: 'not_found_or_no_longer_accessible' }

/** Fetches the caller's own represented client_id — mirrors `resource-ownership.ts`'s private `fetchCallerClientId`, duplicated narrowly here rather than exported from that module, since that module deliberately keeps every helper but its two public exports private to its own file. */
async function fetchCallerClientId(
  supabase: SupabaseClient,
  organizationId: string,
  userId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('organization_memberships')
    .select('client_id')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .eq('role', 'client_decision_maker')
    .eq('status', 'active')
    .maybeSingle()
  return (data?.client_id as string | null) ?? null
}

/**
 * `verification_request` access mirrors `candidate_role_match` access
 * exactly (Phase 8's `verification_requests.candidate_role_match_id` is
 * the row's only meaningful scope) — resolved to that match's id and
 * handed to `assertResourceOwnership` under `resourceType:
 * 'candidate_role_match'`, rather than reimplementing the
 * recruiter/client_decision_maker branching a second time here.
 */
async function checkVerificationRequestAccess(
  supabase: SupabaseClient,
  params: { organizationId: string; userId: string; role: Role; resourceId: string },
): Promise<{ ok: boolean; candidateId: string | null }> {
  const { data: request } = await supabase
    .from('verification_requests')
    .select('organization_id, candidate_role_match_id')
    .eq('id', params.resourceId)
    .maybeSingle()
  if (!request || request.organization_id !== params.organizationId)
    return { ok: false, candidateId: null }

  try {
    await assertResourceOwnership(supabase, {
      organizationId: params.organizationId,
      userId: params.userId,
      role: params.role,
      resourceType: 'candidate_role_match',
      resourceId: request.candidate_role_match_id as string,
    })
  } catch (error) {
    if (error instanceof ResourceOwnershipError) return { ok: false, candidateId: null }
    throw error
  }

  const { data: match } = await supabase
    .from('candidate_role_matches')
    .select('candidate_id')
    .eq('id', request.candidate_role_match_id)
    .maybeSingle()
  return { ok: true, candidateId: (match?.candidate_id as string | null) ?? null }
}

/**
 * `integration_connection` access: agency_admin/platform_admin oversight
 * only (mirrors 0032's `integration_connections_select_admin_or_oversight`
 * RLS policy exactly — no other role has any DB-layer access to this table
 * at all, per that migration's own comment). A recruiter's application-
 * layer `'read'` grant on the `integrations` resource
 * (`packages/types/src/permissions.ts`) is NOT sufficient here on purpose:
 * that grant is documented in 0032 itself as expected to be satisfied by a
 * future read-only summary surface, never direct row access — this
 * function fails closed for every role but the two the RLS policy itself
 * allows, exactly like `resource-ownership.ts`'s own `orgWideRoles`
 * pattern for every other admin-oversight-only resource type.
 */
async function checkIntegrationConnectionAccess(
  supabase: SupabaseClient,
  params: { organizationId: string; role: Role; resourceId: string },
): Promise<boolean> {
  if (params.role !== 'platform_admin' && params.role !== 'agency_admin') return false
  const { data: connection } = await supabase
    .from('integration_connections')
    .select('organization_id')
    .eq('id', params.resourceId)
    .maybeSingle()
  return Boolean(connection) && connection?.organization_id === params.organizationId
}

/** `outreach_message` -> its OWNING SEQUENCE's route: this app's `/outreach/[sequenceId]` page is keyed on `outreach_sequences.id`, not `outreach_messages.id` (see `app/(app)/outreach/[sequenceId]/page.tsx`) — a message never has its own route. */
async function resolveOutreachSequenceId(
  supabase: SupabaseClient,
  outreachMessageId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('outreach_messages')
    .select('outreach_sequence_id')
    .eq('id', outreachMessageId)
    .maybeSingle()
  return (data?.outreach_sequence_id as string | null) ?? null
}

/** `scorecard_version` -> its owning project's `/projects/[projectId]/scorecard` route (this app has no standalone scorecard-detail route — scorecards are always viewed inside their recruitment project's workspace, per `app/(app)/projects/[projectId]/scorecard/page.tsx`). */
async function resolveScorecardProjectPath(
  supabase: SupabaseClient,
  scorecardVersionId: string,
): Promise<string | null> {
  const { data: version } = await supabase
    .from('scorecard_versions')
    .select('scorecard_id')
    .eq('id', scorecardVersionId)
    .maybeSingle()
  if (!version) return null
  const { data: scorecard } = await supabase
    .from('scorecards')
    .select('job_id')
    .eq('id', version.scorecard_id)
    .maybeSingle()
  if (!scorecard) return null
  const { data: job } = await supabase
    .from('jobs')
    .select('recruitment_project_id')
    .eq('id', scorecard.job_id)
    .maybeSingle()
  if (!job) return null
  return `/projects/${job.recruitment_project_id as string}/scorecard`
}

export async function buildPermissionSafeDeepLink(
  params: BuildPermissionSafeDeepLinkParams,
): Promise<DeepLinkResult> {
  const { resourceType, resourceId, viewerUserId, viewerRole, organizationId, supabase } = params
  const notFound: DeepLinkResult = {
    accessible: false,
    reason: 'not_found_or_no_longer_accessible',
  }

  try {
    if (isCopilotCoveredResourceType(resourceType)) {
      await assertResourceOwnership(supabase, {
        organizationId,
        userId: viewerUserId,
        role: viewerRole,
        resourceType,
        resourceId,
      })

      switch (resourceType) {
        case 'shortlist':
          return { accessible: true, path: `/shortlists/${resourceId}` }
        case 'poc_benchmark':
          return { accessible: true, path: `/poc/${resourceId}` }
        case 'outreach_message': {
          const sequenceId = await resolveOutreachSequenceId(supabase, resourceId)
          return sequenceId ? { accessible: true, path: `/outreach/${sequenceId}` } : notFound
        }
        case 'candidate_role_match': {
          const { data: match } = await supabase
            .from('candidate_role_matches')
            .select('candidate_id')
            .eq('id', resourceId)
            .maybeSingle()
          const candidateId = match?.candidate_id as string | undefined
          return candidateId ? { accessible: true, path: `/candidates/${candidateId}` } : notFound
        }
        case 'scorecard_version': {
          const path = await resolveScorecardProjectPath(supabase, resourceId)
          return path ? { accessible: true, path } : notFound
        }
        default:
          return notFound
      }
    }

    if (resourceType === 'verification_request') {
      const result = await checkVerificationRequestAccess(supabase, {
        organizationId,
        userId: viewerUserId,
        role: viewerRole,
        resourceId,
      })
      return result.ok && result.candidateId
        ? { accessible: true, path: `/candidates/${result.candidateId}` }
        : notFound
    }

    if (resourceType === 'integration_connection') {
      const ok = await checkIntegrationConnectionAccess(supabase, {
        organizationId,
        role: viewerRole,
        resourceId,
      })
      // No per-connection route exists (the /integrations page is a single
      // org-wide status list, not a per-id detail view) — the org-wide
      // page is the correct, honest target rather than inventing a
      // fragment/query-param deep link this app does not actually support.
      return ok ? { accessible: true, path: '/integrations' } : notFound
    }

    const exhaustive: never = resourceType
    throw new Error(`buildPermissionSafeDeepLink: unhandled resource type ${String(exhaustive)}`)
  } catch (error) {
    if (error instanceof ResourceOwnershipError) return notFound
    throw error
  }
}

/**
 * Maps a `notifications.event_type` to the `NotificationResourceType` its
 * `resource_type` column is expected to carry — a small lookup table so a
 * caller building a deep link from a raw `notifications` row (whose own
 * `resource_type` is an untyped `string | null` at the DB layer) can
 * narrow it before calling `buildPermissionSafeDeepLink`, rather than
 * trusting the stored string at face value. Returns `null` for
 * `integration_failed`, which — per `notifyIntegrationFailed`'s own
 * design — targets an `integration_connection`, still listed explicitly
 * below for the same reason every other event is: so this map is a
 * complete, exhaustive record of the event -> resource-kind contract, not
 * an incomplete convenience.
 */
export const EVENT_TYPE_RESOURCE_TYPE: Record<string, NotificationResourceType> = {
  scorecard_awaiting_approval: 'scorecard_version',
  candidate_awaiting_review: 'candidate_role_match',
  verification_requested: 'verification_request',
  outreach_awaiting_approval: 'outreach_message',
  candidate_responded: 'outreach_message',
  shortlist_awaiting_client_decision: 'shortlist',
  integration_failed: 'integration_connection',
  poc_completed: 'poc_benchmark',
}
