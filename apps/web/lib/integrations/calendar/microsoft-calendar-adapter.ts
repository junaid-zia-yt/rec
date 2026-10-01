import 'server-only'
import { microsoftCalendarConfigured } from '@/lib/env'
import {
  CalendarAdapterError,
  type CalendarAdapter,
  type CalendarEvent,
  type CreateInterviewEventInput,
  type ListUpcomingEventsParams,
} from './types'

/**
 * Microsoft Graph Calendar adapter (Build Phase 12 Wave 3, docs/11-
 * integration-plan.md §11.5). Talks to the documented Microsoft Graph
 * `/me/events` REST endpoints over `fetch` — no Graph SDK is installed in
 * this repo's dependency tree, and this task's brief scopes new
 * dependencies out.
 *
 * Gated on `microsoftCalendarConfigured` (both `MICROSOFT_CALENDAR_
 * CLIENT_ID` and `MICROSOFT_CALENDAR_CLIENT_SECRET`, per `lib/env.ts`) —
 * neither is set in this environment, so every call here throws
 * `not_configured` before any network attempt. This has NOT been
 * exercised against a live Microsoft/Azure AD account:
 * implemented-but-untested-against-a-live-call, same convention as every
 * other integration in this codebase.
 */
const GRAPH_API_BASE_URL = 'https://graph.microsoft.com/v1.0'
const REQUEST_TIMEOUT_MS = 15_000

interface GraphEventResource {
  id: string
  subject?: string
  location?: { displayName?: string }
  onlineMeeting?: { joinUrl?: string }
  start?: { dateTime?: string }
  end?: { dateTime?: string }
  attendees?: { emailAddress?: { address?: string; name?: string } }[]
}

function mapGraphEvent(raw: GraphEventResource): CalendarEvent {
  return {
    providerEventId: raw.id,
    provider: 'microsoft_calendar',
    title: raw.subject ?? '',
    startTime: raw.start?.dateTime ?? '',
    endTime: raw.end?.dateTime ?? '',
    attendees: (raw.attendees ?? [])
      .filter((a) => a.emailAddress?.address)
      .map((a) => ({ email: a.emailAddress!.address!, displayName: a.emailAddress?.name ?? null })),
    location: raw.location?.displayName ?? null,
    videoLink: raw.onlineMeeting?.joinUrl ?? null,
  }
}

class MicrosoftCalendarAdapter implements CalendarAdapter {
  readonly provider = 'microsoft_calendar' as const

  private assertConfigured(): void {
    if (!microsoftCalendarConfigured) {
      throw new CalendarAdapterError(
        'Microsoft Calendar is not configured: MICROSOFT_CALENDAR_CLIENT_ID/MICROSOFT_CALENDAR_CLIENT_SECRET are not set.',
        'not_configured',
        'microsoft_calendar',
      )
    }
  }

  private async request<T>(accessToken: string, path: string, init?: RequestInit): Promise<T> {
    this.assertConfigured()

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await fetch(`${GRAPH_API_BASE_URL}${path}`, {
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
          `Microsoft Graph rejected the request (HTTP ${response.status}).`,
          'invalid_request',
          'microsoft_calendar',
        )
      }
      if (!response.ok) {
        throw new CalendarAdapterError(
          `Microsoft Graph API returned HTTP ${response.status}.`,
          'provider_error',
          'microsoft_calendar',
        )
      }
      return (await response.json()) as T
    } catch (error) {
      if (error instanceof CalendarAdapterError) throw error
      const isAbort = error instanceof Error && error.name === 'AbortError'
      throw new CalendarAdapterError(
        isAbort ? 'Microsoft Graph request timed out.' : 'Could not reach the Microsoft Graph API.',
        'network',
        'microsoft_calendar',
      )
    } finally {
      clearTimeout(timeout)
    }
  }

  async createInterviewEvent(
    accessToken: string,
    input: CreateInterviewEventInput,
  ): Promise<CalendarEvent> {
    const raw = await this.request<GraphEventResource>(accessToken, '/me/events', {
      method: 'POST',
      body: JSON.stringify({
        subject: input.title,
        body: input.description ? { contentType: 'text', content: input.description } : undefined,
        location: input.location ? { displayName: input.location } : undefined,
        start: { dateTime: input.startTime, timeZone: 'UTC' },
        end: { dateTime: input.endTime, timeZone: 'UTC' },
        attendees: input.attendees.map((a) => ({
          emailAddress: { address: a.email, name: a.displayName ?? undefined },
          type: 'required',
        })),
        // videoLink is a placeholder the recruiter supplies, not a Teams auto-created link (no isOnlineMeeting request is sent) — see types.ts's header note.
      }),
    })
    const mapped = mapGraphEvent(raw)
    return { ...mapped, videoLink: input.videoLink ?? mapped.videoLink }
  }

  async listUpcomingEvents(
    accessToken: string,
    params: ListUpcomingEventsParams,
  ): Promise<CalendarEvent[]> {
    void params.organizationId // organizationId scopes which stored token a caller selects, not the Graph API call itself
    const query = new URLSearchParams({
      startDateTime: params.from,
      endDateTime: params.to,
    })
    const raw = await this.request<{ value?: GraphEventResource[] }>(
      accessToken,
      `/me/calendarView?${query.toString()}`,
      {
        method: 'GET',
      },
    )
    return (raw.value ?? []).map(mapGraphEvent)
  }
}

export function getMicrosoftCalendarAdapter(): CalendarAdapter {
  return new MicrosoftCalendarAdapter()
}
