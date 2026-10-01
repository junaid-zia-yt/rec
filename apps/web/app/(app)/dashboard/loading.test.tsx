import { describe, expect, it } from 'vitest'
import { render, screen } from '@rqi/testing'
import DashboardLoading from './loading'

describe('DashboardLoading', () => {
  it('exposes an accessible loading status while the route streams in', () => {
    render(<DashboardLoading />)
    expect(screen.getByLabelText('Loading dashboard')).toBeInTheDocument()
    // LoadingSkeleton renders role="status" for each block.
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0)
  })
})
