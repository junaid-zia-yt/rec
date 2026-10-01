import { describe, expect, it, vi } from 'vitest'
import { render, screen, userEvent } from '@rqi/testing'
import { SignInForm } from './sign-in-form'

const signInActionMock = vi.fn()
vi.mock('@/lib/auth/actions', () => ({
  signInAction: (...args: unknown[]) => signInActionMock(...args),
}))

describe('SignInForm', () => {
  it('renders labeled, required email and password fields', () => {
    render(<SignInForm />)
    expect(screen.getByLabelText(/email/i)).toBeRequired()
    expect(screen.getByLabelText(/password/i)).toBeRequired()
    expect(screen.getByLabelText(/password/i)).toHaveAttribute('type', 'password')
  })

  it('shows a generic error message on failure, never one that confirms whether the email exists', async () => {
    signInActionMock.mockResolvedValueOnce({
      success: false,
      message: 'Incorrect email or password.',
    })
    const user = userEvent.setup()
    render(<SignInForm />)

    await user.type(screen.getByLabelText(/email/i), 'nobody@example.com')
    await user.type(screen.getByLabelText(/password/i), 'wrong-password')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Incorrect email or password.')
    expect(alert.textContent).not.toMatch(/no account|not found|does not exist/i)
  })

  it('carries a next path through as a hidden field, for post-sign-in redirect', () => {
    render(<SignInForm next="/candidates/cand-1" />)
    const hidden = document.querySelector('input[type="hidden"][name="next"]') as HTMLInputElement
    expect(hidden.value).toBe('/candidates/cand-1')
  })
})
