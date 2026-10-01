/**
 * TA Tracker — API mode. STUB ONLY, by design, forever, until real
 * documentation exists (docs/18-blocking-questions.md Q-P2-03).
 *
 * The project instructions are explicit: "Do not invent a TA Tracker API."
 * There is no confirmed API, no documentation, and no credentials
 * (docs/11-integration-plan.md §11.2 — "[CONFIRMED — Technical Blocker]").
 * `supabase/migrations/0032`'s `integration_connections_ta_tracker_api_
 * mode_honesty` CHECK constraint makes it structurally impossible for a
 * `provider = 'ta_tracker' AND mode = 'api'` row to ever reach
 * `status = 'connected' | 'sync_error' | 'disconnected'` at the database
 * layer. This module mirrors that same guarantee at the application layer:
 * there is no configuration flag, no env var, and no branch anywhere in
 * this file that could make `attemptApiModeSync` return anything other
 * than `no_documentation`. Any future wave that receives real TA Tracker
 * API documentation must replace this file entirely (not extend it with a
 * conditional path) — that is the intended signal that real work is
 * starting, not a silent config flip.
 */

/** The only two statuses the 0032 CHECK constraint allows for provider='ta_tracker' AND mode='api'. This module only ever produces 'no_documentation' — 'not_connected' is the row's initial/default state, never something this module reports itself. */
export type TaTrackerApiModeStatus = 'no_documentation'

export interface TaTrackerApiModeResult {
  status: TaTrackerApiModeStatus
  errorMessage: string
}

/**
 * Always returns the same honest result. Takes no parameters (an API-key,
 * base URL, or any other "configuration" would imply a real endpoint
 * exists to configure against — none does) and performs no network call of
 * any kind.
 */
export function attemptApiModeSync(): TaTrackerApiModeResult {
  return {
    status: 'no_documentation',
    errorMessage:
      'TA Tracker has no confirmed API, documentation, or credentials (docs/11-integration-plan.md §11.2, docs/18-blocking-questions.md Q-P2-03). API-mode sync is not implemented and will not be attempted. Use CSV import/export or secure manual exchange instead.',
  }
}

/**
 * Typed adapter shape a future, real TA Tracker API integration would plug
 * into, once real documentation arrives — deliberately minimal (one
 * capability: run a sync pass) since nothing is known about what a real TA
 * Tracker API would actually expose. `sync()` is `async` only to match the
 * shape a real network-calling implementation would need; this
 * implementation performs no I/O.
 */
export interface TaTrackerApiModeAdapter {
  readonly provider: 'ta_tracker'
  readonly mode: 'api'
  sync(): Promise<TaTrackerApiModeResult>
}

class TaTrackerApiModeStubAdapter implements TaTrackerApiModeAdapter {
  readonly provider = 'ta_tracker' as const
  readonly mode = 'api' as const

  async sync(): Promise<TaTrackerApiModeResult> {
    return attemptApiModeSync()
  }
}

/** The only way to obtain this adapter — always the stub, never anything else. */
export function getTaTrackerApiModeAdapter(): TaTrackerApiModeAdapter {
  return new TaTrackerApiModeStubAdapter()
}
