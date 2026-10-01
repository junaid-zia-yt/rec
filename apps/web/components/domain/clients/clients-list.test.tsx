import { describe, expect, it } from 'vitest'
import { render, screen, userEvent } from '@rqi/testing'
import { ClientsList } from './clients-list'
import type { Client } from '@rqi/types'

const client = (over: Partial<Client> = {}): Client => ({
  id: 'client-1',
  organizationId: 'org-1',
  name: 'Northfield Retail Group',
  vertical: 'Retail',
  primaryContactName: null,
  primaryContactEmail: null,
  primaryContactPhone: null,
  status: 'active',
  createdAt: '2026-09-01T00:00:00.000Z',
  ...over,
})

describe('ClientsList — Build Phase 3 brief §"Search and filter clients"', () => {
  it('renders the genuine empty state when there are no clients at all', () => {
    render(<ClientsList clients={[]} />)
    expect(screen.getByText('No clients yet')).toBeInTheDocument()
  })

  it('narrows the list by a search query matching name or vertical', async () => {
    const user = userEvent.setup()
    render(
      <ClientsList
        clients={[
          client({ id: 'client-1', name: 'Northfield Retail Group', vertical: 'Retail' }),
          client({ id: 'client-2', name: 'Harborline Food Service', vertical: 'Food Service' }),
        ]}
      />,
    )

    await user.type(screen.getByLabelText(/search clients/i), 'harborline')

    expect(screen.queryByText('Northfield Retail Group')).not.toBeInTheDocument()
    expect(screen.getByText('Harborline Food Service')).toBeInTheDocument()
  })

  it('shows a distinct "no matches" empty state (not the "no clients yet" one) when a search yields nothing', async () => {
    const user = userEvent.setup()
    render(<ClientsList clients={[client()]} />)

    await user.type(screen.getByLabelText(/search clients/i), 'zzz-no-match')

    expect(screen.getByText('No clients match your search')).toBeInTheDocument()
  })

  it('an archived client is visible (list shows both statuses by default, filterable) and labeled Archived', () => {
    render(<ClientsList clients={[client({ status: 'inactive' })]} />)
    expect(screen.getByText('Archived')).toBeInTheDocument()
  })
})
