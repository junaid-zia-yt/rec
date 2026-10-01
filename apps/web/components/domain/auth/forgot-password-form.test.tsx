import { describe, expect, it, vi } from 'vitest'
import { render, screen, userEvent } from '@rqi/testing'
import { ForgotPasswordForm } from './forgot-password-form'

const requestPasswordResetActionMock = vi.fn()
vi.mock('@/lib/auth/actions', () => ({
  requestPasswordResetAction: (...args: unknown[]) => requestPasswordResetActionMock(...args),
}))

describe('ForgotPasswordForm', () => {
  it('shows the same generic confirmation message regardless of whether the email is registered', async () => {
    requestPasswordResetActionMock.mockResolvedValue({
      success: true,
      message: "If an account exists for that email, we've sent a password reset link.",
    })
    const user = userEvent.setup()
    render(<ForgotPasswordForm />)

    await user.type(screen.getByLabelText(/email/i), 'maybe-not-real@example.com')
    await user.click(screen.getByRole('button', { name: /send reset link/i }))

    expect(
      await screen.findByText(
        "If an account exists for that email, we've sent a password reset link.",
      ),
    ).toBeInTheDocument()
  })

  it('hides the form after submission so the email field cannot be resubmitted to probe for existence', async () => {
    requestPasswordResetActionMock.mockResolvedValue({ success: true, message: 'Sent.' })
    const user = userEvent.setup()
    render(<ForgotPasswordForm />)

    await user.type(screen.getByLabelText(/email/i), 'a@example.com')
    await user.click(screen.getByRole('button', { name: /send reset link/i }))

    await screen.findByText('Sent.')
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument()
  })
})
