import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { env, supabaseConfigured } from '@/lib/env'

/**
 * Refreshes the Supabase session cookie inside middleware and returns both
 * the (possibly refreshed) response and the current user, if any. Framework
 * boundary only — no route-protection *decisions* live here, those are in
 * middleware.ts itself, so this stays unit-testable in isolation from
 * Next's request/response types where possible (see lib/auth/routing.ts).
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  if (!supabaseConfigured) {
    return { response, user: null }
  }

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL!,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value)
          }
          response = NextResponse.next({ request })
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options)
          }
        },
      },
    },
  )

  // IMPORTANT: do not remove this call. getUser() revalidates the session
  // against Supabase Auth on every request (unlike getSession(), which only
  // reads the local cookie and can be stale/forged) — this is what makes
  // middleware-level protection actually trustworthy.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return { response, user }
}
