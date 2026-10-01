import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Role } from '@rqi/types'

/**
 * Build Phase 11, Wave 2 — the single, mandatory resource-ownership check
 * every copilot tool handler MUST run before it may touch any resource
 * (governing brief: "validate resource ownership on every tool call").
 *
 * This is the application-layer mirror of the RLS helpers already proven
 * out for the ordinary UI paths — `can_access_candidate()` /
 * `is_assigned_to_project()` (supabase/migrations/0012, 0021) — because a
 * copilot tool handler runs as server-side orchestration code, not as a
 * request the database's own RLS policies see with `auth.uid()` already
 * bound the normal way when we want a SECOND, independent check on top of
 * whatever the query itself would return under RLS. Two things matter here
 * that a bare RLS-scoped SELECT would not give us on its own:
 *
 *   1. It must be checked AGAINST THE CALLER'S CURRENT, LIVE role/
 *      membership — never the copilot_conversations `role_at_creation`
 *      snapshot (0031's "SCOPE SNAPSHOT, NOT LIVE LOOKUP" header note).
 *      Callers must pass the role they just re-fetched from
 *      `organization_memberships` this turn (see
 *      `apps/web/lib/auth/session.ts`'s `requireOrgMembership`), never a
 *      cached/stored value.
 *   2. It must produce a recorded, auditable, UNFORGEABLE fact — the
 *      `ResourceOwnershipValidated` token below — so a handler that skips
 *      this call is structurally incapable of claiming it ran the check
 *      (mirrors `copilot_tool_calls_valid_requires_ownership`'s DB-level
 *      guarantee at the application layer). See the token's own comment.
 *
 * One function, one export, called for EVERY resource_id a tool call
 * touches — never bypassed, never re-implemented ad hoc inside a tool file.
 */

export const CopilotResourceType = [
  'recruitment_project',
  'client',
  'job',
  'scorecard_version',
  'candidate',
  'candidate_role_match',
  'shortlist',
  'outreach_message',
  'poc_benchmark',
] as const
export type CopilotResourceType = (typeof CopilotResourceType)[number]

export class ResourceOwnershipError extends Error {
  constructor(
    message: string,
    readonly resourceType: CopilotResourceType,
    readonly resourceId: string,
  ) {
    super(message)
    this.name = 'ResourceOwnershipError'
  }
}

/**
 * A module-private brand. Nothing outside this file can read or write this
 * symbol's key, so nothing outside this file can construct a value that
 * structurally satisfies `ResourceOwnershipValidated` without literally
 * calling `assertResourceOwnership` (short of an explicit `as` cast, which
 * is exactly the kind of thing wave 4's adversarial/lint review should grep
 * for — see docs note in gate-override-guard.ts). This is the TypeScript-
 * level analogue of `copilot_tool_calls_valid_requires_ownership`'s DB
 * CHECK constraint: "an output cannot be marked valid without ownership
 * having actually been validated" made structurally true, not just
 * documented as a convention.
 */
const OWNERSHIP_TOKEN = Symbol('copilot.resource-ownership-validated')

export interface ResourceOwnershipValidated {
  readonly resourceType: CopilotResourceType
  readonly resourceId: string
  readonly [OWNERSHIP_TOKEN]: true
}

/** Runtime check that a value actually carries the real token — used by the tool-execution wrapper (wave 3) before it will ever write `resource_ownership_validated: true` to `copilot_tool_calls`. */
export function isResourceOwnershipValidated(value: unknown): value is ResourceOwnershipValidated {
  return (
    typeof value === 'object' &&
    value !== null &&
    OWNERSHIP_TOKEN in (value as Record<PropertyKey, unknown>)
  )
}

export interface AssertResourceOwnershipParams {
  organizationId: string
  userId: string
  /** The caller's CURRENT role, re-fetched this turn — never the conversation's role_at_creation snapshot. */
  role: Role
  resourceType: CopilotResourceType
  resourceId: string
}

/** Fetches the caller's own represented client_id, for the client_decision_maker row-scoping checks below. Returns null if the caller holds no active client_decision_maker membership in this org (in which case every client-scoped check must fail closed). */
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

