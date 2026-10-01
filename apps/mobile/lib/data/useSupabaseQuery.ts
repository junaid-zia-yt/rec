import { useEffect, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseClient } from '@/lib/supabase/client'
import { notifyUnauthorized } from '@/lib/api/client'
import {
  getIsOnline,
  reportNetworkFailure,
  reportNetworkSuccess,
  subscribeNetworkStatus,
} from '@/lib/network/networkStatus'

/**
 * A thrown/returned Supabase error whose message looks connectivity-shaped
 * (the underlying `fetch` never reached a server) rather than a real
 * server-side error response. Supabase-js (and RN's `fetch` polyfill)
 * don't give a typed "network vs. server" distinction, so this is a
 * message-pattern heuristic — good enough to drive a UI hint, never used
 * for anything security-sensitive.
 */
const NETWORK_ERROR_PATTERN = /network request failed|failed to fetch|fetch failed|networkerror/i

/** A thrown/returned Supabase error whose message looks like an expired or
 * invalid session token — PostgREST's own JWT-rejection message shapes,
 * checked so a direct-Supabase read can trigger the same sign-out-and-
 * redirect flow a 401 from `/api/mobile/*` already triggers (Wave 5's
 * session-expiry requirement), even though Supabase's own automatic
 * refresh-failure handling (`onAuthStateChange` firing `SIGNED_OUT`,
 * wired in AuthProvider) is expected to catch most of these first — this
 * is defense in depth for the case a query resolves with the error before
 * that event fires. */
const AUTH_ERROR_PATTERN =
  /jwt expired|invalid jwt|jwt is expired|pgrst301|invalid token|invalid refresh token/i

/**
 * Minimal RLS-scoped read hook for Wave 4 screens. Built locally because no
 * `useSupabaseQuery`-shaped hook existed under lib/data/ at the time this
 * wave started (see Wave 4 task brief) — if the parallel wave lands one
 * later, the two should be consolidated; until then this is the only one
 * this wave's 7 screens use, so consolidation touches one call site per
 * screen.
 *
 * Contract: `fetcher` runs whenever `deps` change and a Supabase client is
 * configured; it is never called at all when `supabaseConfigured` is
 * false (mirrors every other screen's degrade-gracefully-not-crash rule) —
 * callers render `notConfigured` as an honest empty state.
 */
export interface SupabaseQueryState<T> {
  data: T | null
  loading: boolean
  error: string | null
  notConfigured: boolean
  /** True when the most recent attempt failed for a connectivity reason
   * (or was skipped outright because the shared network signal was
   * already offline) rather than a real server-side error. */
  offline: boolean
  refetch: () => void
}

export function useSupabaseQuery<T>(
  fetcher: (supabase: SupabaseClient) => Promise<T>,
  deps: readonly unknown[],
): SupabaseQueryState<T> {
  const supabase = getSupabaseClient()

  // Lazily seeded from `supabase` at mount so the "not configured" case
  // never needs a synchronous setState from inside the effect below (that
  // trips the react-hooks/set-state-in-effect rule) — `supabaseConfigured`
  // is a module-level constant that never flips at runtime in this app, so
  // this initializer is exactly as accurate as an effect-driven set would
  // have been.
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(() => Boolean(supabase))
  const [error, setError] = useState<string | null>(null)
  const [offline, setOffline] = useState(() => !getIsOnline())
  const [tick, setTick] = useState(0)

  const fetcherRef = useRef(fetcher)
  // Refreshed every render via an effect (never written during render
  // itself — react-hooks/refs forbids that) so the fetching effect below
  // always calls the latest closure, even when its own deps haven't
  // changed. Declared before the fetching effect so it commits first.
  useEffect(() => {
    fetcherRef.current = fetcher
  })

  // A transition from offline -> online (reported by any other network
  // call in the app, or by this hook's own next attempt) auto-retries this
  // query, so a screen recovers the moment connectivity returns instead of
  // requiring the user to pull-to-refresh manually.
  useEffect(() => {
    return subscribeNetworkStatus((isOnline) => {
      if (isOnline) setTick((t) => t + 1)
    })
  }, [])

  useEffect(() => {
    let cancelled = false

    if (!supabase) {
      return undefined
    }

    // Skip the attempt entirely when the shared signal already says
    // offline — no point racing a `fetch` that will just time out, and
    // this keeps the screen in a clean `offline` state immediately rather
    // than flashing "loading" first.
    if (!getIsOnline()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see the sibling comment below: this is the start of a new attempt, computed fresh from deps/tick changing, not a render-time value.
      setLoading(false)
      setOffline(true)
      return undefined
    }

    // Intentional: a new fetch is starting (deps changed or a refetch was
    // requested), so loading/error must reset synchronously before the
    // async call below resolves — there's no render-time equivalent of
    // "a fetch just started" to compute this from instead (already
    // covered by the eslint-disable above, which this rule treats as
    // covering the rest of this effect body).
    setLoading(true)
    setError(null)
    setOffline(false)

    fetcherRef
      .current(supabase)
      .then((result) => {
        if (!cancelled) {
          reportNetworkSuccess()
          setData(result)
          setLoading(false)
          setOffline(false)
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const message =
          err instanceof Error ? err.message : 'Something went wrong loading this data.'
        if (NETWORK_ERROR_PATTERN.test(message)) {
          reportNetworkFailure()
          setOffline(true)
          setError(null)
        } else if (AUTH_ERROR_PATTERN.test(message)) {
          notifyUnauthorized()
          setOffline(false)
          setError(message)
        } else {
          setOffline(false)
          setError(message)
        }
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, tick, ...deps])

  return {
    data,
    loading,
    error,
    notConfigured: !supabase,
    offline,
    refetch: () => setTick((t) => t + 1),
  }
}
