import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { CandidateEvaluationScreen } from '@/screens/pipeline/CandidateEvaluationScreen'
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

const mockSubmitGateOverride = jest.fn()
jest.mock('@/lib/api/client', () => {
  const actual = jest.requireActual('@/lib/api/client')
  return { ...actual, submitGateOverride: (...args: unknown[]) => mockSubmitGateOverride(...args) }
})

function renderScreen(candidateId = 'cand-1') {
  return render(
    <CandidateEvaluationScreen
      navigation={{} as never}
      route={
        {
          key: 'CandidateEvaluation',
          name: 'CandidateEvaluation',
          params: { candidateId },
        } as never
      }
    />,
  )
}

const MATCH_ROW = {
  id: 'match-1',
  job_id: 'job-1',
  latest_matching_run_id: 'run-1',
  eligibility: 'eligible',
  overall_score: 82,
  evidence_coverage_pct: 90,
  data_completeness_pct: 95,
  confidence: 0.8,
  review_status: 'pending',
  jobs: { title: 'Store Supervisor' },
}

const GATE_ROW = {
  id: 'gate-1',
  requirement_id: 'req-1',
  requirement_name: 'Valid driver license',
  state: 'unknown',
  ai_suggested_result: null,
  ai_suggestion_note: null,
  risk_notes: [],
  override_result: null,
  override_reason: null,
  override_evidence_note: null,
}

describe('CandidateEvaluationScreen', () => {
  beforeEach(() => {
    mockGetSupabaseClient.mockReset()
    mockSubmitGateOverride.mockReset()
  })

  it('renders the candidate summary and mandatory gates once loaded', async () => {
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({
        organization_memberships: FAKE_MEMBERSHIP_ROUTE,
        candidates: { data: { full_name: 'Jamie Rivera' }, error: null },
        candidate_role_matches: { data: [MATCH_ROW], error: null },
        mandatory_gate_results: { data: [GATE_ROW], error: null },
      }),
    )

    renderScreen()

    await waitFor(() => {
      expect(screen.getByText('Jamie Rivera')).toBeTruthy()
    })
    expect(screen.getByText('Valid driver license')).toBeTruthy()
    expect(screen.getByText('82%')).toBeTruthy()
  })

  it('submits a gate override with the entered reason and evidence', async () => {
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({
        organization_memberships: FAKE_MEMBERSHIP_ROUTE,
        candidates: { data: { full_name: 'Jamie Rivera' }, error: null },
        candidate_role_matches: { data: [MATCH_ROW], error: null },
        mandatory_gate_results: { data: [GATE_ROW], error: null },
      }),
    )
    mockSubmitGateOverride.mockResolvedValue({
      gateResultId: 'gate-1',
      eligibility: 'eligible',
      overallScore: 82,
    })

    renderScreen()

    await waitFor(() => {
      expect(screen.getByText('Override')).toBeTruthy()
    })
    fireEvent.press(screen.getByText('Override'))

    await waitFor(() => {
      expect(screen.getByText('Reason (required)')).toBeTruthy()
    })
    fireEvent.changeText(
      screen.getByPlaceholderText('Why override the deterministic result?'),
      'Recruiter confirmed by phone.',
    )
    fireEvent.changeText(
      screen.getByPlaceholderText('What evidence supports this override?'),
      'Call notes attached to file.',
    )
    fireEvent.press(screen.getByText('Record override'))

    await waitFor(() => {
      expect(mockSubmitGateOverride).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-1',
          candidateId: 'cand-1',
          candidateRoleMatchId: 'match-1',
          gateResultId: 'gate-1',
          overrideResult: 'pass',
          reason: 'Recruiter confirmed by phone.',
          evidenceNote: 'Call notes attached to file.',
        }),
      )
    })
  })
})
