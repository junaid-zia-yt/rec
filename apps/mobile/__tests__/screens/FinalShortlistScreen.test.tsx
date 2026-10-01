import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { FinalShortlistScreen } from '@/screens/shortlists/FinalShortlistScreen'
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

const mockApproveShortlistInternally = jest.fn()
jest.mock('@/lib/api/client', () => {
  const actual = jest.requireActual('@/lib/api/client')
  return {
    ...actual,
    approveShortlistInternally: (...args: unknown[]) => mockApproveShortlistInternally(...args),
  }
})

function renderScreen(shortlistId = 'sl-1') {
  return render(
    <FinalShortlistScreen
      navigation={{} as never}
      route={{ key: 'FinalShortlist', name: 'FinalShortlist', params: { shortlistId } } as never}
    />,
  )
}

const ROUTES = {
  organization_memberships: FAKE_MEMBERSHIP_ROUTE,
  shortlists: {
    data: [
      {
        id: 'sl-1',
        recruitment_project_id: 'proj-1',
        job_id: 'job-1',
        client_id: 'client-1',
        status: 'pending_internal_approval',
        max_candidates: 3,
        jobs: { title: 'Store Supervisor' },
        clients: { name: 'Acme Retail' },
      },
    ],
    error: null,
  },
  shortlist_versions: { data: [{ id: 'sv-1', status: 'submitted' }], error: null },
  shortlist_candidates: {
    data: [
      {
        id: 'sc-1',
        candidate_id: 'cand-1',
        candidate_role_match_id: 'match-1',
        rank: 1,
        recruiter_note: 'Strong multi-unit background.',
        candidates: { full_name: 'Jamie Rivera' },
        candidate_role_matches: {
          overall_score: 88,
          evidence_coverage_pct: 92,
          data_completeness_pct: 95,
        },
      },
    ],
    error: null,
  },
  mandatory_gate_results: {
    data: [{ candidate_role_match_id: 'match-1', state: 'passed', override_result: null }],
    error: null,
  },
}

describe('FinalShortlistScreen', () => {
  beforeEach(() => {
    mockGetSupabaseClient.mockReset()
    mockApproveShortlistInternally.mockReset()
  })

  it('renders the finalist cards with score, gates and evidence', async () => {
    mockGetSupabaseClient.mockReturnValue(createFakeSupabase(ROUTES))

    renderScreen()

    await waitFor(() => {
      expect(screen.getByText('Jamie Rivera')).toBeTruthy()
    })
    expect(screen.getByText('88%')).toBeTruthy()
    expect(screen.getByText('1/1')).toBeTruthy()
  })

  it('records internal approval after confirmation', async () => {
    mockGetSupabaseClient.mockReturnValue(createFakeSupabase(ROUTES))
    mockApproveShortlistInternally.mockResolvedValue({
      shortlistId: 'sl-1',
      shortlistVersionId: 'sv-1',
      status: 'internally_approved',
    })

    renderScreen()

    await waitFor(() => {
      expect(screen.getByText('Record internal approval')).toBeTruthy()
    })
    fireEvent.press(screen.getByText('Record internal approval'))

    await waitFor(() => {
      expect(screen.getByText('Confirm internal approval')).toBeTruthy()
    })
    fireEvent.press(screen.getByText('Confirm approval'))

    await waitFor(() => {
      expect(mockApproveShortlistInternally).toHaveBeenCalledWith('sl-1', {
        organizationId: 'org-1',
        shortlistVersionId: 'sv-1',
      })
    })
  })
})
