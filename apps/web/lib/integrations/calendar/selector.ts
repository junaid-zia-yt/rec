import 'server-only'
import { googleCalendarConfigured, microsoftCalendarConfigured } from '@/lib/env'
import type { CalendarAdapter } from './types'
import { getGoogleCalendarAdapter } from './google-calendar-adapter'
import { getMicrosoftCalendarAdapter } from './microsoft-calendar-adapter'

/**
 * Selector — the ONLY thing a later wave's server action/job handler
 * should call, never a concrete adapter class directly. Both adapters
 * throw `CalendarAdapterError('not_configured', ...)` on every call when
 * their own env flag is false (see each adapter's own file), so this
 * selector never needs to branch on configuration itself — it only picks
 * WHICH provider's adapter shape to hand back.
 */
export function getCalendarAdapter(
  provider: 'google_calendar' | 'microsoft_calendar',
): CalendarAdapter {
  return provider === 'google_calendar' ? getGoogleCalendarAdapter() : getMicrosoftCalendarAdapter()
}

/** Which calendar providers currently have real OAuth credentials configured — a later wave's UI/Integrations screen reads this to decide what to offer as connectable, rather than reimplementing the env checks itself. */
export function getConfiguredCalendarProviders(): ('google_calendar' | 'microsoft_calendar')[] {
  const providers: ('google_calendar' | 'microsoft_calendar')[] = []
  if (googleCalendarConfigured) providers.push('google_calendar')
  if (microsoftCalendarConfigured) providers.push('microsoft_calendar')
  return providers
}
