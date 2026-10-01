/**
 * A minimal fake Supabase query builder for screen tests. Every chain
 * method (`select`, `eq`, `order`, `limit`, `in`, `is`, `maybeSingle`, …)
 * returns the same thenable object, and awaiting it resolves to whatever
 * `routes[table]` was configured to return — either a fixed
 * `{ data, error }` value, or a function returning one (call it again per
 * invocation, e.g. to serve a different table queried twice with different
 * filters within one screen). Good enough for these read-only screens,
 * which never do anything with the query beyond building filters and
 * awaiting the result.
 */
export type SupabaseRouteResult = { data: unknown; error: { message: string } | null }
export type SupabaseRoute = SupabaseRouteResult | (() => SupabaseRouteResult)

export function createFakeSupabase(routes: Record<string, SupabaseRoute>) {
  const from = (table: string) => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      neq: () => builder,
      order: () => builder,
      limit: () => builder,
      in: () => builder,
      is: () => builder,
      maybeSingle: () => builder,
      then: (
        onFulfilled: (value: SupabaseRouteResult) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => {
        const route = routes[table]
        const result: SupabaseRouteResult = route
          ? typeof route === 'function'
            ? route()
            : route
          : { data: [], error: null }
        return Promise.resolve(result).then(onFulfilled, onRejected)
      },
    }
    return builder
  }

  return { from } as unknown as import('@supabase/supabase-js').SupabaseClient
}

export const FAKE_USER = {
  id: 'user-1',
  email: 'reviewer@example.com',
} as unknown as import('@supabase/supabase-js').User

export const FAKE_MEMBERSHIP_ROUTE: SupabaseRoute = {
  data: [
    {
      organization_id: 'org-1',
      role: 'agency_admin',
      status: 'active',
      is_default: true,
      client_id: null,
    },
  ],
  error: null,
}
