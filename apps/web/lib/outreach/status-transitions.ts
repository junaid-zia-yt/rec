/**
 * Deterministic legal-transition graph for OutreachMessageStatus (Build
 * Phase 9 brief functional requirement #8's 9-value status machine). This
 * is an APPLICATION-LEVEL convenience check — the DB does not enforce a
 * transition graph beyond the CHECK constraint allowing any of the 9
 * values (supabase/migrations/0029_outreach.sql), plus the two independent
 * hard gates (approval-required, opt-out) that fire on specific target
 * statuses regardless of this graph. Next wave's server actions should call
 * this before attempting a status update so a disallowed transition
 * produces a clear application error rather than relying solely on the DB
 * CHECK (which would accept it) or the two triggers (which only reject
 * approval/opt-out violations, not an out-of-order transition like
 * 'drafted' -> 'sent').
 *
 * CHOSEN GRAPH (judgment call — documented per the task brief):
 *
 *   drafted           -> awaiting_approval, cancelled
 *   awaiting_approval  -> approved, drafted (changes requested / sent back
 *                         to edit), cancelled
 *   approved          -> scheduled, sent (immediate send is allowed —
 *                         "scheduled" is optional, not mandatory), cancelled
 *   scheduled         -> sent, cancelled
 *   sent              -> delivered, failed, responded (a candidate can
 *                         reply before a delivery confirmation event
 *                         arrives, or a channel with no delivery-receipt
 *                         concept, e.g. a manually-logged phone call, may
 *                         go straight to responded)
 *   delivered         -> responded
 *   failed            -> awaiting_approval (retry after a human fixes
 *                         whatever caused the failure, e.g. a bad contact
 *                         point — re-enters the approval step rather than
 *                         skipping straight back to 'approved', since the
 *                         draft/contact details may have changed)
 *   responded         -> (terminal for this state machine; further
 *                         conversation is tracked via candidate_responses,
 *                         not further OutreachMessage status changes)
 *   cancelled         -> (terminal)
 *
 * No DB/network I/O — unit-testable in isolation.
 */

import type { OutreachMessageStatus } from '@rqi/types'

const TRANSITIONS: Readonly<Record<OutreachMessageStatus, ReadonlyArray<OutreachMessageStatus>>> = {
  drafted: ['awaiting_approval', 'cancelled'],
  awaiting_approval: ['approved', 'drafted', 'cancelled'],
  approved: ['scheduled', 'sent', 'cancelled'],
  scheduled: ['sent', 'cancelled'],
  sent: ['delivered', 'failed', 'responded'],
  delivered: ['responded'],
  failed: ['awaiting_approval'],
  responded: [],
  cancelled: [],
}

/** True when `from -> to` is a legal edge in the chosen graph. `from === to` is never legal here (that is a no-op the caller should short-circuit, not a "transition"). */
export function canTransitionOutreachMessageStatus(
  from: OutreachMessageStatus,
  to: OutreachMessageStatus,
): boolean {
  if (from === to) return false
  return TRANSITIONS[from].includes(to)
}

/** All statuses legally reachable in one step from `from` — useful for building a UI's set of allowed next actions. */
export function nextLegalOutreachMessageStatuses(
  from: OutreachMessageStatus,
): ReadonlyArray<OutreachMessageStatus> {
  return TRANSITIONS[from]
}

/** True for a status this graph treats as terminal (no outgoing edges). */
export function isTerminalOutreachMessageStatus(status: OutreachMessageStatus): boolean {
  return TRANSITIONS[status].length === 0
}
