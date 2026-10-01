'use client'

import { createBrowserClient } from '@supabase/ssr'
import { env, supabaseConfigured } from '@/lib/env'

/**
 * Browser Supabase client. Only ever constructed with the public URL/anon
 * key — the anon key is safe to ship to the client by design (RLS is what
 * actually protects data, not secrecy of this key).
 *
 * Returns null when Supabase is not configured (this environment has no
 * live project connected) so calling UI can render an honest
 * "not configured" state instead of throwing during render.
 */
export function createBrowserSupabaseClient() {
  if (!supabaseConfigured) return null
  return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
}
