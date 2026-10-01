/**
 * Deterministic legal-transition graph for `BackgroundJobStatus` (Build
 * Phase 12 brief). Mirrors `lib/outreach/status-transitions.ts`'s (Build
 * Phase 9) exact "legal state graph as a pure function" pattern and
 * commenting style.
 *
 * This is an APPLICATION-LEVEL convenience/guard — the DB's own CHECK
 * constraint on `background_jobs.status`
 * (supabase/migrations/0032_integrations_jobs_notifications.sql) allows any
 * of the 6 values with no ordering constraint at all; this module is what
 * `executor.ts`/`manual-retry.ts`/`enqueue.ts` call before attempting a
 * status update so a disallowed transition (e.g. `succeeded` -> `queued`)
 * produces a clear application error rather than being silently written.
 *
 * CHOSEN GRAPH (mirrors the brief's own step-3 description of the legal
 * graph verbatim):
 *
 *   queued        -> running (claimed by the executor), cancelled
 *   running       -> succeeded, failed, cancelled (an in-flight
 *                     cancellation signal fires — see
 *                     JobExecutionContext.signal)
 *   succeeded     -> (terminal — no outgoing edges)
 *   failed        -> queued (automatic retry: attempt_count < max_attempts,
 *                     OR a manual retry via manuallyRetryJob), dead_lettered
 *                     (attempts exhausted)
 *   dead_lettered -> queued (MANUAL retry only — manuallyRetryJob is the
 *                     only code path that ever performs this edge; the
 *                     automatic retry path in executor.ts only ever
 *                     produces failed -> queued or failed -> dead_lettered,
 *                     never dead_lettered -> queued on its own)
 *   cancelled     -> (terminal — no outgoing edges)
 *
 * Note this graph does not by itself distinguish "who" is allowed to
 * perform `dead_lettered -> queued` (that's `manuallyRetryJob`'s
 * permission gate, not this pure function's job) — it only says the edge
 * is structurally legal.
 *
 * No DB/network I/O — unit-testable in isolation.
 */

import type { BackgroundJobStatus } from '@rqi/types'

const TRANSITIONS: Readonly<Record<BackgroundJobStatus, ReadonlyArray<BackgroundJobStatus>>> = {
  queued: ['running', 'cancelled'],
  running: ['succeeded', 'failed', 'cancelled'],
  succeeded: [],
  failed: ['queued', 'dead_lettered'],
  dead_lettered: ['queued'],
  cancelled: [],
}

/** True when `from -> to` is a legal edge in the chosen graph. `from === to` is never legal here (that is a no-op the caller should short-circuit, not a "transition"). */
export function canTransitionJobStatus(
  from: BackgroundJobStatus,
  to: BackgroundJobStatus,
): boolean {
  if (from === to) return false
  return TRANSITIONS[from].includes(to)
}

/** All statuses legally reachable in one step from `from` — useful for building an oversight UI's set of allowed next actions (e.g. only showing a "retry" button when the graph actually allows one). */
export function nextLegalJobStatuses(
  from: BackgroundJobStatus,
): ReadonlyArray<BackgroundJobStatus> {
  return TRANSITIONS[from]
}

/** True for a status this graph treats as terminal (no outgoing edges). */
export function isTerminalJobStatus(status: BackgroundJobStatus): boolean {
  return TRANSITIONS[status].length === 0
}
