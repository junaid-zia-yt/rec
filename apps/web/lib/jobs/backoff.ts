/**
 * Exponential backoff with jitter for `background_jobs.next_attempt_at`
 * (Build Phase 12 brief: "exponential backoff"). Pure and deterministic
 * given an injected random source — no DB/network I/O, unit-testable in
 * isolation, mirroring `lib/outreach/idempotency.ts`'s "no I/O, pure
 * function" convention exactly.
 *
 * FORMULA (judgment call — the brief specifies "exponential backoff with
 * jitter" but not the exact constants, so this is documented here per this
 * task's convention of writing out chosen formulas rather than leaving them
 * implicit):
 *
 *   rawDelayMs   = min(BASE_DELAY_MS * 2^attemptCount, MAX_DELAY_MS)
 *   jitterFactor = 1 + uniform(-JITTER_RATIO, +JITTER_RATIO)
 *   delayMs      = round(rawDelayMs * jitterFactor), clamped to >= 0
 *
 * `attemptCount` is the number of attempts ALREADY MADE (i.e. the job's
 * `attempt_count` column immediately after this failed attempt was
 * recorded) — so the delay after the 1st failure uses attemptCount=1
 * (BASE_DELAY_MS * 2^1 = 2x base), not attemptCount=0, which would produce
 * an oddly-short first backoff. Full-jitter (multiplying the whole
 * exponential value, not just adding random noise on top) is used
 * specifically to avoid a thundering herd of jobs that all failed at
 * roughly the same time (e.g. an upstream outage) all retrying at exactly
 * the same recomputed instant.
 *
 * Constants are named exports, not inlined, so a later wave/product
 * decision can tune them (e.g. a job type that legitimately wants faster
 * or slower retries can pass `options` to override per call without
 * touching this module).
 */

/** Base delay for the first retry (attemptCount = 1), before jitter. 30 seconds — long enough that a genuinely transient blip (a rate limit, a momentary network error) has almost certainly cleared, short enough that a real user isn't left waiting minutes for a document-processing retry. */
export const DEFAULT_BASE_DELAY_MS = 30_000

/** Hard cap on the computed delay, regardless of attemptCount — without this, a job with a generous max_attempts would eventually compute a multi-day delay. 30 minutes: long enough to space out repeated failures, short enough that a dead-letter (once max_attempts is reached) isn't preceded by a near-day-long wait. */
export const DEFAULT_MAX_DELAY_MS = 30 * 60_000

/** Jitter as a fraction of the raw exponential delay (0.2 = ±20%). */
export const DEFAULT_JITTER_RATIO = 0.2

export interface BackoffOptions {
  baseDelayMs?: number
  maxDelayMs?: number
  jitterRatio?: number
  /** Injectable random source for deterministic tests — defaults to `Math.random`. Must return a value in [0, 1). */
  random?: () => number
}

/**
 * Computes the delay, in milliseconds, before a job's next attempt should
 * run, given how many attempts have been made so far. `attemptCount` must
 * be a positive integer (call this only after recording a failed attempt,
 * never before the first one).
 */
export function calculateNextAttemptDelay(
  attemptCount: number,
  options: BackoffOptions = {},
): number {
  if (!Number.isInteger(attemptCount) || attemptCount < 1) {
    throw new Error('calculateNextAttemptDelay: attemptCount must be a positive integer')
  }

  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS
  const jitterRatio = options.jitterRatio ?? DEFAULT_JITTER_RATIO
  const random = options.random ?? Math.random

  // 2^attemptCount can overflow toward Infinity for a pathologically large
  // attemptCount; Math.min against maxDelayMs below makes that harmless
  // (Infinity loses to any finite cap), but guard the multiplication itself
  // so a NaN never sneaks through if baseDelayMs is 0.
  const rawDelayMs = Math.min(baseDelayMs * 2 ** attemptCount, maxDelayMs)

  const jitterFactor = 1 + (random() * 2 - 1) * jitterRatio
  const delayMs = Math.round(rawDelayMs * jitterFactor)

  return Math.max(0, delayMs)
}

/** Convenience wrapper: `calculateNextAttemptDelay` plus "now" (or an injected `now`), returning the actual `next_attempt_at` instant as a `Date`. */
export function calculateNextAttemptAt(
  attemptCount: number,
  options: BackoffOptions & { now?: Date } = {},
): Date {
  const delayMs = calculateNextAttemptDelay(attemptCount, options)
  const now = options.now ?? new Date()
  return new Date(now.getTime() + delayMs)
}
