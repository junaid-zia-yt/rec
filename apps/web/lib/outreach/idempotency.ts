/**
 * Idempotency-key generation for outreach_messages.idempotency_key (Build
 * Phase 9 brief testing requirement "Idempotent sending"). The migration's
 * own column comment (supabase/migrations/0029_outreach.sql) specifies the
 * format: "a caller-supplied key (e.g. `<message_id>:<attempt_no>`), set
 * once the first send attempt is made" — this module implements exactly
 * that format, chosen for this task (judgment call, documented here since
 * the brief left the exact format to the implementer):
 *
 *   `<outreachMessageId>:<attemptNumber>`
 *
 * attemptNumber starts at 1 for the first send attempt and increments only
 * when a genuinely new attempt is made after a prior one failed (never
 * incremented for a mere retry-with-the-same-key — see
 * isRetryOfSameAttempt below). The (organization_id, idempotency_key)
 * unique index means each `<id>:<n>` pair can be used to send at most once
 * per org; a channel adapter's send call should be given this exact string
 * to pass through as its own idempotency mechanism (e.g. Resend's
 * Idempotency-Key header — see lib/outreach/channels/email.ts) so a
 * network-level retry of the SAME attempt is deduplicated by the provider,
 * while a genuinely new attempt (after e.g. fixing a bad contact point)
 * gets a new key and is allowed to send again.
 *
 * No DB/network I/O — unit-testable in isolation.
 */

export function generateOutreachIdempotencyKey(params: {
  outreachMessageId: string
  attemptNumber: number
}): string {
  const { outreachMessageId, attemptNumber } = params
  if (!outreachMessageId) {
    throw new Error('generateOutreachIdempotencyKey: outreachMessageId is required')
  }
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1) {
    throw new Error('generateOutreachIdempotencyKey: attemptNumber must be a positive integer')
  }
  return `${outreachMessageId}:${attemptNumber}`
}

/** Parses a key produced by generateOutreachIdempotencyKey back into its parts, or null if it is not in that format (e.g. a legacy/foreign key). */
export function parseOutreachIdempotencyKey(
  key: string,
): { outreachMessageId: string; attemptNumber: number } | null {
  const lastColon = key.lastIndexOf(':')
  if (lastColon <= 0 || lastColon === key.length - 1) return null

  const outreachMessageId = key.slice(0, lastColon)
  const attemptPart = key.slice(lastColon + 1)
  const attemptNumber = Number(attemptPart)

  if (!Number.isInteger(attemptNumber) || attemptNumber < 1) return null
  return { outreachMessageId, attemptNumber }
}

/**
 * True when `candidateKey` is the exact same idempotency key already
 * recorded on the message (i.e. this would be a retried attempt with the
 * same key, which the caller should treat as "already in flight / already
 * sent" rather than generating a fresh key and attempting a second real
 * send).
 */
export function isRetryOfSameAttempt(params: {
  existingIdempotencyKey: string | null
  candidateKey: string
}): boolean {
  return (
    params.existingIdempotencyKey !== null && params.existingIdempotencyKey === params.candidateKey
  )
}
