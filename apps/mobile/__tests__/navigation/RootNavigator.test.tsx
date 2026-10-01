import { render, screen, waitFor } from '@testing-library/react-native'
import { RootNavigator } from '@/navigation/RootNavigator'

/**
 * Navigation tests for the root Auth-stack ⇄ Main-tabs switch (the
 * brief's navigation-test category). A full deep-navigation render (Home →
 * Project details → Job scorecard) is impractical to assert reliably in
 * this Jest/RN-testing-library setup without a real Supabase backend to
 * drive every intermediate screen's data-dependent "Tap to open X" content,
 * so this file covers the two states RootNavigator itself is responsible
 * for switching between, plus asserts the authenticated state never
 * renders any Auth-stack content and vice versa. The deep-link resolver's
 * pure navigation-target logic (a real typed cross-tab jump, e.g. Home's
 * notification list → ProjectsTab/OutreachApproval) is covered directly
 * and without mocking in __tests__/notifications/resolveDeepLink.test.ts,
 * and NotificationsScreen.test.tsx already asserts a resolved deep link's
 * params reach `navigation.navigate` with the exact tab/screen/params
 * shape — together these substitute for a full-tree deep-navigation
 * render, per the task brief's allowance for a scoped substitute.
 */

let mockAuthState: {
  session: unknown
  loading: boolean
  supabaseConfigured: boolean
} = { session: null, loading: false, supabaseConfigured: true }

jest.mock('@/lib/auth/AuthProvider', () => ({
  useAuth: () => ({
    ...mockAuthState,
    user: mockAuthState.session ? { id: 'user-1' } : null,
    signOut: jest.fn(),
    sessionExpired: false,
    clearSessionExpired: jest.fn(),
  }),
}))

describe('RootNavigator', () => {
  it('renders the Auth stack (Sign In) when there is no session, never any Main-tab content', async () => {
    mockAuthState = { session: null, loading: false, supabaseConfigured: true }
    render(<RootNavigator />)

    await waitFor(() => {
      expect(screen.getByText('Sign in to your recruitment workspace.')).toBeTruthy()
    })
    expect(screen.queryByText('Home')).toBeNull()
    expect(screen.queryByText('Projects')).toBeNull()
  })

  it('renders the Main tab bar (not the sign-in form) once a session is present', async () => {
    mockAuthState = { session: { access_token: 'tok' }, loading: false, supabaseConfigured: true }
    render(<RootNavigator />)

    await waitFor(() => {
      expect(screen.getByText('Home')).toBeTruthy()
    })
    expect(screen.getByText('Projects')).toBeTruthy()
    expect(screen.getByText('Pipeline')).toBeTruthy()
    expect(screen.getByText('Shortlists')).toBeTruthy()
    expect(screen.getByText('More')).toBeTruthy()
    expect(screen.queryByText('Sign in to your recruitment workspace.')).toBeNull()
  })

  it('renders NotConfiguredScreen (no navigator at all) when Supabase is not configured, regardless of session', async () => {
    mockAuthState = { session: null, loading: false, supabaseConfigured: false }
    render(<RootNavigator />)

    await waitFor(() => {
      expect(screen.getByText('App not configured')).toBeTruthy()
    })
    expect(screen.queryByText('Sign in to your recruitment workspace.')).toBeNull()
    expect(screen.queryByText('Home')).toBeNull()
  })
})
