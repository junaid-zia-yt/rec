import { render, screen, waitFor } from '@testing-library/react-native'
import { EvidenceReviewScreen } from '@/screens/projects/EvidenceReviewScreen'
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

function renderScreen(candidateId = 'cand-1') {
  return render(
    <EvidenceReviewScreen
      navigation={{} as never}
      route={{ key: 'EvidenceReview', name: 'EvidenceReview', params: { candidateId } } as never}
    />,
  )
}

describe('EvidenceReviewScreen', () => {
  beforeEach(() => {
    mockGetSupabaseClient.mockReset()
  })

  it('renders each evidence excerpt with its requirement and source', async () => {
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({
        organization_memberships: FAKE_MEMBERSHIP_ROUTE,
        requirement_evidence: {
          data: [
            {
              id: 'ev-1',
              requirement_id: 'req-1',
              source_kind: 'experience',
              excerpt: 'Managed a team of 12 across two shifts.',
              location: 'Resume p.1',
              relevance_score: 0.9,
              confidence: 0.85,
              is_direct_statement: true,
              job_requirements: { name: 'Team leadership experience' },
            },
          ],
          error: null,
        },
      }),
    )

    renderScreen()

    await waitFor(() => {
      expect(screen.getByText('Team leadership experience')).toBeTruthy()
    })
    expect(screen.getByText(/Managed a team of 12/)).toBeTruthy()
  })

  it('renders an honest empty state when no evidence has been retrieved yet', async () => {
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({
        organization_memberships: FAKE_MEMBERSHIP_ROUTE,
        requirement_evidence: { data: [], error: null },
      }),
    )

    renderScreen()

    await waitFor(() => {
      expect(screen.getByText('No evidence yet')).toBeTruthy()
    })
  })
})
