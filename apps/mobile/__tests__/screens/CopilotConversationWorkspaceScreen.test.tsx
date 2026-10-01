import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { CopilotConversationWorkspaceScreen } from '@/screens/home/CopilotConversationWorkspaceScreen'
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

const mockSendCopilotTurn = jest.fn()
jest.mock('@/lib/api/client', () => {
  const actual = jest.requireActual('@/lib/api/client')
  return { ...actual, sendCopilotTurn: (...args: unknown[]) => mockSendCopilotTurn(...args) }
})

let mockOnline = true
jest.mock('@/lib/network/networkStatus', () => {
  const actual = jest.requireActual('@/lib/network/networkStatus')
  return { ...actual, useNetworkStatus: () => ({ online: mockOnline }) }
})

function renderScreen(conversationId = 'conv-1') {
  return render(
    <CopilotConversationWorkspaceScreen
      navigation={{} as never}
      route={
        {
          key: 'CopilotConversationWorkspace',
          name: 'CopilotConversationWorkspace',
          params: { conversationId },
        } as never
      }
    />,
  )
}

describe('CopilotConversationWorkspaceScreen', () => {
  beforeEach(() => {
    mockGetSupabaseClient.mockReset()
    mockSendCopilotTurn.mockReset()
    mockOnline = true
  })

  it('shows an unavailable message for a role without copilot access', async () => {
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({
        organization_memberships: {
          data: [
            {
              organization_id: 'org-1',
              role: 'read_only_reviewer',
              status: 'active',
              is_default: true,
              client_id: null,
            },
          ],
          error: null,
        },
        copilot_messages: { data: [], error: null },
      }),
    )

    renderScreen()

    await waitFor(() => {
      expect(screen.getByText("Copilot isn't available for your role")).toBeTruthy()
    })
  })

  it('renders existing messages with citations shown as informational', async () => {
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({
        organization_memberships: FAKE_MEMBERSHIP_ROUTE,
        copilot_messages: {
          data: [
            {
              id: 'm1',
              role: 'user',
              content: 'What is the status of this candidate?',
              citations: [],
              sequence_number: 1,
            },
            {
              id: 'm2',
              role: 'assistant',
              content: 'They passed all mandatory gates.',
              citations: [{ kind: 'candidate_role_match', id: 'crm-1', excerpt: 'Gate: pass' }],
              sequence_number: 2,
            },
          ],
          error: null,
        },
      }),
    )

    renderScreen()

    await waitFor(() => {
      expect(screen.getByText('They passed all mandatory gates.')).toBeTruthy()
    })
    expect(screen.getByText('Cited (informational only, not a decision):')).toBeTruthy()
    expect(screen.getByText('• Gate: pass')).toBeTruthy()
  })

  it('sends a message and renders the successful reply', async () => {
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({
        organization_memberships: FAKE_MEMBERSHIP_ROUTE,
        copilot_messages: { data: [], error: null },
      }),
    )
    mockSendCopilotTurn.mockResolvedValue({
      success: true,
      data: {
        status: 'success',
        conversationId: 'conv-1',
        messageId: 'm3',
        text: 'Here is a summary.',
        citations: [],
        citationsCaveatApplied: false,
        unsupportedClaimsStripped: false,
        model: 'test-model',
      },
    })

    renderScreen()

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Ask the copilot…')).toBeTruthy()
    })
    fireEvent.changeText(
      screen.getByPlaceholderText('Ask the copilot…'),
      'Summarize this candidate',
    )
    fireEvent.press(screen.getByText('Send'))

    await waitFor(() => {
      expect(screen.getByText('Here is a summary.')).toBeTruthy()
    })
    expect(mockSendCopilotTurn).toHaveBeenCalledWith({
      organizationId: 'org-1',
      conversationId: 'conv-1',
      message: 'Summarize this candidate',
    })
  })

  it.each([
    ['not_configured', "This assistant isn't configured in this environment."],
    [
      'permission_narrowed_since_conversation_start',
      'Your permissions have changed since this conversation started, so this request could not be completed.',
    ],
    ['rate_limited', "You're sending messages too quickly. Wait a moment and try again."],
    ['timeout', 'The assistant took too long to respond.'],
    ['provider_error', 'The assistant is temporarily unavailable.'],
    ['cancelled', 'That request was cancelled.'],
    ['validation_rejected', "That message couldn't be sent — check it and try again."],
    [
      'unauthorized_tool_attempt',
      'The assistant attempted an action it is not authorized to take, so the request was blocked.',
    ],
  ])('shows a clear message for the %s outcome', async (status, expectedText) => {
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({
        organization_memberships: FAKE_MEMBERSHIP_ROUTE,
        copilot_messages: { data: [], error: null },
      }),
    )
    mockSendCopilotTurn.mockResolvedValue({
      success: false,
      data: { status, conversationId: 'conv-1', message: 'server detail' },
    })

    renderScreen()

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Ask the copilot…')).toBeTruthy()
    })
    fireEvent.changeText(screen.getByPlaceholderText('Ask the copilot…'), 'Hello')
    fireEvent.press(screen.getByText('Send'))

    await waitFor(() => {
      expect(screen.getByText(expectedText)).toBeTruthy()
    })
  })

  it('disables sending while offline', async () => {
    mockOnline = false
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({
        organization_memberships: FAKE_MEMBERSHIP_ROUTE,
        copilot_messages: { data: [], error: null },
      }),
    )

    renderScreen()

    await waitFor(() => {
      expect(screen.getByText(/You.*re offline/)).toBeTruthy()
    })
    fireEvent.changeText(screen.getByPlaceholderText('Ask the copilot…'), 'Hello')
    fireEvent.press(screen.getByText('Send'))

    expect(mockSendCopilotTurn).not.toHaveBeenCalled()
  })
})
