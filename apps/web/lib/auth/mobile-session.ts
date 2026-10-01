import 'server-only'
import { NextResponse } from 'next/server'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { supabaseConfigured } from '@/lib/env'
import { createBearerSupabaseClient } from '@/lib/supabase/bearer'
import { captureMonitoringMessage } from '@/lib/monitoring/capture'

/**
 * Bearer-token authentication for `app/api/mobile/*` Route Handlers (Build
 * Phase 13 Wave 1). This is the mobile-layer equivalent of
 * `lib/auth/session.ts`'s `requireAuth` — but `requireAuth` itself is not
 * reusable here: it calls Next.js's `redirect()` on failure, which is only
 * meaningful for a page load. A JSON API route must return a 401 response,
 * never a redirect, so this is a small, separate function with the same
 * "never trust a client-supplied identity" guarantee: the bearer token is
 * always verified against Supabase itself via `auth.getUser()`, never
 * decoded/trusted locally.
 *
 * Every mobile route handler must call this FIRST, and must pass the
 * returned `supabase` (bearer-scoped) client into `resolveActiveOrg` /
 * `requirePermission` / etc. (lib/auth/session.ts, Step 2's injectable-
 * client parameter) as the injected client — a mobile route must never
 * construct a second Supabase client of its own.
 */

export type MobileAuthErrorCode = 'unauthorized' | 'not_configured'

export interface MobileAuthErrorBody {
  error: string
  code: MobileAuthErrorCode
}

export type MobileAuthResult =
  { user: User; supabase: SupabaseClient } | { error: NextResponse<MobileAuthErrorBody> }

function unauthorizedResponse(message = 'Sign in required.'): NextResponse<MobileAuthErrorBody> {
  return NextResponse.json({ error: message, code: 'unauthorized' }, { status: 401 })
}

function notConfiguredResponse(): NextResponse<MobileAuthErrorBody> {
  return NextResponse.json(
    { error: 'This environment is not connected to a live database yet.', code: 'not_configured' },
    { status: 401 },
  )
}

/**
 * Extracts and verifies the `Authorization: Bearer <token>` header on
 * `request`. Returns the verified `user` plus the bearer-scoped `supabase`
 * client to reuse for every subsequent call in the same request (never
 * construct a second client), or a typed `NextResponse` the route handler
 * should return immediately.
 */
export async function authenticateMobileRequest(request: Request): Promise<MobileAuthResult> {
  if (!supabaseConfigured) {
    // Distinct from the plain "no/invalid bearer token" 401 paths below,
    // which are normal, expected caller behavior — this one means the
    // DEPLOYMENT itself has no live database connected, a genuine
    // environment/operational problem worth surfacing, not a caller
    // mistake (Build Phase 15 Wave 3, "API failures" surface).
    captureMonitoringMessage(
      'Mobile API request received with Supabase not configured',
      'warning',
      {
        category: 'api',
      },
    )
    return { error: notConfiguredResponse() }
  }

  const authHeader = request.headers.get('authorization') ?? request.headers.get('Authorization')
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    return { error: unauthorizedResponse() }
  }

  const token = authHeader.slice('bearer '.length).trim()
  if (!token) {
    return { error: unauthorizedResponse() }
  }

  let supabase: SupabaseClient
  try {
    supabase = createBearerSupabaseClient(token)
  } catch {
    return { error: notConfiguredResponse() }
  }

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    return { error: unauthorizedResponse() }
  }

  return { user, supabase }
}
