/**
 * Pure route-classification logic for middleware.ts — no Next.js request/
 * response types here, so this is directly unit-testable.
 */

/** Paths under the (auth) route group — sign-in and friends. Authenticated users are redirected away from these (Build Phase 2 brief §2 "Redirect authenticated users away from auth screens"). */
const AUTH_PATHS = ['/sign-in', '/forgot-password', '/reset-password', '/accept-invitation']

/** Paths that never require a session, and are not auth screens either (so an authenticated user is not bounced away from them). */
const PUBLIC_PATHS = ['/unauthorized', '/auth/callback']

export function isAuthPath(pathname: string): boolean {
  return AUTH_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

/** Everything else under the (app) route group is protected by default — an allowlist of public paths, not a denylist of protected ones, so a newly-added route is protected unless someone deliberately opts it out. */
export function requiresAuth(pathname: string): boolean {
  if (isAuthPath(pathname)) return false
  if (isPublicPath(pathname)) return false
  if (pathname.startsWith('/_next') || pathname.startsWith('/api/')) return false
  return true
}

/**
 * Validates that `path` is safe to redirect an authenticated user to after
 * sign-in — prevents an open-redirect via a `?next=` query param pointing
 * at an external host (Build Phase 2 brief SECURITY §"Prevent open
 * redirects"). Only an internal, single-leading-slash path is accepted.
 */
export function sanitizeRedirectPath(path: string | null | undefined): string {
  if (!path) return '/dashboard'
  if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return '/dashboard'
  if (path.includes('://')) return '/dashboard'
  return path
}
