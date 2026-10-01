import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env, supabaseConfigured } from '@/lib/env'
import { secureStoreAdapter } from './secure-store-adapter'

let cachedClient: SupabaseClient | null = null

/**
 * The mobile Supabase client. Mirrors apps/web/lib/supabase/client.ts's
 * contract exactly: returns `null` when Supabase is not configured so
 * calling code renders an honest "not configured" state instead of
 * throwing during render — this build environment has no live Supabase
 * project, so this is `null` here.
 *
 * Session persistence uses `secureStoreAdapter` (expo-secure-store) rather
 * than the default in-memory/AsyncStorage storage, so a signed-in session
 * survives an app restart without landing in unencrypted storage.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (!supabaseConfigured) return null
  if (cachedClient) return cachedClient

  cachedClient = createClient(env.EXPO_PUBLIC_SUPABASE_URL!, env.EXPO_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: {
      storage: secureStoreAdapter,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  })
  return cachedClient
}
