import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@rqi/testing'
import { MobileBottomNav } from './mobile-bottom-nav'
import { mobileNav } from '@/lib/nav'

vi.mock('next/navigation', () => ({
  usePathname: () => '/shortlists',
}))

describe('MobileBottomNav', () => {
  it('renders exactly the 5 required destinations', () => {
    render(<MobileBottomNav />)
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(5)
    expect(mobileNav.map((item) => item.label)).toEqual([
      'Home',
      'Projects',
      'Candidates',
      'Shortlists',
      'More',
    ])
  })

  it('marks the current route active and leaves the rest inactive', () => {
    render(<MobileBottomNav />)
    expect(screen.getByRole('link', { name: /Shortlists/i })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('link', { name: /Home/i })).not.toHaveAttribute('aria-current')
  })

  it('gives every destination a touch-safe minimum height', () => {
    render(<MobileBottomNav />)
    screen.getAllByRole('link').forEach((link) => {
      expect(link.className).toMatch(/min-h-12/)
    })
  })
})
