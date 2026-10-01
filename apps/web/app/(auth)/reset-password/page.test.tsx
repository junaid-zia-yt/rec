import { describe, expect, it } from 'vitest'
import { render, screen } from '@rqi/testing'
import ResetPasswordPage from './page'

describe('ResetPasswordPage (Supabase not configured)', () => {
  it('renders the not-configured state instead of a broken form', () => {
    render(<ResetPasswordPage />)
    expect(screen.getByText(/authentication is not configured/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/new password/i)).not.toBeInTheDocument()
  })
})
