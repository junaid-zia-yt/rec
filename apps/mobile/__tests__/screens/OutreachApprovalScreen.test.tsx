import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { OutreachApprovalScreen } from '@/screens/projects/OutreachApprovalScreen'
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

const mockApproveOutreachMessage = jest.fn()
jest.mock('@/lib/api/client', () => {
  const actual = jest.requireActual('@/lib/api/client')
  return {
    ...actual,
    approveOutreachMessage: (...args: unknown[]) => mockApproveOutreachMessage(...args),
  }
})

let mockOnline = true
jest.mock('@/lib/network/networkStatus', () => {
  const actual = jest.requireActual('@/lib/network/networkStatus')
  return { ...actual, useNetworkStatus: () => ({ online: mockOnline }) }
})

function renderScreen(candidateId = 'cand-1') {
  return render(
    <OutreachApprovalScreen
      navigation={{} as never}
      route={
        { key: 'OutreachApproval', name: 'OutreachApproval', params: { candidateId } } as never
      }
    />,
  )
}

const MESSAGE_ROW = {
  id: 'msg-1',
  channel: 'email',
  status: 'awaiting_approval',
  subject: 'Exciting Store Supervisor opportunity',
  draft_body: 'Hi Jamie, given your experience managing multi-unit teams...',
  generated_by: 'ai',
  edited_by_human: false,
  personalization_evidence: [{ excerpt: 'Managed a team of 12.' }],
}

describe('OutreachApprovalScreen', () => {
  beforeEach(() => {
    mockGetSupabaseClient.mockReset()
    mockApproveOutreachMessage.mockReset()
    mockOnline = true
  })

  it('renders the AI-drafted message and its evidence citations', async () => {
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({
        organization_memberships: FAKE_MEMBERSHIP_ROUTE,
        candidates: { data: { full_name: 'Jamie Rivera' }, error: null },
        outreach_messages: { data: MESSAGE_ROW, error: null },
      }),
    )

    renderScreen()

    await waitFor(() => {
      expect(screen.getByText('Jamie Rivera')).toBeTruthy()
    })
    expect(screen.getByText('AI-drafted')).toBeTruthy()
    expect(screen.getByText(/Managed a team of 12/)).toBeTruthy()
  })

  it('approves the draft and calls the API with the decision', async () => {
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({
        organization_memberships: FAKE_MEMBERSHIP_ROUTE,
        candidates: { data: { full_name: 'Jamie Rivera' }, error: null },
        outreach_messages: { data: MESSAGE_ROW, error: null },
      }),
    )
    mockApproveOutreachMessage.mockResolvedValue({ outreachMessageId: 'msg-1', status: 'approved' })

    renderScreen()

    await waitFor(() => {
      expect(screen.getByText('Approve')).toBeTruthy()
    })
    fireEvent.press(screen.getByText('Approve'))

    await waitFor(() => {
      expect(screen.getByText('Confirm approval')).toBeTruthy()
    })
    fireEvent.press(screen.getByText('Confirm'))

    await waitFor(() => {
      expect(mockApproveOutreachMessage).toHaveBeenCalledWith(
        'msg-1',
        expect.objectContaining({ organizationId: 'org-1', decision: 'approved' }),
      )
    })
  })

  it('refuses to submit an approval decision while offline, without calling the API', async () => {
    mockOnline = false
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({
        organization_memberships: FAKE_MEMBERSHIP_ROUTE,
        candidates: { data: { full_name: 'Jamie Rivera' }, error: null },
        outreach_messages: { data: MESSAGE_ROW, error: null },
      }),
    )

    renderScreen()

    await waitFor(() => {
      expect(screen.getByText('Approve')).toBeTruthy()
    })
    fireEvent.press(screen.getByText('Approve'))

    await waitFor(() => {
      expect(screen.getByText('Confirm approval')).toBeTruthy()
    })
    fireEvent.press(screen.getByText('Confirm'))

    await waitFor(() => {
      expect(screen.getByText("You're offline — try again when connected.")).toBeTruthy()
    })
    expect(mockApproveOutreachMessage).not.toHaveBeenCalled()
  })
})
