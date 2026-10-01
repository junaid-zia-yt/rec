import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * `lib/monitoring/capture.ts` tests (Build Phase 15 Wave 3). Mocks
 * `@sentry/nextjs` the same way this codebase mocks any external SDK it has
 * no live credentials for in this environment (see project convention: a
 * fake/mocked provider, never a real network call in a test) — no real
 * Sentry project exists to test against, so every assertion here is about
 * this codebase's own wiring (does it call the right Sentry function, with
 * the right tags, and does it no-op correctly), never about whether Sentry
 * itself actually receives anything.
 */

const captureExceptionMock = vi.fn()
const captureMessageMock = vi.fn()
const setTagMock = vi.fn()
const setContextMock = vi.fn()
const setLevelMock = vi.fn()

vi.mock('@sentry/nextjs', () => {
  const scope = { setTag: setTagMock, setContext: setContextMock, setLevel: setLevelMock }
  return {
    withScope: (fn: (scope: unknown) => void) => fn(scope),
    captureException: captureExceptionMock,
    captureMessage: captureMessageMock,
  }
})

// `sentryConfigured` is mutated per-test via this mutable holder so both
// the "not configured" (this environment's real state) and "configured"
// (what a real deployment with a DSN would do) branches are covered.
const envMock = { sentryConfigured: false }
vi.mock('@/lib/env', () => ({
  get sentryConfigured() {
    return envMock.sentryConfigured
  },
}))

describe('lib/monitoring/capture', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    envMock.sentryConfigured = false
  })

  describe("when Sentry is not configured (this environment's actual state today)", () => {
    it('captureError is a no-op', async () => {
      const { captureError } = await import('./capture')
      expect(() => captureError(new Error('boom'), { category: 'application' })).not.toThrow()
      expect(captureExceptionMock).not.toHaveBeenCalled()
    })

    it('captureMonitoringMessage is a no-op', async () => {
      const { captureMonitoringMessage } = await import('./capture')
      captureMonitoringMessage('something happened', 'error', { category: 'background_job' })
      expect(captureMessageMock).not.toHaveBeenCalled()
    })

    it('captureBusinessMetric is a no-op even above the alert threshold', async () => {
      const { captureBusinessMetric } = await import('./capture')
      captureBusinessMetric({
        metric: 'copilot_daily_cost_usd',
        organizationId: 'org-1',
        value: 10,
        limit: 5,
        windowDate: '2026-09-29',
      })
      expect(captureMessageMock).not.toHaveBeenCalled()
    })
  })

  describe('when Sentry is configured', () => {
    beforeEach(() => {
      envMock.sentryConfigured = true
    })

    it('captureError calls Sentry.captureException with the category tag', async () => {
      const { captureError } = await import('./capture')
      const error = new Error('boom')
      captureError(error, { category: 'ai_provider', organizationId: 'org-1' })

      expect(captureExceptionMock).toHaveBeenCalledWith(error)
      expect(setTagMock).toHaveBeenCalledWith('category', 'ai_provider')
      expect(setTagMock).toHaveBeenCalledWith('organizationId', 'org-1')
    })

    it('captureError never throws even if the Sentry call itself throws', async () => {
      captureExceptionMock.mockImplementationOnce(() => {
        throw new Error('sentry is down')
      })
      const { captureError } = await import('./capture')
      expect(() => captureError(new Error('boom'), { category: 'application' })).not.toThrow()
    })

    it('captureMonitoringMessage calls Sentry.captureMessage with the given severity', async () => {
      const { captureMonitoringMessage } = await import('./capture')
      captureMonitoringMessage('job dead-lettered', 'error', {
        category: 'background_job',
        organizationId: 'org-2',
        extra: { jobId: 'job-1' },
      })

      expect(captureMessageMock).toHaveBeenCalledWith('job dead-lettered', 'error')
      expect(setLevelMock).toHaveBeenCalledWith('error')
      expect(setContextMock).toHaveBeenCalledWith('monitoring_extra', { jobId: 'job-1' })
    })

    it('captureBusinessMetric stays silent below 80% of the limit', async () => {
      const { captureBusinessMetric } = await import('./capture')
      captureBusinessMetric({
        metric: 'copilot_daily_cost_usd',
        organizationId: 'org-1',
        value: 3,
        limit: 5,
        windowDate: '2026-09-29',
      })
      expect(captureMessageMock).not.toHaveBeenCalled()
    })

    it('captureBusinessMetric warns approaching the limit and errors once it is exceeded', async () => {
      const { captureBusinessMetric } = await import('./capture')

      captureBusinessMetric({
        metric: 'copilot_daily_cost_usd',
        organizationId: 'org-1',
        value: 4.5,
        limit: 5,
        windowDate: '2026-09-29',
      })
      expect(captureMessageMock).toHaveBeenLastCalledWith(
        expect.stringContaining('approaching limit'),
        'warning',
      )

      captureBusinessMetric({
        metric: 'copilot_daily_cost_usd',
        organizationId: 'org-1',
        value: 6,
        limit: 5,
        windowDate: '2026-09-29',
      })
      expect(captureMessageMock).toHaveBeenLastCalledWith(
        expect.stringContaining('exceeded'),
        'error',
      )
    })
  })
})
