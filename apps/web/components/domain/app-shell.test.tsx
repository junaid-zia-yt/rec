import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@rqi/testing'
import { AppShell } from './app-shell'

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
}))

describe('AppShell', () => {
  it('renders the header, primary navigation landmarks, and page content', () => {
    render(
      <AppShell>
        <p>page content</p>
      </AppShell>,
    )

    expect(screen.getByRole('banner')).toBeInTheDocument()
    // Two <nav aria-label="Primary"> landmarks: desktop rail + mobile bottom nav.
    expect(screen.getAllByRole('navigation', { name: 'Primary' })).toHaveLength(2)
    expect(screen.getByText('page content')).toBeInTheDocument()
  })

  it('shows the product identity and demo workspace badge', () => {
    render(
      <AppShell>
        <p>content</p>
      </AppShell>,
    )

    expect(screen.getByText('Recruitment Quality Intelligence')).toBeInTheDocument()
    expect(screen.getByText('Demo workspace')).toBeInTheDocument()
  })
})
