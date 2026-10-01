import { render, screen, waitFor } from '@testing-library/react-native'
import { PocComparisonScreen } from '@/screens/shortlists/PocComparisonScreen'
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

function renderScreen() {
  return render(
    <PocComparisonScreen
      navigation={{} as never}
      route={{ key: 'PocComparison', name: 'PocComparison', params: {} } as never}
    />,
  )
}

describe('PocComparisonScreen', () => {
  beforeEach(() => {
    mockGetSupabaseClient.mockReset()
  })

  it('renders the vendor vs. client comparison with the causation disclaimer', async () => {
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({
        organization_memberships: FAKE_MEMBERSHIP_ROUTE,
        poc_benchmarks: {
          data: [
            { id: 'poc-1', name: 'Q3 Store Supervisor POC', clients: { name: 'Acme Retail' } },
          ],
          error: null,
        },
        poc_results: {
          data: [
            {
              metric_definition_id: 'metric-1',
              side: 'vendor',
              status: 'computed',
              value: 92,
              value_unit: 'percent',
              poc_roles: { label: null, role_type: 'standard' },
              metric_definitions: { name: 'Mandatory-Gate Pass Rate' },
            },
            {
              metric_definition_id: 'metric-1',
              side: 'client',
              status: 'computed',
              value: 74,
              value_unit: 'percent',
              poc_roles: { label: null, role_type: 'standard' },
              metric_definitions: { name: 'Mandatory-Gate Pass Rate' },
            },
          ],
          error: null,
        },
      }),
    )

    renderScreen()

    await waitFor(() => {
      expect(screen.getByText('Mandatory-Gate Pass Rate')).toBeTruthy()
    })
    expect(screen.getByText('92%')).toBeTruthy()
    expect(screen.getByText('74%')).toBeTruthy()
    expect(screen.getByText(/not a proven cause/)).toBeTruthy()
  })
})
