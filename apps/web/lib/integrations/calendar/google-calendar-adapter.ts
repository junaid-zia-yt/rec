import 'server-only'
import { googleCalendarConfigured } from '@/lib/env'
import {
  CalendarAdapterError,
  type CalendarAdapter,
  type CalendarEvent,
  type CreateInterviewEventInput,
  type ListUpcomingEventsParams,
} from './types'

/**
 * Google Calendar adapter (Build Phase 12 Wave 3, docs/11-integration-plan.md
 * §11.5). Talks to the documented Google Calendar API v3 REST endpoints
 * over `fetch` — no `googleapis` SDK is installed in this repo's
 * dependency tree, and this task's brief scopes new dependencies out.
 *
 * Gated on `googleCalendarConfigured` (both `GOOGLE_CALENDAR_CLIENT_ID`
 * and `GOOGLE_CALENDAR_CLIENT_SECRET`, per `lib/env.ts`) — neither is set
 * in this environment, so every call here throws `not_configured` before
 * any network attempt. This has NOT been exercised against a live Google
 * account: implemented-but-untested-against-a-live-call, same convention
 * as every other integration in this codebase.
 */
const CALENDAR_API_BASE_URL = 'https://www.googleapis.com/calendar/v3'
const REQUEST_TIMEOUT_MS = 15_000

interface GoogleEventResource {
  id: string
  summary?: string
  location?: string
  hangoutLink?: string
  start?: { dateTime?: string }
  end?: { dateTime?: string }
  attendees?: { email: string; displayName?: string }[]
}

function mapGoogleEvent(raw: GoogleEventResource): CalendarEvent {
  return {
    providerEventId: raw.id,
    provider: 'google_calendar',
    title: raw.summary ?? '',
    startTime: raw.start?.dateTime ?? '',
    endTime: raw.end?.dateTime ?? '',
    attendees: (raw.attendees ?? []).map((a) => ({
      email: a.email,
      displayName: a.displayName ?? null,
    })),
    location: raw.location ?? null,
    videoLink: raw.hangoutLink ?? null,
  }
}

class GoogleCalendarAdapter implements CalendarAdapter {
  readonly provider = 'google_calendar' as const

  private assertConfigured(): void {
    if (!googleCalendarConfigured) {
      throw new CalendarAdapterError(
        'Google Calendar is not configured: GOOGLE_CALENDAR_CLIENT_ID/GOOGLE_CALENDAR_CLIENT_SECRET are not set.',
        'not_configured',
        'google_calendar',
      )
    }
  }

  private async request<T>(accessToken: string, path: string, init?: RequestInit): Promise<T> {
    this.assertConfigured()

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await fetch(`${CALENDAR_API_BASE_URL}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          ...(init?.headers ?? {}),
        },
      })

      if (response.status === 400 || response.status === 422) {
        throw new CalendarAdapterError(
          `Google Calendar rejected the request (HTTP ${response.status}).`,
          'invalid_request',
          'google_calendar',
        )
      }
      if (!response.ok) {
        throw new CalendarAdapterError(
          `Google Calendar API returned HTTP ${response.status}.`,
          'provider_error',
          'google_calendar',
        )
      }
      return (await response.json()) as T
    } catch (error) {
      if (error instanceof CalendarAdapterError) throw error
      const isAbort = error instanceof Error && error.name === 'AbortError'
      throw new CalendarAdapterError(
        isAbort ? 'Google Calendar request timed out.' : 'Could not reach the Google Calendar API.',
        'network',
        'google_calendar',
      )
    } finally {
      clearTimeout(timeout)
    }
  }

  async createInterviewEvent(
    accessToken: string,
    input: CreateInterviewEventInput,
  ): Promise<CalendarEvent> {
    const raw = await this.request<GoogleEventResource>(accessToken, '/calendars/primary/events', {
      method: 'POST',
      body: JSON.stringify({
        summary: input.title,
        description: input.description ?? undefined,
        location: input.location ?? undefined,
        start: { dateTime: input.startTime },
        end: { dateTime: input.endTime },
        attendees: input.attendees.map((a) => ({
          email: a.email,
          displayName: a.displayName ?? undefined,
        })),
        // videoLink is a placeholder the recruiter supplies, not a Google Meet auto-created link (no conferenceData request is sent) — see types.ts's header note.
      }),
    })
    const mapped = mapGoogleEvent(raw)
    return { ...mapped, videoLink: input.videoLink ?? mapped.videoLink }
  }

  async listUpcomingEvents(
    accessToken: string,
    params: ListUpcomingEventsParams,
  ): Promise<CalendarEvent[]> {
    void params.organizationId // organizationId scopes which stored token a caller selects, not the Google API call itself
    const query = new URLSearchParams({
      timeMin: params.from,
      timeMax: params.to,
      singleEvents: 'true',
      orderBy: 'startTime',
    })
    const raw = await this.request<{ items?: GoogleEventResource[] }>(
      accessToken,
      `/calendars/primary/events?${query.toString()}`,
      {
        method: 'GET',
      },
    )
    return (raw.items ?? []).map(mapGoogleEvent)
  }
}

export function getGoogleCalendarAdapter(): CalendarAdapter {
  return new GoogleCalendarAdapter()
}
