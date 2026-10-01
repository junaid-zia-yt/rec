import { NextResponse } from 'next/server'
import { authenticateMobileRequest } from '@/lib/auth/mobile-session'
import { resolveActiveOrg } from '@/lib/auth/session'

/**
 * POST /api/mobile/auth/whoami — Build Phase 13 Wave 1.
 *
 * Read-only, but still routed through this layer (not a raw table read)
 * because it needs `resolveActiveOrg`'s membership-resolution logic, the
 * same logic every page load resolves org context through — never a
 * client-supplied organizationId/role taken at face value.
 *
 * Request body: `{ organizationId?: string }` — an explicit override (the
 * mobile app switching orgs), matching `resolveActiveOrg`'s own optional
 * parameter. Omit it to resolve the caller's default membership.
 *
 * Response: `{ success: true, data: { userId, activeOrganization: {...},
 * memberships: [...] } }` — every active membership the caller has, not
 * just the resolved one, so the mobile app can build an org switcher
 * without a second call.
 */
export async function POST(request: Request) {
  const auth = await authenticateMobileRequest(request)
  if ('error' in auth) return auth.error
  const { user, supabase } = auth

  let body: { organizationId?: string } = {}
  try {
    const raw = await request.text()
    body = raw ? JSON.parse(raw) : {}
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body.' }, { status: 400 })
  }

  // `resolveActiveOrg` calls Next.js's `redirect('/unauthorized')` (a page-
  // navigation primitive) if it cannot resolve a membership at all — never
  // the right outcome for a JSON API. Catching it here converts that
  // control-flow throw into a proper 403 response instead of letting a
  // redirect escape this route handler.
  let active
  try {
    active = await resolveActiveOrg(user.id, body.organizationId, supabase)
  } catch {
    return NextResponse.json(
      { success: false, error: 'You do not have access to any organization.' },
      { status: 403 },
    )
  }

  // Every active membership row, for an org switcher — a fresh DB read via
  // the same bearer-scoped client, never trusted from client input.
  const { data: orgRows } = await supabase
    .from('organization_memberships')
    .select('organization_id, role, is_default, client_id, organizations(name)')
    .eq('user_id', user.id)
    .eq('status', 'active')

  const memberships = (orgRows ?? []).map((row: Record<string, unknown>) => ({
    organizationId: row.organization_id as string,
    organizationName:
      ((row.organizations as { name?: string } | null)?.name as string | undefined) ?? null,
    role: row.role as string,
    isDefault: row.is_default as boolean,
    clientId: (row.client_id as string | null) ?? null,
  }))

  return NextResponse.json({
    success: true,
    data: {
      userId: user.id,
      activeOrganization: {
        organizationId: active.organizationId,
        role: active.role,
        isDefault: active.isDefault,
        clientId: active.clientId ?? null,
      },
      memberships,
    },
  })
}
