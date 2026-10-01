import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { MoreMenuScreen } from '@/screens/more/MoreMenuScreen'
import { createFakeSupabase, FAKE_USER } from '../test-utils/supabaseMock'

const mockSignOut = jest.fn()
jest.mock('@/lib/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: require('../test-utils/supabaseMock').FAKE_USER,
    session: null,
    loading: false,
    supabaseConfigured: true,
    signOut: mockSignOut,
  }),
}))

const mockGetSupabaseClient = jest.fn()
jest.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: () => mockGetSupabaseClient(),
}))

jest.mock('@/lib/cache/referenceCache', () => ({
  cacheMemberships: jest.fn().mockResolvedValue(undefined),
  readCachedMemberships: jest.fn().mockResolvedValue(null),
}))

function renderScreen() {
  const navigate = jest.fn()
  render(
    <MoreMenuScreen
      navigation={{ navigate } as never}
      route={{ key: 'MoreMenu', name: 'MoreMenu', params: undefined } as never}
    />,
  )
  return { navigate }
}

describe('MoreMenuScreen', () => {
  beforeEach(() => {
    mockGetSupabaseClient.mockReset()
    mockSignOut.mockReset()
  })

  it('renders the signed-in user, active organization, and role', async () => {
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({
        organization_memberships: {
          data: [
            {
              organization_id: 'org-1',
              role: 'agency_admin',
              status: 'active',
              is_default: true,
              organizations: { name: 'Acme Recruiting' },
            },
          ],
          error: null,
        },
      }),
    )

    renderScreen()

    await waitFor(() => {
      expect(screen.getByText(FAKE_USER.email as string)).toBeTruthy()
    })
    expect(screen.getByText('Acme Recruiting · Agency admin')).toBeTruthy()
  })

  it('navigates to notification preferences', async () => {
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({
        organization_memberships: { data: [], error: null },
      }),
    )

    const { navigate } = renderScreen()

    await waitFor(() => {
      expect(screen.getByText('No active organization')).toBeTruthy()
    })
    fireEvent.press(screen.getByText('Notification preferences'))
    expect(navigate).toHaveBeenCalledWith('NotificationPreferences')
  })
})
