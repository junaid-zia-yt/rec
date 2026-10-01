import { render, screen, waitFor } from '@testing-library/react-native'
import { CandidateComparisonScreen } from '@/screens/shortlists/CandidateComparisonScreen'
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

function renderScreen(candidateIds = ['cand-1', 'cand-2']) {
  return render(
    <CandidateComparisonScreen
      navigation={{} as never}
      route={
        {
          key: 'CandidateComparison',
          name: 'CandidateComparison',
          params: { candidateIds },
        } as never
      }
    />,
  )
}

describe('CandidateComparisonScreen', () => {
  beforeEach(() => {
    mockGetSupabaseClient.mockReset()
  })

  it('renders each finalist stacked with score, gates and evidence', async () => {
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({
        organization_memberships: FAKE_MEMBERSHIP_ROUTE,
        candidate_role_matches: {
          data: [
            {
              id: 'match-1',
              candidate_id: 'cand-1',
              eligibility: 'eligible',
              overall_score: 88,
              evidence_coverage_pct: 92,
              data_completeness_pct: 95,
              candidates: { full_name: 'Jamie Rivera' },
            },
            {
              id: 'match-2',
              candidate_id: 'cand-2',
              eligibility: 'eligible',
              overall_score: 79,
              evidence_coverage_pct: 80,
              data_completeness_pct: 88,
              candidates: { full_name: 'Alex Chen' },
            },
          ],
          error: null,
        },
        mandatory_gate_results: { data: [], error: null },
        shortlist_candidates: { data: [], error: null },
      }),
    )

    renderScreen()

    await waitFor(() => {
      expect(screen.getByText('Jamie Rivera')).toBeTruthy()
    })
    expect(screen.getByText('Alex Chen')).toBeTruthy()
    expect(screen.getAllByText('88%').length).toBeGreaterThan(0)
    expect(screen.getByText('79%')).toBeTruthy()
  })
})
