import { describe, expect, it } from 'vitest'
import { render, screen } from '@rqi/testing'

/**
 * Build Phase 17D Wave A. Same vi.resetModules-per-test convention as
 * non-production-banner.test.tsx, since DemoModeBanner reads
 * NEXT_PUBLIC_DEMO_MODE (lib/env.ts's demoModeEnabled) at import time.
 */
async function renderBannerWithEnv(demoMode: string | undefined) {
  vi.resetModules()
  const original = { ...process.env }
  if (demoMode === undefined) {
    delete process.env.NEXT_PUBLIC_DEMO_MODE
  } else {
    process.env.NEXT_PUBLIC_DEMO_MODE = demoMode
  }

  const { DemoModeBanner } = await import('./demo-mode-banner')
  render(<DemoModeBanner />)
  process.env = original
}

describe('DemoModeBanner', () => {
  it('renders nothing when NEXT_PUBLIC_DEMO_MODE is unset', async () => {
    await renderBannerWithEnv(undefined)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('renders nothing when NEXT_PUBLIC_DEMO_MODE is not exactly "true"', async () => {
    await renderBannerWithEnv('1')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('renders the exact required label when NEXT_PUBLIC_DEMO_MODE is true', async () => {
    await renderBannerWithEnv('true')
    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent('Private Demonstration — Sample Data')
  })
})
