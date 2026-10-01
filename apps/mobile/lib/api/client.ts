import type { CopilotCitation, NotificationEventType } from '@rqi/types'
import { apiBaseUrl } from '@/lib/env'
import { getSupabaseClient } from '@/lib/supabase/client'
import { reportNetworkFailure, reportNetworkSuccess } from '@/lib/network/networkStatus'

/**
 * Typed fetch wrapper for the web app's `/api/mobile/*` Route Handlers.
 *
 * The generic, route-agnostic `apiGet`/`apiPost` primitives below (auth
 * header + 401 handling) are the foundation; the typed wrapper functions at
 * the bottom of this file (Build Phase 13, Wave 4) are the route-specific
 * layer other waves' mobile API contract note asked for once the contract
 * landed — see apps/web/app/api/mobile/** route files for the exact
 * request/response shapes these mirror.
 */

export class ApiAuthError extends Error {
  constructor() {
    super('Not authenticated')
    this.name = 'ApiAuthError'
  }
}

export class ApiNetworkError extends Error {
  constructor(cause: unknown) {
    super('Network request failed')
    this.name = 'ApiNetworkError'
    this.cause = cause
  }
}

export class ApiResponseError extends Error {
  status: number
  body: unknown

  constructor(status: number, body: unknown) {
    super(`API request failed with status ${status}`)
    this.name = 'ApiResponseError'
    this.status = status
    this.body = body
  }
}

/** Invoked on a 401 response so the caller (AuthProvider) can sign out and
 * redirect to sign-in. Set once by AuthProvider at app startup; a no-op
 * until then so this module has no hard dependency on the auth layer. */
let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler
}

/**
 * Invokes the same 401 handler a failed `/api/mobile/*` call would trigger
 * — exported so a caller OUTSIDE this module (lib/data/useSupabaseQuery.ts,
 * for a direct-Supabase read that comes back with an expired/invalid JWT)
 * can route through the exact same "sign the user out and show a session-
 * expired message" path, per Wave 5's session-expiry requirement, without
 * this module needing to know anything about Supabase.
 */
export function notifyUnauthorized() {
  onUnauthorized?.()
}

async function getAuthHeader(): Promise<Record<string, string>> {
  const supabase = getSupabaseClient()
  if (!supabase) return {}

  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function request<TResponse>(
  path: string,
  init: Omit<RequestInit, 'body'> & { body?: unknown } = {},
): Promise<TResponse> {
  const authHeader = await getAuthHeader()

  let response: Response
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...authHeader,
        ...init.headers,
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    })
  } catch (cause) {
    // A thrown fetch (not a resolved response with an error status) is the
    // connectivity-shaped failure the shared offline signal cares about —
    // report it here, once, so every caller of apiGet/apiPost gets the
    // signal for free instead of each screen re-detecting it.
    reportNetworkFailure()
    throw new ApiNetworkError(cause)
  }

  // Any resolved response — even a 4xx/5xx — proves the network itself is
  // reachable, so this clears a previously-reported offline state.
  reportNetworkSuccess()

  if (response.status === 401) {
    onUnauthorized?.()
    throw new ApiAuthError()
  }

  const contentType = response.headers.get('content-type') ?? ''
  const parsedBody = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text().catch(() => null)

  if (!response.ok) {
    throw new ApiResponseError(response.status, parsedBody)
  }

  return parsedBody as TResponse
}

export function apiGet<TResponse>(path: string): Promise<TResponse> {
  return request<TResponse>(path, { method: 'GET' })
}

export function apiPost<TResponse>(path: string, body: unknown): Promise<TResponse> {
  return request<TResponse>(path, { method: 'POST', body })
}

// ---------------------------------------------------------------------------
// Route-specific typed wrappers (Build Phase 13, Wave 4). Every one of
// these POSTs to a route the mobile API contract documents as already
// live; every route returns `{ success: true, data: T }` on 200 and a
// non-2xx status (handled by `request` above, which throws
// ApiResponseError) otherwise — so each wrapper here just unwraps `.data`
// and lets ApiResponseError/ApiNetworkError/ApiAuthError propagate for the
// caller to catch and render.
// ---------------------------------------------------------------------------

