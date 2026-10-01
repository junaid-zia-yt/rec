import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Mirrors apps/web/lib/auth/membership.ts's `resolveDefaultMembership`
 * contract (docs/06-roles-permissions.md's five roles), read directly via
 * the RLS-scoped mobile client rather than a server action — there is no
 * server-only boundary to cross for a plain read. `organization_memberships`
 * rows are already scoped by RLS to the calling user, so this never risks
 * leaking another user's membership; it only picks WHICH of the caller's own
 * active memberships is "active" for this screen, the same tie-break web
 * uses (the row flagged `is_default`, else the first active one).
 */
export type MobileRole =
  'platform_admin' | 'agency_admin' | 'recruiter' | 'client_decision_maker' | 'read_only_reviewer'

export interface ActiveMembership {
  organizationId: string
  role: MobileRole
  clientId: string | null
}

export async function resolveActiveMembership(
  supabase: SupabaseClient,
  userId: string,
): Promise<ActiveMembership | null> {
  const { data, error } = await supabase
    .from('organization_memberships')
    .select('organization_id, role, status, is_default, client_id')
    .eq('user_id', userId)
    .eq('status', 'active')

  if (error || !data || data.length === 0) return null

  const active = (data.find((row) => row.is_default) ?? data[0]) as {
    organization_id: string
    role: MobileRole
    client_id: string | null
  }

  return {
    organizationId: active.organization_id,
    role: active.role,
    clientId: active.client_id,
  }
}
