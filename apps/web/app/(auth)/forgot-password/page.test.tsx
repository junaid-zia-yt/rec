import { describe, expect, it } from 'vitest'
import { render, screen } from '@rqi/testing'
import ForgotPasswordPage from './page'

/**
 * No live Supabase project is connected in this environment (`supabaseConfigured`
 * is false whenever NEXT_PUBLIC_SUPABASE_URL/ANON_KEY aren't set — true by
 * default in the test environment), so this page must render an honest
 * "not configured" state rather than a form that could never succeed.
 */
describe('ForgotPasswordPage (Supabase not configured)', () => {
  it('renders the not-configured state instead of a broken form', () => {
    render(<ForgotPasswordPage />)
    expect(screen.getByText(/authentication is not configured/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument()
  })
})
