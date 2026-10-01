import type { Role } from '@rqi/types'
import { CrossTenantAccessError } from './errors'
import type { Membership } from './membership'

/**
 * Row-level project-access scoping — the application-layer mirror of the
 * RLS policies in supabase/migrations/0009, 0010, 0011, 0012, 0013 (which
 * remain the layer that still holds if this check is ever skipped, per
 * docs/21-implementation-contract.md §21.6). Pure and framework-free so it
 * is unit-testable without a database: only the "which projects is this
 * recruiter assigned to" lookup is I/O (wrapped in ./project-access.ts).
 *
 * Build Phase 3 brief §PERMISSIONS:
 *   - Agency admins can manage all organization projects.
 *   - Recruiters can access assigned projects.
 *   - Client reviewers can view only explicitly shared projects (their own
 *     client's projects).
 *   - Read-only reviewers cannot modify records (read access is org-wide).
 */
const ORG_WIDE_ROLES: Role[] = ['platform_admin', 'agency_admin', 'read_only_reviewer']

export function canAccessProject(
  membership: Membership,
  project: { clientId: string },
  assignedProjectIds: string[],
  projectId: string,
): boolean {
  if (ORG_WIDE_ROLES.includes(membership.role)) return true

  if (membership.role === 'recruiter') {
    return assignedProjectIds.includes(projectId)
  }

  if (membership.role === 'client_decision_maker') {
    return membership.clientId != null && membership.clientId === project.clientId
  }

  return false
}

/** Throws CrossTenantAccessError (a "not found", never "forbidden", message — a scoped-out project must not even confirm it exists) unless canAccessProject would allow it. */
export function requireProjectAccess(
  membership: Membership,
  project: { clientId: string },
  assignedProjectIds: string[],
  projectId: string,
): void {
  if (!canAccessProject(membership, project, assignedProjectIds, projectId)) {
    throw new CrossTenantAccessError()
  }
}
