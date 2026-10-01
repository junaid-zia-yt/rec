import { render, screen, waitFor } from '@testing-library/react-native'
import { HomeDashboardScreen } from '@/screens/home/HomeDashboardScreen'
import { createFakeSupabase, FAKE_MEMBERSHIP_ROUTE } from '../test-utils/supabaseMock'

jest.mock('@/lib/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: require('../test-utils/supabaseMock').FAKE_USER,
    session: null,
    loading: false,
    supabaseConfigured: true,
    signOut: jest.fn(),
  }),
}))

const mockGetSupabaseClient = jest.fn()
jest.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: () => mockGetSupabaseClient(),
}))

function renderScreen() {
  const navigation = { getParent: () => ({ navigate: jest.fn() }) } as never
  return render(
    <HomeDashboardScreen
      navigation={navigation}
      route={{ key: 'HomeDashboard', name: 'HomeDashboard' } as never}
    />,
  )
}

describe('HomeDashboardScreen', () => {
  beforeEach(() => {
    mockGetSupabaseClient.mockReset()
  })

  it('shows a loading indicator while the summary is being fetched', () => {
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({
        // Never resolves within this test — asserts the in-flight state
        // without needing to also settle (and warn about) the promise.
        organization_memberships: (() => new Promise(() => {})) as never,
      }),
    )

    renderScreen()

    expect(screen.getByTestId('query-state-loading')).toBeTruthy()
  })

  it('renders an honest empty state when nothing needs attention', async () => {
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({
        organization_memberships: FAKE_MEMBERSHIP_ROUTE,
        recruitment_projects: { data: [], error: null },
        candidate_project_entries: { data: [], error: null },
        scorecard_versions: { data: [], error: null },
      }),
    )

    renderScreen()

    await waitFor(() => {
      expect(screen.getByText('Nothing needs attention right now.')).toBeTruthy()
    })
    expect(screen.getAllByText('0').length).toBeGreaterThan(0)
  })

  it('renders summary counts and navigable recent items when data is present', async () => {
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({
        organization_memberships: FAKE_MEMBERSHIP_ROUTE,
        recruitment_projects: { data: [{ id: 'p1', archived_at: null }], error: null },
        candidate_project_entries: {
          data: [
            {
              id: 'entry-1',
              current_stage: 'quality_review',
              candidates: { full_name: 'Jamie Rivera' },
              recruitment_projects: { id: 'p1', role_title: 'Store Supervisor' },
            },
          ],
          error: null,
        },
        scorecard_versions: { data: [], error: null },
      }),
    )

    renderScreen()

    await waitFor(() => {
      expect(screen.getByText('Jamie Rivera')).toBeTruthy()
    })
    expect(screen.getByText(/Awaiting quality review/)).toBeTruthy()
  })
})
