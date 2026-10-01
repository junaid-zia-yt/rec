import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { CandidateEvaluationScreen } from '@/screens/pipeline/CandidateEvaluationScreen'
import { NotificationsScreen } from '@/screens/home/NotificationsScreen'
import { OutreachApprovalScreen } from '@/screens/projects/OutreachApprovalScreen'
import { ApiNetworkError } from '@/lib/api/client'
import { createFakeSupabase, FAKE_MEMBERSHIP_ROUTE } from '../test-utils/supabaseMock'

/**
 * Core mobile journeys (brief category 6): 2-3 short flows stitching
 * already-unit-tested pieces together at a slightly higher level than the
 * existing per-screen tests. These are practical, scoped versions — a true
 * multi-SCREEN flow (e.g. navigating from one real screen component to
 * another inside a single test) is not exercised here because these
 * screens are wired together only through React Navigation params at
 * runtime, not through direct component composition; each journey below
 * instead drives one screen through a complete, realistic multi-step user
 * interaction (not just a single assertion), which is the practical
 * substitute the task brief allows for ("a slightly less ambitious version
 * ... use your judgment").
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
const mockMarkNotificationRead = jest.fn()
jest.mock('@/lib/api/client', () => {
  const actual = jest.requireActual('@/lib/api/client')
  return {
    ...actual,
    submitGateOverride: (...args: unknown[]) => mockSubmitGateOverride(...args),
    approveOutreachMessage: (...args: unknown[]) => mockApproveOutreachMessage(...args),
    markNotificationRead: (...args: unknown[]) => mockMarkNotificationRead(...args),
    markAllNotificationsRead: jest.fn(),
  }
})

let mockOnline = true
jest.mock('@/lib/network/networkStatus', () => {
  const actual = jest.requireActual('@/lib/network/networkStatus')
  return { ...actual, useNetworkStatus: () => ({ online: mockOnline }) }
})

beforeEach(() => {
  mockGetSupabaseClient.mockReset()
  mockSubmitGateOverride.mockReset()
  mockApproveOutreachMessage.mockReset()
  mockMarkNotificationRead.mockReset()
  mockOnline = true
})

describe('Journey 1 — recruiter reviews a failed gate, overrides it, and sees the updated eligibility', () => {
  it('walks the full override flow end to end, including the post-submit refresh reflecting the override', async () => {
    const MATCH_ROW_BEFORE = {
      id: 'match-1',
      job_id: 'job-1',
      latest_matching_run_id: 'run-1',
      eligibility: 'ineligible',
      overall_score: null,
      evidence_coverage_pct: 70,
      data_completeness_pct: 80,
      confidence: 0.6,
      review_status: 'pending',
      jobs: { title: 'Store Supervisor' },
    }
    const MATCH_ROW_AFTER = { ...MATCH_ROW_BEFORE, eligibility: 'eligible', overall_score: 76 }
    const GATE_ROW_BEFORE = {
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
    const GATE_ROW_AFTER = {
      ...GATE_ROW_BEFORE,
      state: 'human_override',
      override_result: 'pass',
      override_reason: 'Confirmed by phone.',
    }

    let matchCall = 0
    let gateCall = 0
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({
        organization_memberships: FAKE_MEMBERSHIP_ROUTE,
        candidates: { data: { full_name: 'Jamie Rivera' }, error: null },
        candidate_role_matches: () => {
          matchCall += 1
          return { data: [matchCall === 1 ? MATCH_ROW_BEFORE : MATCH_ROW_AFTER], error: null }
        },
        mandatory_gate_results: () => {
          gateCall += 1
          return { data: [gateCall === 1 ? GATE_ROW_BEFORE : GATE_ROW_AFTER], error: null }
        },
      }),
    )
    mockSubmitGateOverride.mockResolvedValue({
      gateResultId: 'gate-1',
      eligibility: 'eligible',
      overallScore: 76,
    })

    render(
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

    // 1. Recruiter sees the candidate is currently ineligible with an unresolved gate.
    await waitFor(() => expect(screen.getByText('Jamie Rivera')).toBeTruthy())
    expect(screen.getByText('ineligible')).toBeTruthy()
    expect(screen.getByText('Valid driver license')).toBeTruthy()

    // 2. Opens the override sheet.
    fireEvent.press(screen.getByText('Override'))
    await waitFor(() => expect(screen.getByText('Reason (required)')).toBeTruthy())

    // 3. Enters a reason and evidence, submits.
    fireEvent.changeText(
      screen.getByPlaceholderText('Why override the deterministic result?'),
      'Confirmed by phone.',
    )
    fireEvent.changeText(
      screen.getByPlaceholderText('What evidence supports this override?'),
      'Call notes attached to file.',
    )
    fireEvent.press(screen.getByText('Record override'))

    await waitFor(() => {
      expect(mockSubmitGateOverride).toHaveBeenCalledWith(
        expect.objectContaining({
          gateResultId: 'gate-1',
          overrideResult: 'pass',
          reason: 'Confirmed by phone.',
        }),
      )
    })

    // 4. The screen refetches, and the candidate's eligibility/gate state
    //    now reflect the override — the whole point of a human-in-the-loop
    //    review, not just an API call succeeding.
    await waitFor(() => {
      expect(screen.getByText('eligible')).toBeTruthy()
    })
    expect(screen.queryByText('Override')).toBeNull() // gate is now human_override, no longer overridable again
  })
})

describe('Journey 2 — outreach approval recovers from an offline failure once connectivity returns', () => {
  it('blocks the approval while offline, then succeeds on retry once back online', async () => {
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
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({
        organization_memberships: FAKE_MEMBERSHIP_ROUTE,
        candidates: { data: { full_name: 'Jamie Rivera' }, error: null },
        outreach_messages: { data: MESSAGE_ROW, error: null },
      }),
    )
    mockApproveOutreachMessage.mockRejectedValueOnce(new ApiNetworkError(new Error('offline')))
    mockApproveOutreachMessage.mockResolvedValueOnce({
      outreachMessageId: 'msg-1',
      status: 'approved',
    })

    render(
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
    await waitFor(() => expect(screen.getByText('Approve')).toBeTruthy())

    // 1. Recruiter tries to approve while genuinely offline (the online flag
    //    itself is false) — the screen refuses client-side, no API call.
    mockOnline = false
    fireEvent.press(screen.getByText('Approve'))
    await waitFor(() => expect(screen.getByText('Confirm approval')).toBeTruthy())
    fireEvent.press(screen.getByText('Confirm'))
    await waitFor(() => {
      expect(screen.getByText("You're offline — try again when connected.")).toBeTruthy()
    })
    expect(mockApproveOutreachMessage).not.toHaveBeenCalled()

    // 2. Connectivity returns. Re-opening the decision sheet forces the
    //    screen to re-render and pick up the fresh `online` value (the
    //    mocked useNetworkStatus hook has no internal subscription of its
    //    own to react to `mockOnline` changing outside of React) — the same
    //    "tap Approve again" action a real recruiter would take after
    //    seeing the offline message and getting connectivity back.
    mockOnline = true
    fireEvent.press(screen.getByText('Approve'))
    await waitFor(() => expect(screen.getByText('Confirm approval')).toBeTruthy())
    fireEvent.press(screen.getByText('Confirm'))
    await waitFor(() => {
      expect(mockApproveOutreachMessage).toHaveBeenCalledWith(
        'msg-1',
        expect.objectContaining({ decision: 'approved' }),
      )
    })
  })
})

describe('Journey 3 — a recruiter reads a notification and it navigates to the resolved deep-link target', () => {
  it('marks the notification read, resolves its target via the REAL resolver (not mocked), and navigates there', async () => {
    const NOTIFICATION_ROWS = [
      {
        id: 'notif-1',
        event_type: 'outreach_awaiting_approval',
        title: 'Outreach draft ready',
        body: 'A draft outreach message is awaiting your approval.',
        resource_type: 'outreach_message',
        resource_id: 'msg-1',
        read_at: null,
        created_at: '2026-09-20T10:00:00Z',
      },
    ]
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({
        organization_memberships: FAKE_MEMBERSHIP_ROUTE,
        notifications: { data: NOTIFICATION_ROWS, error: null },
        // Real resolveNotificationDeepLink (not mocked in this file) looks
        // this table up to resolve the outreach_message -> candidate hop.
        outreach_messages: { data: { candidate_id: 'cand-9' }, error: null },
      }),
    )
    mockMarkNotificationRead.mockResolvedValue({ notificationId: 'notif-1', alreadyRead: false })

    const navigate = jest.fn()
    const navigation = { getParent: () => ({ navigate }) } as never
    render(
      <NotificationsScreen
        navigation={navigation}
        route={{ key: 'Notifications', name: 'Notifications', params: undefined } as never}
      />,
    )

    await waitFor(() => expect(screen.getByText('Outreach draft ready')).toBeTruthy())
    fireEvent.press(screen.getByText('Outreach draft ready'))

    await waitFor(() => {
      expect(mockMarkNotificationRead).toHaveBeenCalledWith('notif-1', 'org-1')
    })
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('ProjectsTab', {
        screen: 'OutreachApproval',
        params: { candidateId: 'cand-9' },
      })
    })
  })
})
