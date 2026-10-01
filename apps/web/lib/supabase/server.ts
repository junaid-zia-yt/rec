import 'server-only'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { env, supabaseConfigured } from '@/lib/env'

/**
 * Server Component / Server Action Supabase client — reads/writes the
 * session via Next.js's cookie store, respects RLS (this is an
 * authenticated-user-scoped client, never the service role).
 *
 * Returns null when Supabase is not configured, so every server action and
 * server component that calls this must handle the "not configured" case
 * explicitly rather than assuming a client always exists.
 */
export async function createServerSupabaseClient() {
  if (!supabaseConfigured) return null

  const cookieStore = await cookies()

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Called from a Server Component (not a Server Action/Route
          // Handler) — cookies() is read-only there. Session refresh in
          // that case is handled by middleware.ts instead, so this is safe
          // to ignore rather than surface as an error.
        }
      },
    },
  })
}
