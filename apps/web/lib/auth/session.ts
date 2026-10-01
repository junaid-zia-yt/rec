import 'server-only'
import { redirect } from 'next/navigation'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import type { Action, Resource } from '@rqi/types'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { supabaseConfigured } from '@/lib/env'
import {
  findMembership,
  requireMembership as requireMembershipPure,
  requireRole as requireRolePure,
  resolveDefaultMembership,
  verifyResourceOrg as verifyResourceOrgPure,
  type Membership,
} from './membership'
import { requirePermission as requirePermissionPure } from './permissions'

/**
 * Centralized authorization helpers (Build Phase 2 brief §6). Every one of
 * these is server-only and is the *only* sanctioned way a server
 * action/route handler establishes who the caller is and what they may do —
 * per docs/13-api-service-boundaries.md, no handler queries
 * organization_memberships or checks a role inline.
 *
 * Each function composes a Supabase I/O step with the pure, unit-tested
 * logic in ./membership.ts and ./permissions.ts, so the actual
 * decision logic is covered by tests that don't need a live database —
 * only the "fetch the membership rows" step is untested here (no live
 * Supabase project is connected in this environment; see
 * docs/build-phase-2-report.md).
 */

/** Requires a signed-in user; redirects to /sign-in (preserving the original destination) if not. Never throws — a redirect is the only correct outcome for a page load. */
export async function requireAuth(nextPath?: string): Promise<User> {
  if (!supabaseConfigured) {
    redirect('/sign-in?reason=not_configured')
  }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()

  if (!user) {
    const next = nextPath ? `?next=${encodeURIComponent(nextPath)}` : ''
    redirect(`/sign-in${next}`)
  }

  return user
}

/**
 * Fetches the caller's active membership rows. Never trusts a role/org id
 * passed in from the client — always re-reads from the database.
 *
 * `client` is an optional injectable Supabase client (Build Phase 13 Wave 1
 * — mobile API routes). When omitted, behavior is EXACTLY as before: a
 * fresh cookie-scoped client is built via `createServerSupabaseClient()`.
 * When provided (e.g. a bearer-token-scoped client built by
 * `lib/supabase/bearer.ts` for a mobile Route Handler, which has no
 * Next.js cookie store to read), that client is used instead — the query
 * itself, and everything downstream of it, is unchanged either way, since
 * both clients are equally RLS-scoped to the authenticated caller, never
 * the service role.
 */
async function fetchMemberships(userId: string, client?: SupabaseClient): Promise<Membership[]> {
  const supabase = client ?? (await createServerSupabaseClient())
  if (!supabase) return []

  const { data, error } = await supabase
    .from('organization_memberships')
    .select('organization_id, role, status, is_default, client_id')
    .eq('user_id', userId)
    .eq('status', 'active')

  if (error || !data) return []

  return data.map((row) => ({
    organizationId: row.organization_id as string,
    role: row.role as Membership['role'],
    status: row.status as Membership['status'],
    isDefault: row.is_default as boolean,
    clientId: (row.client_id as string | null) ?? null,
  }))
}

/** Resolves which organization the current request is scoped to: an explicit `organizationId` override (e.g. from the URL) if the caller is a member of it, otherwise their default membership. Redirects to /unauthorized if neither resolves. */
export async function resolveActiveOrg(
  userId: string,
  organizationId?: string,
  client?: SupabaseClient,
): Promise<Membership> {
  const memberships = await fetchMemberships(userId, client)

  const membership = organizationId
    ? findMembership(memberships, organizationId)
    : resolveDefaultMembership(memberships)

  if (!membership) redirect('/unauthorized')
  return membership
}

/** Throws (never redirects — for use inside a server action, where a thrown error becomes a form error, not a full navigation) unless the user has an active membership in `organizationId`. */
export async function requireOrgMembership(
  userId: string,
  organizationId: string,
  client?: SupabaseClient,
): Promise<Membership> {
  const memberships = await fetchMemberships(userId, client)
  return requireMembershipPure(memberships, organizationId)
}

/** Throws unless the user's membership in `organizationId` has one of `allowedRoles`. */
export async function requireRole(
  userId: string,
  organizationId: string,
  allowedRoles: Membership['role'][],
  client?: SupabaseClient,
): Promise<Membership> {
  const membership = await requireOrgMembership(userId, organizationId, client)
  return requireRolePure(membership, allowedRoles)
}

/** Throws unless the user's membership in `organizationId` grants `action` on `resource` per the permission matrix. */
export async function requirePermission(
  userId: string,
  organizationId: string,
  resource: Resource,
  action: Action,
  client?: SupabaseClient,
): Promise<Membership> {
  const membership = await requireOrgMembership(userId, organizationId, client)
  requirePermissionPure(membership, resource, action)
  return membership
}

/** Re-exported for call sites that already have both ids in hand and don't need a DB round-trip. */
export const verifyResourceOrg = verifyResourceOrgPure
