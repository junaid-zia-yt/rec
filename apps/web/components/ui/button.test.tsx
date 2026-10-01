import { describe, expect, it, vi } from 'vitest'
import { render, screen, userEvent } from '@rqi/testing'
import { Button, IconButton } from '@rqi/ui'
import { Bell } from 'lucide-react'

/**
 * Representative reusable-component test (Build Phase 1 brief §10) for the
 * @rqi/ui Button/IconButton primitives — exercised from apps/web since that
 * is the only workspace package with a Vitest/jsdom environment configured
 * in this phase.
 */
describe('Button', () => {
  it('renders as a native button and responds to clicks', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Continue</Button>)

    const button = screen.getByRole('button', { name: 'Continue' })
    await userEvent.click(button)

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('disables interaction while loading', () => {
    render(<Button loading>Submit</Button>)
    expect(screen.getByRole('button')).toBeDisabled()
  })
})

describe('IconButton', () => {
  it('requires an accessible label since it renders no visible text', () => {
    render(
      <IconButton label="Notifications">
        <Bell aria-hidden="true" />
      </IconButton>,
    )
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument()
  })
})
