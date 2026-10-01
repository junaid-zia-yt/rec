import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@rqi/testing'
import { DesktopNavRail } from './desktop-nav-rail'
import { desktopNav } from '@/lib/nav'

vi.mock('next/navigation', () => ({
  usePathname: () => '/candidates',
}))

describe('DesktopNavRail', () => {
  it('renders all 9 destinations in the required order', () => {
    render(<DesktopNavRail />)
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(desktopNav.length)
    links.forEach((link, i) => {
      expect(link).toHaveTextContent(desktopNav[i]!.label)
    })
  })

  it('marks the item matching the current route as the active page', () => {
    render(<DesktopNavRail />)
    const candidatesLink = screen.getByRole('link', { name: 'Candidate Pipeline' })
    expect(candidatesLink).toHaveAttribute('aria-current', 'page')

    const dashboardLink = screen.getByRole('link', { name: 'Dashboard' })
    expect(dashboardLink).not.toHaveAttribute('aria-current')
  })
})