async function isAssignedToProject(
  supabase: SupabaseClient,
  userId: string,
  recruitmentProjectId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('project_assignments')
    .select('id')
    .eq('user_id', userId)
    .eq('recruitment_project_id', recruitmentProjectId)
    .maybeSingle()
  return Boolean(data)
}

/** Mirrors can_access_candidate()'s recruiter branch: self-sourced OR assigned to a project the candidate has an entry on. */
async function recruiterCanAccessCandidate(
  supabase: SupabaseClient,
  userId: string,
  candidateId: string,
): Promise<boolean> {
  const { data: candidate } = await supabase
    .from('candidates')
    .select('created_by')
    .eq('id', candidateId)
    .maybeSingle()
  if (candidate?.created_by === userId) return true

  const { data: entries } = await supabase
    .from('candidate_project_entries')
    .select('recruitment_project_id')
    .eq('candidate_id', candidateId)
  if (!entries || entries.length === 0) return false

  for (const entry of entries) {
    if (await isAssignedToProject(supabase, userId, entry.recruitment_project_id as string))
      return true
  }
  return false
}

/** Mirrors can_access_candidate()'s client_decision_maker branch: at least one client_visible=true project entry whose project belongs to the caller's own represented client. */
async function clientCanAccessCandidate(
  supabase: SupabaseClient,
  organizationId: string,
  userId: string,
  candidateId: string,
): Promise<boolean> {
  const callerClientId = await fetchCallerClientId(supabase, organizationId, userId)
  if (!callerClientId) return false

  const { data: entries } = await supabase
    .from('candidate_project_entries')
    .select('recruitment_project_id, client_visible')
    .eq('candidate_id', candidateId)
    .eq('client_visible', true)
  if (!entries || entries.length === 0) return false

  const projectIds = entries.map((e) => e.recruitment_project_id as string)
  const { data: projects } = await supabase
    .from('recruitment_projects')
    .select('id, client_id')
    .in('id', projectIds)
  return (projects ?? []).some((p) => p.client_id === callerClientId)
}

