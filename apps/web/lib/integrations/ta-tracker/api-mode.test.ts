import { describe, expect, it } from 'vitest'
import { attemptApiModeSync, getTaTrackerApiModeAdapter } from './api-mode'

describe('TA Tracker API mode (structural honesty stub)', () => {
  it('attemptApiModeSync always reports no_documentation', () => {
    const result = attemptApiModeSync()
    expect(result.status).toBe('no_documentation')
    expect(result.errorMessage).toContain('no confirmed API')
  })

  it('the adapter cannot be made to report anything other than no_documentation', async () => {
    const adapter = getTaTrackerApiModeAdapter()
    for (let i = 0; i < 5; i += 1) {
      const result = await adapter.sync()
      expect(result.status).toBe('no_documentation')
    }
  })
})
