import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import { env, stagingBasicAuthConfigured, supabaseConfigured } from '@/lib/env'
import { isAuthPath, requiresAuth } from '@/lib/auth/routing'
import {
  isValidStagingBasicAuthHeader,
  STAGING_BASIC_AUTH_WWW_AUTHENTICATE_HEADER,
} from '@/lib/auth/staging-basic-auth'

/**
 * Session refresh + route protection (Build Phase 2 brief §2). Runs on
 * every request matched by `config.matcher` below. Named `proxy.ts` per
 * Next.js 16's renamed file convention (this file was called
 * `middleware.ts` until the build flagged that convention as deprecated —
 * the export name changed from `middleware` to `proxy` too, matching
 * Next's own migration guide).
 *
 * When Supabase is not configured (`supabaseConfigured` false — true for
 * this entire environment, since no live project is connected), there is no
 * session to check, so auth is not enforced; the response carries
 * `x-rqi-auth-enforced: false` so this is verifiable from a request rather
 * than asserted in prose, and every auth screen renders its own
 * "not configured" state for the same reason (see lib/auth/actions.ts).
 * Once Supabase is configured this branch is never taken and every
 * protected path requires a real session, verified against Supabase Auth
 * (not just a locally-readable cookie) on every request.
 */
/**
 * Build Phase 15 Wave 2 — coarse staging-access gate, enforced BEFORE the
 * real Supabase-Auth check below, when (and only when) both
 * STAGING_BASIC_AUTH_USER and STAGING_BASIC_AUTH_PASSWORD are set
 * (`stagingBasicAuthConfigured`, lib/env.ts). Unset in every environment
 * that hasn't deliberately opted in (local dev, and — notably — production,
 * whose access posture is still undecided) this whole block is a no-op:
 * the request proceeds straight to the real auth check as before.
 *
 * This is NOT a substitute for that real check. It exists only to keep
 * search engines and casual/opportunistic visitors off a shared staging
 * URL; the app's own Supabase-Auth-based authentication/authorization below
 * still fully applies to every request that gets past it — the shared
 * staging password does not grant access to any account or candidate data
 * by itself.
 *
 * No path is exempted: this codebase has no health-check endpoint today
 * (grepped for one before writing this), so there is nothing that
 * legitimately needs to stay reachable without it. If a future staging
 * pipeline adds one, it must be added to this allowlist deliberately and
 * must reveal nothing sensitive in its response.
 */
function checkStagingBasicAuth(request: NextRequest): NextResponse | null {
  if (!stagingBasicAuthConfigured) return null

  const header = request.headers.get('authorization')
  const valid = isValidStagingBasicAuthHeader(
    header,
    env.STAGING_BASIC_AUTH_USER ?? '',
    env.STAGING_BASIC_AUTH_PASSWORD ?? '',
  )
  if (valid) return null

  return new NextResponse('Authentication required.', {
    status: 401,
    headers: { 'WWW-Authenticate': STAGING_BASIC_AUTH_WWW_AUTHENTICATE_HEADER },
  })
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  const basicAuthRejection = checkStagingBasicAuth(request)
  if (basicAuthRejection) return basicAuthRejection

  if (!supabaseConfigured) {
    const response = NextResponse.next()
    response.headers.set('x-rqi-auth-enforced', 'false')
    return response
  }

  const { response, user } = await updateSession(request)
  response.headers.set('x-rqi-auth-enforced', 'true')

  if (requiresAuth(pathname) && !user) {
    const signInUrl = new URL('/sign-in', request.url)
    // Store only an internal path in `next` — sanitizeRedirectPath (lib/auth/actions.ts)
    // re-validates it server-side before ever using it in a redirect, but
    // building it from the same-origin request URL here means it is never
    // attacker-controlled to begin with.
    signInUrl.searchParams.set('next', `${pathname}${search}`)
    return NextResponse.redirect(signInUrl)
  }

  if (isAuthPath(pathname) && user) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Match every request path except:
     * - _next/static, _next/image (build assets)
     * - favicon.ico and other static files with a file extension
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)',
  ],
}