interface MobileApiSuccess<T> {
  success: true
  data: T
}

async function postForData<TResponse>(path: string, body: unknown): Promise<TResponse> {
  const result = await apiPost<MobileApiSuccess<TResponse>>(path, body)
  return result.data
}

export interface WhoamiMembership {
  organizationId: string
  organizationName: string | null
  role: string
  isDefault: boolean
  clientId: string | null
}

export interface WhoamiResponse {
  userId: string
  activeOrganization: {
    organizationId: string
    role: string
    isDefault: boolean
    clientId: string | null
  }
  memberships: WhoamiMembership[]
}

/** POST /api/mobile/auth/whoami */
export function whoami(organizationId?: string): Promise<WhoamiResponse> {
  return postForData<WhoamiResponse>(
    '/api/mobile/auth/whoami',
    organizationId ? { organizationId } : {},
  )
}

export interface GateOverrideRequest {
  organizationId: string
  candidateId: string
  candidateRoleMatchId: string
  gateResultId: string
  overrideResult: 'pass' | 'fail'
  reason: string
  evidenceNote: string
}

export interface GateOverrideResponse {
  gateResultId: string
  eligibility: 'eligible' | 'ineligible' | 'pending_verification'
  overallScore: number | null
}

/** POST /api/mobile/reviews/gate-override */
export function submitGateOverride(body: GateOverrideRequest): Promise<GateOverrideResponse> {
  return postForData<GateOverrideResponse>('/api/mobile/reviews/gate-override', body)
}

export interface OutreachApprovalRequest {
  organizationId: string
  decision: 'approved' | 'rejected' | 'changes_requested'
  reason?: string
  editedBeforeApproval?: boolean
}

export interface OutreachApprovalResponse {
  outreachMessageId: string
  status: string
}

/** POST /api/mobile/outreach/[id]/approve */
export function approveOutreachMessage(
  outreachMessageId: string,
  body: OutreachApprovalRequest,
): Promise<OutreachApprovalResponse> {
  return postForData<OutreachApprovalResponse>(
    `/api/mobile/outreach/${outreachMessageId}/approve`,
    body,
  )
}

export interface ShortlistInternalApprovalRequest {
  organizationId: string
  shortlistVersionId: string
  overrideMaxCandidates?: boolean
  overrideReason?: string
}

export interface ShortlistInternalApprovalResponse {
  shortlistId: string
  shortlistVersionId: string
  status: 'internally_approved'
}

/** POST /api/mobile/shortlists/[id]/approve — internal agency sign-off only. */
export function approveShortlistInternally(
  shortlistId: string,
  body: ShortlistInternalApprovalRequest,
): Promise<ShortlistInternalApprovalResponse> {
  return postForData<ShortlistInternalApprovalResponse>(
    `/api/mobile/shortlists/${shortlistId}/approve`,
    body,
  )
}

export interface ShortlistClientDecisionRequest {
  organizationId: string
  shortlistVersionId: string
  clientId: string
  decision: 'accept' | 'discuss' | 'reject'
  notes?: string
}

export interface ShortlistClientDecisionResponse {
  shortlistId: string
  decision: 'accept' | 'discuss' | 'reject'
}

/** POST /api/mobile/shortlists/[id]/client-decision */
export function submitShortlistClientDecision(
  shortlistId: string,
  body: ShortlistClientDecisionRequest,
): Promise<ShortlistClientDecisionResponse> {
  return postForData<ShortlistClientDecisionResponse>(
    `/api/mobile/shortlists/${shortlistId}/client-decision`,
    body,
  )
}

// ---------------------------------------------------------------------------
// Build Phase 13, Wave 5 additions — notifications + copilot.
// ---------------------------------------------------------------------------

export interface MarkNotificationReadResponse {
  notificationId: string
  alreadyRead: boolean
}

