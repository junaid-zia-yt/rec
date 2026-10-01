import { render, screen, waitFor } from '@testing-library/react-native'
import { CandidatePipelineScreen } from '@/screens/pipeline/CandidatePipelineScreen'
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

function renderScreen(projectId?: string) {
  const navigation = { navigate: jest.fn() } as never
  const route = {
    key: 'CandidatePipeline',
    name: 'CandidatePipeline',
    params: projectId ? { projectId } : undefined,
  } as never
  return render(<CandidatePipelineScreen navigation={navigation} route={route} />)
}

describe('CandidatePipelineScreen', () => {
  beforeEach(() => {
    mockGetSupabaseClient.mockReset()
  })

  it('shows a loading indicator while the pipeline is being fetched', () => {
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({ organization_memberships: (() => new Promise(() => {})) as never }),
    )

    renderScreen('proj-1')

    expect(screen.getByTestId('query-state-loading')).toBeTruthy()
  })

  it('shows an empty state when no candidates are in the pipeline yet', async () => {
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({
        organization_memberships: FAKE_MEMBERSHIP_ROUTE,
        candidate_project_entries: { data: [], error: null },
      }),
    )

    renderScreen('proj-1')

    await waitFor(() => {
      expect(screen.getByText('No candidates in this pipeline yet')).toBeTruthy()
    })
  })

  it('renders a candidate card with stage and marks an unscored match as unverified, never inventing a score', async () => {
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({
        organization_memberships: FAKE_MEMBERSHIP_ROUTE,
        candidate_project_entries: {
          data: [
            {
              id: 'entry-1',
              candidate_id: 'cand-1',
              recruitment_project_id: 'proj-1',
              current_stage: 'quality_review',
              candidates: { full_name: 'Jamie Rivera' },
              recruitment_projects: { role_title: 'Store Supervisor' },
            },
          ],
          error: null,
        },
        candidate_role_matches: { data: [], error: null },
      }),
    )

    renderScreen('proj-1')

    await waitFor(() => {
      expect(screen.getByText('Jamie Rivera')).toBeTruthy()
    })
    expect(screen.getByText('Quality Review')).toBeTruthy()
    expect(screen.getByText('Unverified')).toBeTruthy()
    expect(screen.getByText('Score unverified')).toBeTruthy()
  })
})
