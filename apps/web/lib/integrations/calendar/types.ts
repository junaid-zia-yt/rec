/**
 * Calendar — shared types across Google Calendar and Microsoft Graph
 * Calendar (Build Phase 12 Wave 3, docs/11-integration-plan.md §11.5,
 * docs/18-blocking-questions.md Q-P3-01 — explicitly low-priority/
 * deferred, but still asked for this wave). Both providers have real,
 * standard, well-documented OAuth-based APIs. Mirrors the `ChannelAdapter`
 * pattern from `apps/web/lib/outreach/channels/types.ts` so a later wave's
 * UI never needs to special-case which calendar provider is connected.
 *
 * NO OAUTH TOKEN STORAGE EXISTS YET in this schema (0032 has no
 * calendar-token table, and adding one is a migration change out of this
 * wave's scope) — both adapters therefore take an already-obtained OAuth
 * access token as a plain parameter rather than performing or storing an
 * OAuth flow themselves. A future wave that owns the OAuth
 * connect/refresh flow and its token storage supplies that token; this
 * module only covers "given a valid access token, call the calendar API."
 * No live OAuth client id/secret is configured in this environment either
 * (`googleCalendarConfigured`/`microsoftCalendarConfigured` are both
 * `false`), so no adapter here has been exercised against a live account.
 */

export interface CalendarEventAttendee {
  email: string
  displayName: string | null
}

export interface CreateInterviewEventInput {
  organizationId: string
  title: string
  /** ISO 8601 */
  startTime: string
  /** ISO 8601 */
  endTime: string
  attendees: CalendarEventAttendee[]
  location: string | null
  /** A placeholder video-conferencing link the recruiter supplies — this adapter never generates one itself (no video provider is in the approved stack). */
  videoLink: string | null
  description: string | null
}

export interface CalendarEvent {
  providerEventId: string
  provider: 'google_calendar' | 'microsoft_calendar'
  title: string
  startTime: string
  endTime: string
  attendees: CalendarEventAttendee[]
  location: string | null
  videoLink: string | null
}

export type CalendarErrorKind = 'not_configured' | 'invalid_request' | 'provider_error' | 'network'

export class CalendarAdapterError extends Error {
  constructor(
    message: string,
    readonly kind: CalendarErrorKind,
    readonly provider: 'google_calendar' | 'microsoft_calendar',
  ) {
    super(message)
    this.name = 'CalendarAdapterError'
  }
}

export interface ListUpcomingEventsParams {
  organizationId: string
  /** ISO 8601 */
  from: string
  /** ISO 8601 */
  to: string
}

/**
 * One calendar provider's adapter. Every method takes the OAuth access
 * token explicitly (see this file's header note) — the adapter itself
 * never reads, stores, or refreshes a token.
 */
export interface CalendarAdapter {
  readonly provider: 'google_calendar' | 'microsoft_calendar'
  createInterviewEvent(
    accessToken: string,
    input: CreateInterviewEventInput,
  ): Promise<CalendarEvent>
  /** For conflict-checking against a candidate's/interviewer's existing schedule before proposing a slot. */
  listUpcomingEvents(
    accessToken: string,
    params: ListUpcomingEventsParams,
  ): Promise<CalendarEvent[]>
}
