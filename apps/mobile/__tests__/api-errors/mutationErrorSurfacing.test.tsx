import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { CandidateEvaluationScreen } from '@/screens/pipeline/CandidateEvaluationScreen'
import { OutreachApprovalScreen } from '@/screens/projects/OutreachApprovalScreen'
import { FinalShortlistScreen } from '@/screens/shortlists/FinalShortlistScreen'
import { ApiNetworkError, ApiResponseError } from '@/lib/api/client'
import { createFakeSupabase, FAKE_MEMBERSHIP_ROUTE } from '../test-utils/supabaseMock'

/**
 * API error tests (brief category 4): a non-2xx `{success:false,error}`
 * mutation response must surface the SERVER's own message, not a generic
 * "something went wrong" — and a thrown network error must be routed to
 * the same offline/network-error copy Wave 5 already built (never a raw
 * stack trace or a silent failure). Covers 3 mutation screens.
 */

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
const mockApproveOutreachMessage = jest.fn()
const mockApproveShortlistInternally = jest.fn()
jest.mock('@/lib/api/client', () => {
  const actual = jest.requireActual('@/lib/api/client')
  return {
    ...actual,
    submitGateOverride: (...args: unknown[]) => mockSubmitGateOverride(...args),
    approveOutreachMessage: (...args: unknown[]) => mockApproveOutreachMessage(...args),
    approveShortlistInternally: (...args: unknown[]) => mockApproveShortlistInternally(...args),
  }
})

beforeEach(() => {
  mockGetSupabaseClient.mockReset()
  mockSubmitGateOverride.mockReset()
  mockApproveOutreachMessage.mockReset()
  mockApproveShortlistInternally.mockReset()
})

describe('CandidateEvaluationScreen — gate override error surfacing', () => {
  const MATCH_ROW = {
    id: 'match-1',
    job_id: 'job-1',
    latest_matching_run_id: 'run-1',
    eligibility: 'ineligible',
    overall_score: 40,
    evidence_coverage_pct: 50,
    data_completeness_pct: 60,
    confidence: 0.5,
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

  function setupAndOpenOverride() {
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({
        organization_memberships: FAKE_MEMBERSHIP_ROUTE,
        candidates: { data: { full_name: 'Jamie Rivera' }, error: null },
        candidate_role_matches: { data: [MATCH_ROW], error: null },
        mandatory_gate_results: { data: [GATE_ROW], error: null },
      }),
    )
    return render(
      <CandidateEvaluationScreen
        navigation={{} as never}
        route={
          {
            key: 'CandidateEvaluation',
            name: 'CandidateEvaluation',
            params: { candidateId: 'cand-1' },
          } as never
        }
      />,
    )
  }

  it('surfaces the server-provided error message from a non-2xx gate-override response', async () => {
    mockSubmitGateOverride.mockRejectedValue(
      new ApiResponseError(409, { error: 'Another reviewer already overrode this gate.' }),
    )
    setupAndOpenOverride()

    await waitFor(() => expect(screen.getByText('Override')).toBeTruthy())
    fireEvent.press(screen.getByText('Override'))
    await waitFor(() => expect(screen.getByText('Reason (required)')).toBeTruthy())
    fireEvent.changeText(
      screen.getByPlaceholderText('Why override the deterministic result?'),
      'Confirmed by phone.',
    )
    fireEvent.changeText(
      screen.getByPlaceholderText('What evidence supports this override?'),
      'Call notes attached.',
    )
    fireEvent.press(screen.getByText('Record override'))

    await waitFor(() => {
      expect(screen.getByText('Another reviewer already overrode this gate.')).toBeTruthy()
    })
  })
})

describe('OutreachApprovalScreen — decision error surfacing', () => {
  const MESSAGE_ROW = {
    id: 'msg-1',
    channel: 'email',
    status: 'awaiting_approval',
    subject: 'Exciting opportunity',
    draft_body: 'Hi Jamie...',
    generated_by: 'ai',
    edited_by_human: false,
    personalization_evidence: [{ excerpt: 'Managed a team of 12.' }],
  }

  function setupAndOpenApprove() {
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({
        organization_memberships: FAKE_MEMBERSHIP_ROUTE,
        candidates: { data: { full_name: 'Jamie Rivera' }, error: null },
        outreach_messages: { data: MESSAGE_ROW, error: null },
      }),
    )
    return render(
      <OutreachApprovalScreen
        navigation={{} as never}
        route={
          {
            key: 'OutreachApproval',
            name: 'OutreachApproval',
            params: { candidateId: 'cand-1' },
          } as never
        }
      />,
    )
  }

  it('surfaces the server-provided error message from a non-2xx approval response', async () => {
    mockApproveOutreachMessage.mockRejectedValue(
      new ApiResponseError(422, { error: 'This message was already sent to the candidate.' }),
    )
    setupAndOpenApprove()

    await waitFor(() => expect(screen.getByText('Approve')).toBeTruthy())
    fireEvent.press(screen.getByText('Approve'))
    await waitFor(() => expect(screen.getByText('Confirm approval')).toBeTruthy())
    fireEvent.press(screen.getByText('Confirm'))

    await waitFor(() => {
      expect(screen.getByText('This message was already sent to the candidate.')).toBeTruthy()
    })
  })

  it('routes a thrown network error to the shared offline-retry message, not a raw error', async () => {
    mockApproveOutreachMessage.mockRejectedValue(new ApiNetworkError(new Error('Failed to fetch')))
    setupAndOpenApprove()

    await waitFor(() => expect(screen.getByText('Approve')).toBeTruthy())
    fireEvent.press(screen.getByText('Approve'))
    await waitFor(() => expect(screen.getByText('Confirm approval')).toBeTruthy())
    fireEvent.press(screen.getByText('Confirm'))

    await waitFor(() => {
      expect(screen.getByText("You're offline — try again when connected.")).toBeTruthy()
    })
  })
})

describe('FinalShortlistScreen — internal-approval error surfacing', () => {
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

  it('surfaces the server-provided error message when internal approval fails', async () => {
    mockGetSupabaseClient.mockReturnValue(createFakeSupabase(ROUTES))
    mockApproveShortlistInternally.mockRejectedValue(
      new ApiResponseError(400, { error: 'Shortlist exceeds the maximum candidate count.' }),
    )

    render(
      <FinalShortlistScreen
        navigation={{} as never}
        route={
          {
            key: 'FinalShortlist',
            name: 'FinalShortlist',
            params: { shortlistId: 'sl-1' },
          } as never
        }
      />,
    )

    await waitFor(() => expect(screen.getByText('Record internal approval')).toBeTruthy())
    fireEvent.press(screen.getByText('Record internal approval'))
    await waitFor(() => expect(screen.getByText('Confirm internal approval')).toBeTruthy())
    fireEvent.press(screen.getByText('Confirm approval'))

    await waitFor(() => {
      expect(screen.getByText('Shortlist exceeds the maximum candidate count.')).toBeTruthy()
    })
  })
})
