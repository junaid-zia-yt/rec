import { render, screen, waitFor } from '@testing-library/react-native'
import { JobScorecardScreen } from '@/screens/projects/JobScorecardScreen'
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
  const route = {
    key: 'JobScorecard',
    name: 'JobScorecard',
    params: { projectId: 'proj-1' },
  } as never
  return render(<JobScorecardScreen navigation={navigation} route={route} />)
}

describe('JobScorecardScreen', () => {
  beforeEach(() => {
    mockGetSupabaseClient.mockReset()
  })

  it('shows a loading indicator while the scorecard is being fetched', () => {
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({ organization_memberships: (() => new Promise(() => {})) as never }),
    )

    renderScreen()

    expect(screen.getByTestId('query-state-loading')).toBeTruthy()
  })

  it('shows an empty state when the project has no job yet', async () => {
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({
        organization_memberships: FAKE_MEMBERSHIP_ROUTE,
        recruitment_projects: {
          data: { id: 'proj-1', role_title: 'Store Supervisor' },
          error: null,
        },
        jobs: { data: null, error: null },
      }),
    )

    renderScreen()

    await waitFor(() => {
      expect(screen.getByText('No job on this project yet')).toBeTruthy()
    })
  })

  it('separates mandatory gates from weighted preferred requirements, never inventing a weight', async () => {
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({
        organization_memberships: FAKE_MEMBERSHIP_ROUTE,
        recruitment_projects: {
          data: { id: 'proj-1', role_title: 'Store Supervisor' },
          error: null,
        },
        jobs: { data: { id: 'job-1', title: 'Store Supervisor' }, error: null },
        job_requirements: {
          data: [
            {
              id: 'req-1',
              name: 'Right to work',
              description: 'Must have work authorization',
              type: 'mandatory',
              weight: null,
              verification_status: 'verified',
            },
            {
              id: 'req-2',
              name: '2+ years supervisory experience',
              description: 'Prior team-lead experience',
              type: 'preferred',
              weight: 40,
              verification_status: 'unverified',
            },
          ],
          error: null,
        },
        scorecards: { data: { id: 'sc-1' }, error: null },
        scorecard_versions: {
          data: [{ version_no: 2, status: 'pending_approval', approved_at: null }],
          error: null,
        },
      }),
    )

    renderScreen()

    await waitFor(() => {
      expect(screen.getByText('Right to work')).toBeTruthy()
    })
    expect(screen.getByText('Mandatory')).toBeTruthy()
    expect(screen.getByText('2+ years supervisory experience')).toBeTruthy()
    expect(screen.getByText('40%')).toBeTruthy()
    expect(screen.getByText('Unverified')).toBeTruthy()
    expect(screen.getByText(/v2 · pending approval/)).toBeTruthy()
  })
})
