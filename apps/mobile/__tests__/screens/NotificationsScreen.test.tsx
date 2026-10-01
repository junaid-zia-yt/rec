import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { NotificationsScreen } from '@/screens/home/NotificationsScreen'
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

const mockMarkNotificationRead = jest.fn()
const mockMarkAllNotificationsRead = jest.fn()
jest.mock('@/lib/api/client', () => {
  const actual = jest.requireActual('@/lib/api/client')
  return {
    ...actual,
    markNotificationRead: (...args: unknown[]) => mockMarkNotificationRead(...args),
    markAllNotificationsRead: (...args: unknown[]) => mockMarkAllNotificationsRead(...args),
  }
})

const mockResolveNotificationDeepLink = jest.fn()
jest.mock('@/lib/notifications/resolveDeepLink', () => ({
  resolveNotificationDeepLink: (...args: unknown[]) => mockResolveNotificationDeepLink(...args),
}))

function renderScreen() {
  const navigate = jest.fn()
  const navigation = { getParent: () => ({ navigate }) } as never
  render(
    <NotificationsScreen
      navigation={navigation}
      route={{ key: 'Notifications', name: 'Notifications', params: undefined } as never}
    />,
  )
  return { navigate }
}

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
  {
    id: 'notif-2',
    event_type: 'poc_completed',
    title: 'POC finished',
    body: null,
    resource_type: 'poc_benchmark',
    resource_id: 'poc-1',
    read_at: '2026-09-19T10:00:00Z',
    created_at: '2026-09-19T09:00:00Z',
  },
]

describe('NotificationsScreen', () => {
  beforeEach(() => {
    mockGetSupabaseClient.mockReset()
    mockMarkNotificationRead.mockReset()
    mockMarkAllNotificationsRead.mockReset()
    mockResolveNotificationDeepLink.mockReset()
  })

  it('renders notifications with a readable event label and unread indicator', async () => {
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({
        organization_memberships: FAKE_MEMBERSHIP_ROUTE,
        notifications: { data: NOTIFICATION_ROWS, error: null },
      }),
    )

    renderScreen()

    await waitFor(() => {
      expect(screen.getByText('Outreach draft ready')).toBeTruthy()
    })
    expect(screen.getByText('Outreach awaiting approval')).toBeTruthy()
    expect(screen.getByText('POC completed')).toBeTruthy()
    expect(screen.getByText('1 unread')).toBeTruthy()
  })

  it('marks a notification read and navigates to its resolved deep link on tap', async () => {
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({
        organization_memberships: FAKE_MEMBERSHIP_ROUTE,
        notifications: { data: NOTIFICATION_ROWS, error: null },
      }),
    )
    mockMarkNotificationRead.mockResolvedValue({ notificationId: 'notif-1', alreadyRead: false })
    mockResolveNotificationDeepLink.mockResolvedValue({
      tab: 'ProjectsTab',
      screen: 'OutreachApproval',
      params: { candidateId: 'cand-1' },
    })

    const { navigate } = renderScreen()

    await waitFor(() => {
      expect(screen.getByText('Outreach draft ready')).toBeTruthy()
    })
    fireEvent.press(screen.getByText('Outreach draft ready'))

    await waitFor(() => {
      expect(mockMarkNotificationRead).toHaveBeenCalledWith('notif-1', 'org-1')
    })
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('ProjectsTab', {
        screen: 'OutreachApproval',
        params: { candidateId: 'cand-1' },
      })
    })
  })

  it('marks all notifications read via the API wrapper', async () => {
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({
        organization_memberships: FAKE_MEMBERSHIP_ROUTE,
        notifications: { data: NOTIFICATION_ROWS, error: null },
      }),
    )
    mockMarkAllNotificationsRead.mockResolvedValue({ markedCount: 1, attempted: 1 })

    renderScreen()

    await waitFor(() => {
      expect(screen.getByText('Mark all read')).toBeTruthy()
    })
    fireEvent.press(screen.getByText('Mark all read'))

    await waitFor(() => {
      expect(mockMarkAllNotificationsRead).toHaveBeenCalledWith('org-1')
    })
  })
})
