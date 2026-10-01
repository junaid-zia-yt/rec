import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { ClientDecisionScreen } from '@/screens/shortlists/ClientDecisionScreen'
import { createFakeSupabase } from '../test-utils/supabaseMock'

const CLIENT_MEMBERSHIP_ROUTE = {
  data: [
    {
      organization_id: 'org-1',
      role: 'client_decision_maker',
      status: 'active',
      is_default: true,
      client_id: 'client-1',
    },
  ],
  error: null,
}

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

const mockSubmitShortlistClientDecision = jest.fn()
jest.mock('@/lib/api/client', () => {
  const actual = jest.requireActual('@/lib/api/client')
  return {
    ...actual,
    submitShortlistClientDecision: (...args: unknown[]) =>
      mockSubmitShortlistClientDecision(...args),
  }
})

function renderScreen(shortlistId = 'sl-1') {
  return render(
    <ClientDecisionScreen
      navigation={{} as never}
      route={{ key: 'ClientDecision', name: 'ClientDecision', params: { shortlistId } } as never}
    />,
  )
}

const ROUTES = {
  organization_memberships: CLIENT_MEMBERSHIP_ROUTE,
  shortlists: {
    data: [
      {
        id: 'sl-1',
        recruitment_project_id: 'proj-1',
        job_id: 'job-1',
        client_id: 'client-1',
        status: 'sent_to_client',
        max_candidates: 3,
        jobs: { title: 'Store Supervisor' },
        clients: { name: 'Acme Retail' },
      },
    ],
    error: null,
  },
  shortlist_versions: { data: [{ id: 'sv-1', status: 'sent_to_client' }], error: null },
  shortlist_candidates: {
    data: [
      {
        id: 'sc-1',
        candidate_id: 'cand-1',
        candidate_role_match_id: 'match-1',
        rank: 1,
        recruiter_note: null,
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

describe('ClientDecisionScreen', () => {
  beforeEach(() => {
    mockGetSupabaseClient.mockReset()
    mockSubmitShortlistClientDecision.mockReset()
  })

  it('renders the sent shortlist awaiting a client decision', async () => {
    mockGetSupabaseClient.mockReturnValue(createFakeSupabase(ROUTES))

    renderScreen()

    await waitFor(() => {
      expect(screen.getByText('Jamie Rivera')).toBeTruthy()
    })
    expect(screen.getByText('Accept')).toBeTruthy()
  })

  it('submits a reject decision with the required notes', async () => {
    mockGetSupabaseClient.mockReturnValue(createFakeSupabase(ROUTES))
    mockSubmitShortlistClientDecision.mockResolvedValue({ shortlistId: 'sl-1', decision: 'reject' })

    renderScreen()

    await waitFor(() => {
      expect(screen.getByText('Reject')).toBeTruthy()
    })
    fireEvent.press(screen.getByText('Reject'))

    await waitFor(() => {
      expect(screen.getByText('Confirm rejection')).toBeTruthy()
    })
    fireEvent.changeText(
      screen.getByPlaceholderText('Why?'),
      'Not the right fit for the client team.',
    )
    fireEvent.press(screen.getByText('Confirm'))

    await waitFor(() => {
      expect(mockSubmitShortlistClientDecision).toHaveBeenCalledWith(
        'sl-1',
        expect.objectContaining({
          organizationId: 'org-1',
          shortlistVersionId: 'sv-1',
          clientId: 'client-1',
          decision: 'reject',
          notes: 'Not the right fit for the client team.',
        }),
      )
    })
  })
})
