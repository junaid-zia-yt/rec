import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env, supabaseAdminConfigured } from '@/lib/env'

/**
 * Service-role Supabase client — server-only, never imported by anything a
 * client bundle could pull in (the `server-only` import above makes any
 * accidental client-side import a build error, not just a lint warning).
 *
 * Bypasses RLS entirely, per Supabase convention. Reserved for:
 *   - the seed script (scripts/seed.ts)
 *   - platform_admin-scoped server actions that must legitimately cross the
 *     tenant boundary (e.g. suspending an organization)
 * Never used for anything an authenticated user's own session could do —
 * those go through lib/supabase/server.ts's RLS-respecting client instead.
 */
export function createAdminClient(): SupabaseClient {
  if (!supabaseAdminConfigured) {
    throw new Error(
      'createAdminClient() called without SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL configured. ' +
        'No Supabase project is connected in this environment — see supabase/README.md.',
    )
  }

  return createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
