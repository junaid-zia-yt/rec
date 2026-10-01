import { describe, expect, it } from 'vitest'
import { render, screen } from '@rqi/testing'

/**
 * Build Phase 15 Wave 2. Each test re-imports the component fresh
 * (vi.resetModules) since it reads NEXT_PUBLIC_ENVIRONMENT_NAME from
 * lib/env.ts at import time, same convention as lib/env.test.ts.
 */
async function renderBannerWithEnv(environmentName: string | undefined) {
  vi.resetModules()
  const original = { ...process.env }
  if (environmentName === undefined) {
    delete process.env.NEXT_PUBLIC_ENVIRONMENT_NAME
  } else {
    process.env.NEXT_PUBLIC_ENVIRONMENT_NAME = environmentName
  }
  delete process.env.NEXT_PUBLIC_BUILD_SHA
  delete process.env.NEXT_PUBLIC_RELEASE_TAG

  const { NonProductionBanner } = await import('./non-production-banner')
  render(<NonProductionBanner />)
  process.env = original
}

describe('NonProductionBanner', () => {
  it('renders nothing when NEXT_PUBLIC_ENVIRONMENT_NAME is unset (local dev)', async () => {
    await renderBannerWithEnv(undefined)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('renders nothing when NEXT_PUBLIC_ENVIRONMENT_NAME is production', async () => {
    await renderBannerWithEnv('production')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('renders the banner with staging text when NEXT_PUBLIC_ENVIRONMENT_NAME is staging', async () => {
    await renderBannerWithEnv('staging')
    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent(/staging environment/i)
    expect(banner).toHaveTextContent(/build unknown/i)
  })

  it('includes the build SHA and release tag in the banner when known', async () => {
    vi.resetModules()
    const original = { ...process.env }
    process.env.NEXT_PUBLIC_ENVIRONMENT_NAME = 'staging'
    process.env.NEXT_PUBLIC_BUILD_SHA = 'abc1234567890'
    process.env.NEXT_PUBLIC_RELEASE_TAG = 'staging-20260315-141022-abc1234'

    const { NonProductionBanner } = await import('./non-production-banner')
    render(<NonProductionBanner />)

    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent('abc1234')
    expect(banner).toHaveTextContent('staging-20260315-141022-abc1234')

    process.env = original
  })
})
