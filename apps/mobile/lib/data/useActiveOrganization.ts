import type { Role } from '@rqi/types'
import { useAuth } from '@/lib/auth/AuthProvider'
import { resolveActiveMembership } from './org'
import { useQueryState } from './useQueryState'

export interface ActiveOrganization {
  organizationId: string
  role: Role
  clientId: string | null
}

/**
 * Resolves the caller's active organization membership + role for
 * client-side action gating (this wave's `canReview`/`canDecide` checks) —
 * built on `resolveActiveMembership` (./org.ts, landed by a parallel Build
 * Phase 13 wave — reused rather than re-implemented, per this wave's own
 * task brief) via `useQueryState` so it shares the same not_configured/
 * loading/error/empty/success contract every other read in this wave uses.
 *
 * This is a direct RLS-scoped read, not a call to `POST /api/mobile/auth/
 * whoami` (that wrapper still exists in lib/api/client.ts for a caller that
 * specifically needs the API's own resolution logic/org-switcher list) —
 * never trusted for the server-side permission decision either way, since
 * every mutation route re-checks with `requirePermission` itself.
 */
export function useActiveOrganization() {
  const { user } = useAuth()
  const userId = user?.id ?? null

  const state = useQueryState<ActiveOrganization | null>(
    async (supabase) => {
      if (!userId) return null
      const membership = await resolveActiveMembership(supabase, userId)
      if (!membership) return null
      return {
        organizationId: membership.organizationId,
        role: membership.role as Role,
        clientId: membership.clientId,
      }
    },
    [userId],
    { isEmpty: (data) => data === null },
  )

  return {
    organization: state.data,
    loading: state.status === 'loading',
    error: state.error,
  }
}
