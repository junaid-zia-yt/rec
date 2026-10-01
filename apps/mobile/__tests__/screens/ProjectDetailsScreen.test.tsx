import { render, screen, waitFor } from '@testing-library/react-native'
import { ProjectDetailsScreen } from '@/screens/projects/ProjectDetailsScreen'
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
  const navigation = { navigate: jest.fn(), getParent: () => ({ navigate: jest.fn() }) } as never
  const route = {
    key: 'ProjectDetails',
    name: 'ProjectDetails',
    params: { projectId: 'proj-1' },
  } as never
  return render(<ProjectDetailsScreen navigation={navigation} route={route} />)
}

describe('ProjectDetailsScreen', () => {
  beforeEach(() => {
    mockGetSupabaseClient.mockReset()
  })

  it('shows a loading indicator while the project is being fetched', () => {
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({ organization_memberships: (() => new Promise(() => {})) as never }),
    )

    renderScreen()

    expect(screen.getByTestId('query-state-loading')).toBeTruthy()
  })

  it('shows an honest empty state when the project cannot be found', async () => {
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({
        organization_memberships: FAKE_MEMBERSHIP_ROUTE,
        recruitment_projects: { data: null, error: null },
      }),
    )

    renderScreen()

    await waitFor(() => {
      expect(screen.getByText('Project not found')).toBeTruthy()
    })
  })

  it('renders project metadata, jobs and pipeline candidates', async () => {
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({
        organization_memberships: FAKE_MEMBERSHIP_ROUTE,
        recruitment_projects: {
          data: {
            id: 'proj-1',
            role_title: 'Store Supervisor',
            vertical: 'Retail',
            status: 'sourcing',
            is_poc: false,
            clients: { name: 'Acme Retail' },
          },
          error: null,
        },
        jobs: {
          data: [
            { id: 'job-1', title: 'Store Supervisor', status: 'open', location: 'Dallas, TX' },
          ],
          error: null,
        },
        candidate_project_entries: {
          data: [
            {
              id: 'entry-1',
              candidate_id: 'cand-1',
              current_stage: 'scored',
              candidates: { full_name: 'Jamie Rivera' },
            },
          ],
          error: null,
        },
      }),
    )

    renderScreen()

    await waitFor(() => {
      expect(screen.getAllByText('Store Supervisor').length).toBeGreaterThan(0)
    })
    expect(screen.getByText(/Acme Retail/)).toBeTruthy()
    expect(screen.getByText('Jamie Rivera')).toBeTruthy()
  })
})
