/**
 * Provider-shaped webhook signature verification (Build Phase 12 Wave 3).
 * None of these providers is configured in this environment, so NONE of
 * this has been exercised against a real, live-signed webhook — every
 * function here is structurally correct against each provider's PUBLICLY
 * DOCUMENTED signature scheme (general knowledge, not vendor-specific
 * secrets), but untested against a live call. A later wave that actually
 * configures a provider must verify these against that provider's real
 * webhook deliveries before relying on them in production.
 *
 * Apollo does not currently publish a documented inbound webhook signature
 * scheme for the contact-enrichment API this adapter covers (its webhook
 * support, where it exists, is for different products) — `verifyApolloWebhookSignature`
 * implements the common HMAC-SHA256-over-raw-body-with-a-shared-secret
 * pattern used by most REST webhook providers as a clearly-labelled
 * conservative default, NOT a confirmed Apollo-specific scheme. This must
 * be revisited against Apollo's actual documentation once real API access
 * exists, if Apollo webhooks are ever adopted.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/**
 * Generic HMAC-SHA256 verification (hex digest), used as the conservative
 * default described in this file's header note.
 */
export function verifyHmacSha256Signature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader || !secret) return false
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  // Providers commonly prefix the header value (e.g. "sha256=<hex>") — strip a known prefix if present.
  const equalsIndex = signatureHeader.lastIndexOf('=')
  const candidate = equalsIndex === -1 ? signatureHeader : signatureHeader.slice(equalsIndex + 1)
  try {
    return safeCompare(candidate, expected)
  } catch {
    return false
  }
}

/** See this file's header note — conservative HMAC-SHA256 default, not a confirmed Apollo scheme. */
export function verifyApolloWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  sharedSecret: string,
): boolean {
  return verifyHmacSha256Signature(rawBody, signatureHeader, sharedSecret)
}

/**
 * Google Calendar push notifications do NOT use an HMAC body signature at
 * all — per Google's documented "Watching for resource changes" scheme,
 * the channel is verified by matching the `X-Goog-Channel-Token` header
 * against a token this platform generated and stored when it created the
 * watch channel, plus the `X-Goog-Channel-ID`/`X-Goog-Resource-ID`
 * matching a known, stored channel. No token storage exists yet in this
 * schema (see calendar/types.ts's header note), so this function only
 * implements the comparison shape; a future wave's route handler supplies
 * the stored token to compare against.
 */
export function verifyGoogleCalendarChannelToken(
  receivedToken: string | null,
  storedToken: string,
): boolean {
  if (!receivedToken) return false
  try {
    return safeCompare(receivedToken, storedToken)
  } catch {
    return false
  }
}

/**
 * Microsoft Graph change notifications use a `clientState` value (set when
 * the subscription was created) echoed back on every notification, per
 * Microsoft's documented webhook scheme — not an HMAC signature either.
 * Graph also requires a one-time validation-token handshake on
 * subscription creation (out of scope here — that happens at subscribe
 * time, not per-notification).
 */
export function verifyMicrosoftGraphClientState(
  receivedClientState: string | null,
  storedClientState: string,
): boolean {
  if (!receivedClientState) return false
  try {
    return safeCompare(receivedClientState, storedClientState)
  } catch {
    return false
  }
}
