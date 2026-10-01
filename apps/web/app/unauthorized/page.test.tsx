import { describe, expect, it } from 'vitest'
import { render, screen } from '@rqi/testing'
import UnauthorizedPage from './page'

describe('UnauthorizedPage', () => {
  it('renders a generic message that does not describe what would have been visible', () => {
    render(<UnauthorizedPage />)
    expect(screen.getByRole('heading', { name: /you don't have access/i })).toBeInTheDocument()
    const body = screen.getByText(/ask your organization admin/i)
    expect(body.textContent).not.toMatch(/candidate|score|salary|client/i)
  })

  it('offers a way back to the app', () => {
    render(<UnauthorizedPage />)
    expect(screen.getByRole('link', { name: /back to dashboard/i })).toHaveAttribute(
      'href',
      '/dashboard',
    )
  })
})
