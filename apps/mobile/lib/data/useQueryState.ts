import type { SupabaseClient } from '@supabase/supabase-js'
import { useSupabaseQuery } from './useSupabaseQuery'

/**
 * Thin status wrapper around `./useSupabaseQuery` (the fetcher-throws-on-
 * error hook another Build Phase 13 wave landed at that path first — this
 * file avoids re-touching theirs, and both can coexist). Adds the four-state
 * loading/empty/error/success contract this wave's 5 read-only screens are
 * built against, plus an explicit `refreshing` flag for pull-to-refresh so a
 * refresh doesn't flash the full-screen loading state over existing content.
 *
 * `fetcher` should reject (throw / return a rejected promise) on any
 * Supabase error — the underlying hook already treats a thrown error as the
 * `error` state, so a caller that gets `{ data, error }` back from a
 * `.from(...).select(...)` call should `if (error) throw new Error(error.
 * message)` before returning.
 */
export type QueryStatus = 'not_configured' | 'loading' | 'error' | 'offline' | 'empty' | 'success'

export interface QueryStateResult<T> {
  status: QueryStatus
  data: T | null
  error: string | null
  refreshing: boolean
  refresh: () => void
}

export interface QueryStateOptions<T> {
  /** Decides whether a successful, error-free result counts as `empty`.
   * Defaults to "an array with zero items". */
  isEmpty?: (data: T) => boolean
}

const defaultIsEmpty = (data: unknown): boolean => Array.isArray(data) && data.length === 0

export function useQueryState<T>(
  fetcher: (supabase: SupabaseClient) => Promise<T>,
  deps: readonly unknown[],
  options: QueryStateOptions<T> = {},
): QueryStateResult<T> {
  const { data, loading, error, notConfigured, offline, refetch } = useSupabaseQuery<T>(
    fetcher,
    deps,
  )
  const isEmpty = options.isEmpty ?? (defaultIsEmpty as (data: T) => boolean)

  let status: QueryStatus
  if (notConfigured) {
    status = 'not_configured'
  } else if (loading && data === null) {
    status = 'loading'
  } else if (offline && data === null) {
    status = 'offline'
  } else if (error) {
    status = 'error'
  } else if (data === null || isEmpty(data)) {
    status = 'empty'
  } else {
    status = 'success'
  }

  return {
    status,
    data,
    error,
    // A refresh keeps `data` populated while `loading` goes back to true, so
    // this is true only for a re-fetch of already-loaded content, never the
    // initial load (that's the `loading` status above).
    refreshing: loading && data !== null,
    refresh: refetch,
  }
}
