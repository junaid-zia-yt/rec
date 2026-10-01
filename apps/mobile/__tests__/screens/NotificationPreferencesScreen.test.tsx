import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { NotificationPreferencesScreen } from '@/screens/more/NotificationPreferencesScreen'
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

const mockUpdateNotificationPreference = jest.fn()
jest.mock('@/lib/api/client', () => {
  const actual = jest.requireActual('@/lib/api/client')
  return {
    ...actual,
    updateNotificationPreference: (...args: unknown[]) => mockUpdateNotificationPreference(...args),
  }
})

describe('NotificationPreferencesScreen', () => {
  beforeEach(() => {
    mockGetSupabaseClient.mockReset()
    mockUpdateNotificationPreference.mockReset()
  })

  it('renders all 8 event types with default in-app-on/email-off when no rows exist', async () => {
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({
        organization_memberships: FAKE_MEMBERSHIP_ROUTE,
        notification_preferences: { data: [], error: null },
      }),
    )

    render(<NotificationPreferencesScreen />)

    await waitFor(() => {
      expect(screen.getByText('Scorecard awaiting approval')).toBeTruthy()
    })
    expect(screen.getByText('Candidate awaiting review')).toBeTruthy()
    expect(screen.getByText('POC completed')).toBeTruthy()
  })

  it('toggles a preference and calls the PUT wrapper with the merged values', async () => {
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({
        organization_memberships: FAKE_MEMBERSHIP_ROUTE,
        notification_preferences: {
          data: [{ event_type: 'poc_completed', in_app_enabled: true, email_enabled: false }],
          error: null,
        },
      }),
    )
    mockUpdateNotificationPreference.mockResolvedValue({
      eventType: 'poc_completed',
      inAppEnabled: true,
      emailEnabled: true,
    })

    render(<NotificationPreferencesScreen />)

    await waitFor(() => {
      expect(screen.getByText('POC completed')).toBeTruthy()
    })

    const emailSwitch = screen.getByLabelText('Email notifications for POC completed')
    fireEvent(emailSwitch, 'valueChange', true)

    await waitFor(() => {
      expect(mockUpdateNotificationPreference).toHaveBeenCalledWith({
        organizationId: 'org-1',
        eventType: 'poc_completed',
        inAppEnabled: true,
        emailEnabled: true,
      })
    })
  })
})
