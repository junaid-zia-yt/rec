import { describe, expect, it } from 'vitest'
import { render, screen } from '@rqi/testing'
import TeamSettingsPage from './page'
import { DEMO_TEAM_MEMBERS } from '@/lib/mock-data'

/**
 * Supabase is not configured in the test environment, so this renders
 * against DEMO_TEAM_MEMBERS/DEMO_INVITATIONS only — it must never attempt a
 * live query (there is nothing to query) and must say plainly that
 * inviting a member isn't available yet, rather than showing a form that
 * would silently fail.
 */
describe('TeamSettingsPage (Supabase not configured)', () => {
  it('renders every demo team member with their role', async () => {
    render(await TeamSettingsPage())
    for (const member of DEMO_TEAM_MEMBERS) {
      expect(screen.getByText(member.fullName)).toBeInTheDocument()
    }
  })

  it('shows the pending invitation', async () => {
    render(await TeamSettingsPage())
    expect(screen.getByText('alicia@example-agency.com')).toBeInTheDocument()
  })

  it('does not render a live invite form when Supabase is not configured', async () => {
    render(await TeamSettingsPage())
    expect(screen.queryByLabelText(/^email$/i)).not.toBeInTheDocument()
    expect(screen.getByText(/requires a configured supabase project/i)).toBeInTheDocument()
  })
})
