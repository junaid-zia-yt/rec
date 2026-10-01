import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { getSupabaseClient } from '@/lib/supabase/client'
import { setUnauthorizedHandler } from '@/lib/api/client'
import { supabaseConfigured } from '@/lib/env'

interface AuthContextValue {
  session: Session | null
  user: User | null
  loading: boolean
  /** True only once Supabase is configured AND the initial session check
   * has completed — the root navigator gates on this, not `loading` alone,
   * so it never briefly flashes the sign-in screen while Supabase itself
   * is unconfigured (that case renders NotConfiguredScreen instead). */
  supabaseConfigured: boolean
  signOut: () => Promise<void>
  /** True when the app was signed out because the session EXPIRED (a
   * failed token refresh, or a 401 from `/api/mobile/*`) rather than
   * because the user tapped "Sign out" themselves — the sign-in screen
   * reads this to show "Your session expired, please sign in again"
   * instead of a bare sign-in form. Cleared by `clearSessionExpired`,
   * which the sign-in screen calls once the user starts a fresh attempt. */
  sessionExpired: boolean
  clearSessionExpired: () => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

/** Namespace prefix for any locally cached reference data a future wave
 * adds (e.g. AsyncStorage-backed offline pipeline/scorecard caches).
 * `signOut` clears every key under this prefix now, per the brief's "clear
 * protected cache on logout" requirement, even though nothing writes under
 * it yet. */
export const CACHE_KEY_NAMESPACE = 'rqi-cache:'

async function clearNamespacedCache() {
  try {
    // Lazily required so this module has no hard dependency on
    // @react-native-async-storage/async-storage until it's actually used by
    // a future wave's caching code — avoids a native-module import in
    // environments (like Jest) that don't need it for anything else.
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default
    const keys = await AsyncStorage.getAllKeys()
    const cacheKeys = keys.filter((key) => key.startsWith(CACHE_KEY_NAMESPACE))
    if (cacheKeys.length > 0) {
      await AsyncStorage.multiRemove(cacheKeys)
    }
  } catch {
    // Best-effort: a cache-clear failure must never block sign-out itself.
  }
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null)
  // Starts false (not loading) when Supabase isn't configured, since there
  // is then no session check to wait for — RootNavigator renders
  // NotConfiguredScreen based on `supabaseConfigured` regardless, but this
  // avoids an effect needing to call setState synchronously on mount for
  // that branch.
  const [loading, setLoading] = useState(supabaseConfigured)
  const [sessionExpired, setSessionExpired] = useState(false)

  // Tracks whether the app currently HAS a session, and whether the next
  // sign-out is one the user asked for — read inside the
  // `onAuthStateChange` listener below to tell "the user tapped Sign out"
  // apart from "the token refresh failed and Supabase itself fired
  // SIGNED_OUT", without either branch needing to be an effect dependency
  // (a ref, not state, since nothing needs to re-render off these alone).
  const hadSessionRef = useRef(false)
  const explicitSignOutRef = useRef(false)

  useEffect(() => {
    const supabase = getSupabaseClient()
    if (!supabase) {
      return
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      hadSessionRef.current = Boolean(data.session)
      setLoading(false)
    })

    // Supabase JS's own auto-refresh already fires `SIGNED_OUT` when a
    // token refresh fails (expired/invalid refresh token) — this is the
    // REAL mechanism behind "session expiry", not something this app has
    // to poll or detect itself. Confirmed by reading @supabase/supabase-js's
    // client (`_autoRefreshTokenTick`/`_removeSession` -> `_notifyAllSubscribers('SIGNED_OUT', ...)`
    // on a refresh failure) rather than assumed.
    const { data: subscription } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'SIGNED_OUT' && hadSessionRef.current && !explicitSignOutRef.current) {
        setSessionExpired(true)
      }
      if (event === 'SIGNED_OUT') {
        explicitSignOutRef.current = false
      }
      hadSessionRef.current = Boolean(nextSession)
      setSession(nextSession)
    })

    return () => subscription.subscription.unsubscribe()
  }, [])

  async function signOut() {
    explicitSignOutRef.current = true
    const supabase = getSupabaseClient()
    if (supabase) {
      await supabase.auth.signOut()
    }
    setSession(null)
    await clearNamespacedCache()
  }

  // Wire the API client's 401 handler to this provider's sign-out path, so
  // any `/api/mobile/*` call that comes back unauthorized (or a direct
  // Supabase read whose error looks like an expired/invalid JWT — see
  // lib/data/useSupabaseQuery.ts's `notifyUnauthorized()` call) signs the
  // user out, marks it as an EXPIRY (not a user-initiated sign-out) and
  // (via the root navigator watching `session`) redirects to sign-in.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setSessionExpired(true)
      void (async () => {
        const supabase = getSupabaseClient()
        if (supabase) {
          await supabase.auth.signOut()
        }
        setSession(null)
        await clearNamespacedCache()
      })()
    })
    return () => setUnauthorizedHandler(null)
  }, [])

  const clearSessionExpired = () => setSessionExpired(false)

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      supabaseConfigured,
      signOut,
      sessionExpired,
      clearSessionExpired,
    }),
    [session, loading, sessionExpired],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
