import { render, screen, waitFor } from '@testing-library/react-native'
import App from '../App'

/**
 * Smoke test: the root component renders past the font-loading gate and
 * lands on the Sign In screen. Supabase is unconfigured in the test
 * environment (no EXPO_PUBLIC_SUPABASE_URL/ANON_KEY), so the expected
 * landing state is NotConfiguredScreen, not the sign-in form itself —
 * asserting that distinction is the actual point of this test: the app
 * must render an honest "not configured" screen, never crash or silently
 * pretend Supabase is reachable.
 */
describe('App', () => {
  it('renders the not-configured screen when Supabase is unconfigured', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('App not configured')).toBeTruthy()
    })
  })
})
