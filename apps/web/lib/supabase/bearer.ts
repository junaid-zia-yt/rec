import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env, supabaseConfigured } from '@/lib/env'

/**
 * Bearer-token Supabase client — for `app/api/mobile/*` Route Handlers
 * (Build Phase 13 Wave 1). A React Native app has no Next.js cookie jar, so
 * it cannot use `lib/supabase/server.ts`'s cookie-based client the way a
 * Server Action / Server Component does; it instead sends the user's
 * Supabase access token as a plain `Authorization: Bearer <token>` header,
 * and this client forwards that header on every request so PostgREST/RLS
 * evaluate the request as that authenticated user — never the service
 * role, and RLS applies exactly as it does for the cookie-based client.
 *
 * Uses the same public URL/anon key as `lib/supabase/client.ts` — the anon
 * key is safe to ship to a mobile client for the same reason it is safe to
 * ship to a browser (RLS is what actually protects data). `persistSession:
 * false` because this client is constructed fresh per request and must
 * never try to read/write a session to disk or a cookie jar it doesn't
 * have.
 *
 * Callers must check `supabaseConfigured` first (see
 * `lib/auth/mobile-session.ts`'s `authenticateMobileRequest`, which is the
 * only sanctioned way any mobile route constructs this) — mirrors every
 * other Supabase-touching module in this codebase.
 */
export function createBearerSupabaseClient(token: string): SupabaseClient {
  if (!supabaseConfigured) {
    throw new Error(
      'createBearerSupabaseClient() called without NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY configured.',
    )
  }

  return createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
