import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { TextInput } from 'react-native'
import { SignInScreen } from '../screens/auth/SignInScreen'

/** The submit button's label ("Sign in") also appears in the screen title,
 * so this always presses the LAST match — the actual submit button, which
 * always renders after the title in document order. */
function pressSubmit() {
  const matches = screen.getAllByText('Sign in')
  fireEvent.press(matches[matches.length - 1]!)
}

const mockClearSessionExpired = jest.fn()
let mockSessionExpired = false

jest.mock('@/lib/auth/AuthProvider', () => ({
  useAuth: () => ({
    session: null,
    user: null,
    loading: false,
    supabaseConfigured: true,
    signOut: jest.fn(),
    sessionExpired: mockSessionExpired,
    clearSessionExpired: mockClearSessionExpired,
  }),
}))

const mockSignInWithPassword = jest.fn()
jest.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: () => ({
    auth: { signInWithPassword: (args: unknown) => mockSignInWithPassword(args) },
  }),
}))

describe('SignInScreen', () => {
  beforeEach(() => {
    mockSessionExpired = false
    mockClearSessionExpired.mockClear()
    mockSignInWithPassword.mockReset()
  })

  it('renders email/password fields and a disabled submit button until both are filled', () => {
    render(<SignInScreen />)

    expect(screen.getAllByText('Sign in').length).toBeGreaterThan(0)
    expect(screen.getByText('Sign in to your recruitment workspace.')).toBeTruthy()
  })

  it('shows the "session expired" message when AuthProvider reports sessionExpired', () => {
    mockSessionExpired = true
    render(<SignInScreen />)

    expect(screen.getByText('Your session expired, please sign in again.')).toBeTruthy()
  })

  it('signs in successfully and surfaces no error message', async () => {
    mockSignInWithPassword.mockResolvedValue({ error: null })
    render(<SignInScreen />)

    const inputs = screen.UNSAFE_getAllByType(TextInput)
    fireEvent.changeText(inputs[0]!, 'reviewer@example.com')
    fireEvent.changeText(inputs[1]!, 'correct-password')
    pressSubmit()

    await waitFor(() => {
      expect(mockSignInWithPassword).toHaveBeenCalledWith({
        email: 'reviewer@example.com',
        password: 'correct-password',
      })
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('surfaces the wrong-password error returned by Supabase instead of swallowing it', async () => {
    mockSignInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } })
    render(<SignInScreen />)

    const inputs = screen.UNSAFE_getAllByType(TextInput)
    fireEvent.changeText(inputs[0]!, 'reviewer@example.com')
    fireEvent.changeText(inputs[1]!, 'wrong-password')
    pressSubmit()

    await waitFor(() => {
      expect(screen.getByText('Invalid login credentials')).toBeTruthy()
    })
  })

  it('clears a previously-set session-expired flag as soon as the user attempts to sign in again', async () => {
    mockSessionExpired = true
    mockSignInWithPassword.mockResolvedValue({ error: null })
    render(<SignInScreen />)

    const inputs = screen.UNSAFE_getAllByType(TextInput)
    fireEvent.changeText(inputs[0]!, 'reviewer@example.com')
    fireEvent.changeText(inputs[1]!, 'correct-password')
    pressSubmit()

    await waitFor(() => {
      expect(mockClearSessionExpired).toHaveBeenCalled()
    })
  })
})
