import { render, screen, waitFor } from '@testing-library/react-native'
import { ProjectListScreen } from '@/screens/projects/ProjectListScreen'
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
  const navigation = { navigate: jest.fn() } as never
  return render(
    <ProjectListScreen
      navigation={navigation}
      route={{ key: 'ProjectList', name: 'ProjectList' } as never}
    />,
  )
}

describe('ProjectListScreen', () => {
  beforeEach(() => {
    mockGetSupabaseClient.mockReset()
  })

  it('shows a loading indicator while projects are being fetched', () => {
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({ organization_memberships: (() => new Promise(() => {})) as never }),
    )

    renderScreen()

    expect(screen.getByTestId('query-state-loading')).toBeTruthy()
  })

  it('shows an empty state when the organization has no projects', async () => {
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({
        organization_memberships: FAKE_MEMBERSHIP_ROUTE,
        recruitment_projects: { data: [], error: null },
      }),
    )

    renderScreen()

    await waitFor(() => {
      expect(screen.getByText('No projects yet')).toBeTruthy()
    })
  })

  it('renders a project card with client, status and counts', async () => {
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({
        organization_memberships: FAKE_MEMBERSHIP_ROUTE,
        recruitment_projects: {
          data: [
            {
              id: 'proj-1',
              role_title: 'Store Supervisor',
              vertical: 'Retail',
              status: 'sourcing',
              is_poc: false,
              archived_at: null,
              created_at: '2026-01-01T00:00:00Z',
              clients: { name: 'Acme Retail' },
            },
          ],
          error: null,
        },
        jobs: { data: [{ id: 'job-1', recruitment_project_id: 'proj-1' }], error: null },
        candidate_project_entries: { data: [], error: null },
      }),
    )

    renderScreen()

    await waitFor(() => {
      expect(screen.getByText('Store Supervisor')).toBeTruthy()
    })
    expect(screen.getByText(/Acme Retail/)).toBeTruthy()
    expect(screen.getByText('1 job')).toBeTruthy()

    // [A11Y REGRESSION GUARD] Build Phase 14 audit: this row's Pressable
    // previously had no accessibilityRole, so screen readers didn't announce
    // it as an actionable button. Assert the fix stays in place.
    expect(screen.getByRole('button', { name: /Store Supervisor/ })).toBeTruthy()
  })

  it('exposes each status filter chip as a selectable button to assistive tech', async () => {
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({
        organization_memberships: FAKE_MEMBERSHIP_ROUTE,
        recruitment_projects: { data: [], error: null },
      }),
    )

    renderScreen()

    await waitFor(() => {
      expect(screen.getByText('No projects yet')).toBeTruthy()
    })

    const allChip = screen.getByRole('button', { name: 'Filter: All' })
    expect(allChip).toBeTruthy()
    expect(allChip.props.accessibilityState?.selected).toBe(true)
  })
})