/** POST /api/mobile/notifications/[id]/read */
export function markNotificationRead(
  notificationId: string,
  organizationId: string,
): Promise<MarkNotificationReadResponse> {
  return postForData<MarkNotificationReadResponse>(
    `/api/mobile/notifications/${notificationId}/read`,
    { organizationId },
  )
}

export interface MarkAllNotificationsReadResponse {
  markedCount: number
  attempted: number
}

/** POST /api/mobile/notifications/read-all */
export function markAllNotificationsRead(
  organizationId: string,
): Promise<MarkAllNotificationsReadResponse> {
  return postForData<MarkAllNotificationsReadResponse>('/api/mobile/notifications/read-all', {
    organizationId,
  })
}

export interface NotificationPreferenceUpdateRequest {
  organizationId: string
  eventType: NotificationEventType
  inAppEnabled: boolean
  emailEnabled: boolean
}

export interface NotificationPreferenceUpdateResponse {
  eventType: NotificationEventType
  inAppEnabled: boolean
  emailEnabled: boolean
}

/** PUT /api/mobile/notifications/preferences */
export async function updateNotificationPreference(
  body: NotificationPreferenceUpdateRequest,
): Promise<NotificationPreferenceUpdateResponse> {
  const result = await request<MobileApiSuccess<NotificationPreferenceUpdateResponse>>(
    '/api/mobile/notifications/preferences',
    {
      method: 'PUT',
      body,
    },
  )
  return result.data
}

export interface CopilotTurnRequest {
  organizationId: string
  conversationId: string
  message: string
}

/** The success shape, per the mobile API contract's `{status:'success',...}` variant. */
export interface CopilotTurnSuccess {
  status: 'success'
  conversationId: string
  messageId: string
  text: string
  citations: CopilotCitation[]
  citationsCaveatApplied: boolean
  unsupportedClaimsStripped: boolean
  model: string
}

/** Every non-success outcome `runCopilotTurn` can return, including the
 * 403 `unauthorized_tool_attempt` variant (which the route returns with a
 * non-2xx status, unlike the other non-success statuses which are still
 * HTTP 200) — `sendCopilotTurn` below normalizes both onto the same return
 * shape so callers never need to branch on HTTP status themselves. */
export interface CopilotTurnFailure {
  status:
    | 'not_configured'
    | 'permission_narrowed_since_conversation_start'
    | 'rate_limited'
    | 'timeout'
    | 'cancelled'
    | 'provider_error'
    | 'validation_rejected'
    | 'unauthorized_tool_attempt'
  conversationId: string
  message: string
  toolName?: string
}

export type CopilotTurnOutcome =
  | { success: true; data: CopilotTurnSuccess }
  | { success: false; data: CopilotTurnFailure }
  | { success: false; error: string }

/**
 * POST /api/mobile/copilot/turn — deliberately NOT built on `postForData`
 * (which throws on any non-2xx response): this route's `{success:false,
 * data:{status:'unauthorized_tool_attempt',...}}` variant is returned with
 * HTTP 403, so `request()` throws an `ApiResponseError` for it exactly
 * like a "real" 403 — this wrapper catches that one case and unwraps its
 * body back into the same `CopilotTurnOutcome` union every other
 * non-success status already uses (those come back as ordinary HTTP 200
 * bodies and need no special handling). Any OTHER thrown error (network,
 * auth, an actual malformed-request 400) is rethrown as-is — this wrapper
 * only normalizes the one documented case where a non-2xx status still
 * carries a legitimate `CopilotTurnOutcome` payload.
 */
export async function sendCopilotTurn(body: CopilotTurnRequest): Promise<CopilotTurnOutcome> {
  try {
    return await apiPost<CopilotTurnOutcome>('/api/mobile/copilot/turn', body)
  } catch (err) {
    if (
      err instanceof ApiResponseError &&
      err.body &&
      typeof err.body === 'object' &&
      'success' in (err.body as object)
    ) {
      return err.body as CopilotTurnOutcome
    }
    throw err
  }
}