async function checkOwnership(
  supabase: SupabaseClient,
  params: AssertResourceOwnershipParams,
): Promise<boolean> {
  const { organizationId, userId, role, resourceType, resourceId } = params
  const orgWideRoles: Role[] = ['platform_admin', 'agency_admin', 'read_only_reviewer']

  switch (resourceType) {
    case 'recruitment_project': {
      const { data: project } = await supabase
        .from('recruitment_projects')
        .select('organization_id, client_id')
        .eq('id', resourceId)
        .maybeSingle()
      if (!project || project.organization_id !== organizationId) return false
      if (orgWideRoles.includes(role)) return true
      if (role === 'recruiter') return isAssignedToProject(supabase, userId, resourceId)
      if (role === 'client_decision_maker') {
        const callerClientId = await fetchCallerClientId(supabase, organizationId, userId)
        return callerClientId !== null && callerClientId === project.client_id
      }
      return false
    }

    case 'client': {
      const { data: client } = await supabase
        .from('clients')
        .select('organization_id')
        .eq('id', resourceId)
        .maybeSingle()
      if (!client || client.organization_id !== organizationId) return false
      if (orgWideRoles.includes(role) || role === 'recruiter') return true
      if (role === 'client_decision_maker') {
        const callerClientId = await fetchCallerClientId(supabase, organizationId, userId)
        return callerClientId === resourceId
      }
      return false
    }

    case 'job': {
      const { data: job } = await supabase
        .from('jobs')
        .select('organization_id, recruitment_project_id')
        .eq('id', resourceId)
        .maybeSingle()
      if (!job || job.organization_id !== organizationId) return false
      return checkOwnership(supabase, {
        ...params,
        resourceType: 'recruitment_project',
        resourceId: job.recruitment_project_id as string,
      })
    }

    case 'scorecard_version': {
      const { data: version } = await supabase
        .from('scorecard_versions')
        .select('organization_id, scorecard_id')
        .eq('id', resourceId)
        .maybeSingle()
      if (!version || version.organization_id !== organizationId) return false
      const { data: scorecard } = await supabase
        .from('scorecards')
        .select('job_id')
        .eq('id', version.scorecard_id)
        .maybeSingle()
      if (!scorecard) return false
      return checkOwnership(supabase, {
        ...params,
        resourceType: 'job',
        resourceId: scorecard.job_id as string,
      })
    }

    case 'candidate': {
      const { data: candidate } = await supabase
        .from('candidates')
        .select('organization_id')
        .eq('id', resourceId)
        .maybeSingle()
      if (!candidate || candidate.organization_id !== organizationId) return false
      if (orgWideRoles.includes(role)) return true
      if (role === 'recruiter') return recruiterCanAccessCandidate(supabase, userId, resourceId)
      if (role === 'client_decision_maker')
        return clientCanAccessCandidate(supabase, organizationId, userId, resourceId)
      return false
    }

    case 'candidate_role_match': {
      const { data: match } = await supabase
        .from('candidate_role_matches')
        .select('organization_id, candidate_id')
        .eq('id', resourceId)
        .maybeSingle()
      if (!match || match.organization_id !== organizationId) return false
      return checkOwnership(supabase, {
        ...params,
        resourceType: 'candidate',
        resourceId: match.candidate_id as string,
      })
    }

    case 'shortlist': {
      const { data: shortlist } = await supabase
        .from('shortlists')
        .select('organization_id, client_id, recruitment_project_id')
        .eq('id', resourceId)
        .maybeSingle()
      if (!shortlist || shortlist.organization_id !== organizationId) return false
      if (orgWideRoles.includes(role)) return true
      if (role === 'recruiter')
        return isAssignedToProject(supabase, userId, shortlist.recruitment_project_id as string)
      if (role === 'client_decision_maker') {
        const callerClientId = await fetchCallerClientId(supabase, organizationId, userId)
        return callerClientId !== null && callerClientId === shortlist.client_id
      }
      return false
    }

    case 'outreach_message': {
      const { data: message } = await supabase
        .from('outreach_messages')
        .select('organization_id, recruitment_project_id')
        .eq('id', resourceId)
        .maybeSingle()
      if (!message || message.organization_id !== organizationId) return false
      // Outreach is never a client_decision_maker-visible resource
      // (permissions.ts MATRIX.outreach: client_decision_maker 'none') —
      // no client branch here on purpose; the tool-registry allowedRoles
      // check already blocks this role from any outreach-touching tool
      // before this function is ever called, but this function fails
      // closed for that role independently, as defense in depth.
      if (orgWideRoles.includes(role)) return true
      if (role === 'recruiter')
        return isAssignedToProject(supabase, userId, message.recruitment_project_id as string)
      return false
    }

    case 'poc_benchmark': {
      const { data: benchmark } = await supabase
        .from('poc_benchmarks')
        .select('organization_id, client_id')
        .eq('id', resourceId)
        .maybeSingle()
      if (!benchmark || benchmark.organization_id !== organizationId) return false
      if (orgWideRoles.includes(role) || role === 'recruiter') return true
      if (role === 'client_decision_maker') {
        const callerClientId = await fetchCallerClientId(supabase, organizationId, userId)
        return callerClientId !== null && callerClientId === benchmark.client_id
      }
      return false
    }

    default: {
      const exhaustive: never = resourceType
      throw new Error(`resource-ownership: unhandled resource type ${String(exhaustive)}`)
    }
  }
}

/**
 * Validates that `params.userId`, acting as `params.role` (a LIVE,
 * just-re-fetched role — see this module's header note), may access
 * `params.resourceType`/`params.resourceId` within `params.organizationId`.
 * Throws `ResourceOwnershipError` on any failure (not found, cross-tenant,
 * not assigned/shared). On success, returns the unforgeable
 * `ResourceOwnershipValidated` token — the only way to obtain one.
 */
export async function assertResourceOwnership(
  supabase: SupabaseClient,
  params: AssertResourceOwnershipParams,
): Promise<ResourceOwnershipValidated> {
  const ok = await checkOwnership(supabase, params)
  if (!ok) {
    throw new ResourceOwnershipError(
      `${params.resourceType} ${params.resourceId} is not accessible to user ${params.userId} (role ${params.role}) in organization ${params.organizationId}`,
      params.resourceType,
      params.resourceId,
    )
  }
  return {
    resourceType: params.resourceType,
    resourceId: params.resourceId,
    [OWNERSHIP_TOKEN]: true,
  }
}
