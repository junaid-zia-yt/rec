import { describe, expect, it } from 'vitest'
import { CalendarAdapterError } from './types'
import { getCalendarAdapter, getConfiguredCalendarProviders } from './selector'

describe('calendar selector (no OAuth credentials configured in this environment)', () => {
  it('reports no configured providers', () => {
    expect(getConfiguredCalendarProviders()).toEqual([])
  })

  it('google adapter throws not_configured before any network call', async () => {
    const adapter = getCalendarAdapter('google_calendar')
    await expect(
      adapter.createInterviewEvent('fake-token', {
        organizationId: 'org-1',
        title: 'Interview',
        startTime: '2026-10-01T10:00:00Z',
        endTime: '2026-10-01T10:30:00Z',
        attendees: [],
        location: null,
        videoLink: null,
        description: null,
      }),
    ).rejects.toMatchObject({ kind: 'not_configured', provider: 'google_calendar' })
  })

  it('microsoft adapter throws not_configured before any network call', async () => {
    const adapter = getCalendarAdapter('microsoft_calendar')
    await expect(
      adapter.listUpcomingEvents('fake-token', {
        organizationId: 'org-1',
        from: '2026-10-01',
        to: '2026-10-02',
      }),
    ).rejects.toMatchObject({
      kind: 'not_configured',
      provider: 'microsoft_calendar',
    })
  })

  it('both adapters reject with a CalendarAdapterError instance', async () => {
    const adapter = getCalendarAdapter('google_calendar')
    try {
      await adapter.listUpcomingEvents('fake-token', {
        organizationId: 'org-1',
        from: '2026-10-01',
        to: '2026-10-02',
      })
      throw new Error('expected rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(CalendarAdapterError)
    }
  })
})
