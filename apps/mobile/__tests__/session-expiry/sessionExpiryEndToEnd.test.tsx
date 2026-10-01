import { act, render, screen, waitFor } from '@testing-library/react-native'
import { RootNavigator } from '@/navigation/RootNavigator'
import { AuthProvider } from '@/lib/auth/AuthProvider'

/**
 * Session-expiry test (brief category 5): a true end-to-end path — real
 * AuthProvider + real RootNavigator, only the Supabase client itself
 * mocked — asserting that when Supabase fires an automatic `SIGNED_OUT`
 * event (a failed token refresh, simulating an expired session), the app
 * actually lands back on the Sign In screen with Wave 5's "Your session
 * expired" message, not a bare sign-in form and not a crash.
 */
jest.mock('@/lib/env', () => ({
  ...jest.requireActual('@/lib/env'),
  supabaseConfigured: true,
}))

let authStateCallback: ((event: string, session: unknown) => void) | null = null
const mockGetSession = jest.fn()

// IMPORTANT: getSupabaseClient() must return the SAME object reference on
// every call, exactly like the real module's module-level `cachedClient` —
// lib/data/useSupabaseQuery.ts calls `getSupabaseClient()` fresh on every
// render and puts the result directly in a `useEffect` dependency array, so
// a mock that constructs a new object literal per call makes that effect
// (and therefore every screen mounted under MainTabs) re-run every render,
// forever — an infinite render loop that OOMs Jest. Building the fake
// client once, outside the mock factory, is what the real singleton does.
const mockSupabaseClient = {
  auth: {
    getSession: () => mockGetSession(),
    onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
      authStateCallback = cb
      return { data: { subscription: { unsubscribe: jest.fn() } } }
    },
    signOut: jest.fn(async () => ({ error: null })),
  },
  // Every screen under MainTabs reads via `.from(...)` — return a builder
  // that resolves to an empty, error-free result so screens settle into
  // their normal "empty" state instead of throwing.
  from: () => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      neq: () => builder,
      order: () => builder,
      limit: () => builder,
      in: () => builder,
      is: () => builder,
      maybeSingle: () => builder,
      then: (onFulfilled: (v: { data: unknown; error: null }) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(onFulfilled),
    }
    return builder
  },
}

jest.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: () => mockSupabaseClient,
}))

describe('Session expiry — end to end', () => {
  beforeEach(() => {
    authStateCallback = null
    mockGetSession.mockReset()
  })

  it('signs the user out and shows "Your session expired" after an automatic SIGNED_OUT event', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'tok', user: { id: 'user-1' } } },
    })

    render(
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>,
    )

    // Starts authenticated: Main tabs render, no sign-in form.
    await waitFor(() => {
      expect(screen.getByText('Home')).toBeTruthy()
    })
    expect(screen.queryByText('Sign in to your recruitment workspace.')).toBeNull()

    // Supabase's own auto-refresh fires SIGNED_OUT after a failed token refresh.
    act(() => {
      authStateCallback?.('SIGNED_OUT', null)
    })

    await waitFor(() => {
      expect(screen.getByText('Your session expired, please sign in again.')).toBeTruthy()
    })
    expect(screen.queryByText('Home')).toBeNull()
  })
})
