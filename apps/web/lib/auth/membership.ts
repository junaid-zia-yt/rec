import type { Role } from '@rqi/types'
import { CrossTenantAccessError, InsufficientRoleError, NotAMemberError } from './errors'

/** Shape returned by an `organization_memberships` row select. Framework-free on purpose (see lib/auth/session.ts's I/O wrapper), so this whole module is unit-testable without a Supabase client or a browser. */
export interface Membership {
  organizationId: string
  role: Role
  status: 'active' | 'revoked'
  isDefault: boolean
  /** Set only for client_decision_maker memberships — which client this reviewer represents. Never used to grant org-wide access. */
  clientId?: string | null
}

/**
 * Picks the membership a session should default to: the one explicitly
 * marked default, else — if the user belongs to exactly one active org —
 * that one. Returns null (never guesses) when the user has more than one
 * active org and none is marked default; the caller must ask the person to
 * pick, per docs/07-data-model.md §7.3's stance that org-scoping is never
 * silently inferred.
 */
export function resolveDefaultMembership(memberships: Membership[]): Membership | null {
  const active = memberships.filter((m) => m.status === 'active')
  const explicitDefault = active.find((m) => m.isDefault)
  if (explicitDefault) return explicitDefault
  if (active.length === 1) return active[0] ?? null
  return null
}

/** Finds the caller's active membership for a specific org, or null. */
export function findMembership(
  memberships: Membership[],
  organizationId: string,
): Membership | null {
  return (
    memberships.find((m) => m.organizationId === organizationId && m.status === 'active') ?? null
  )
}

/** Throws NotAMemberError unless the caller has an active membership in `organizationId`. */
export function requireMembership(memberships: Membership[], organizationId: string): Membership {
  const membership = findMembership(memberships, organizationId)
  if (!membership) throw new NotAMemberError()
  return membership
}

/** Throws InsufficientRoleError unless the membership's role is one of `allowedRoles`. */
export function requireRole(membership: Membership, allowedRoles: Role[]): Membership {
  if (!allowedRoles.includes(membership.role)) throw new InsufficientRoleError()
  return membership
}

/**
 * Verifies a resource's own `organization_id` matches the caller's active
 * organization. This is the application-layer mirror of every table's RLS
 * policy (`organization_id = current_org_id()`) — belt-and-braces per
 * docs/21-implementation-contract.md §21.6, not a replacement for RLS.
 * Throws CrossTenantAccessError, whose message says "not found" rather than
 * "forbidden" — a cross-tenant ID must not even confirm the resource exists.
 */
export function verifyResourceOrg(
  resourceOrganizationId: string,
  activeOrganizationId: string,
): void {
  if (resourceOrganizationId !== activeOrganizationId) {
    throw new CrossTenantAccessError()
  }
}
