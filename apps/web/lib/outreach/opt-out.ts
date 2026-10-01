/**
 * Pure, deterministic pre-check mirroring the DB trigger
 * `enforce_outreach_message_opt_out_gate()` (supabase/migrations/0029_
 * outreach.sql) — that trigger is the actual hard gate (already built and
 * pgverify-tested); this module lets application code give a friendly,
 * specific error *before* hitting the DB constraint, never a replacement
 * for it. If this function and the DB trigger ever disagree, the DB
 * trigger wins — this file's job is only to make the common case (an
 * already-known opted-out candidate) fail fast and readably.
 *
 * No DB/network I/O — unit-testable in isolation.
 */

import type {
  CommunicationChannel,
  CommunicationPreferenceStatus,
  OutreachMessageStatus,
} from '@rqi/types'

/**
 * The DB trigger only re-checks the opt-out gate when a message's status
 * moves INTO 'approved' | 'scheduled' | 'sent' (or is inserted directly
 * into one of those, which cannot normally happen since insert always
 * starts at 'drafted'). A transition among any other statuses, or a status
 * that isn't changing, is never blocked by the DB trigger regardless of
 * opt-out state — this pre-check mirrors that exactly so it never reports
 * "blocked" more aggressively than the real gate would.
 */
const OPT_OUT_GATED_STATUSES: ReadonlySet<OutreachMessageStatus> = new Set([
  'approved',
  'scheduled',
  'sent',
])

export type OutreachOptOutCheckResult = { allowed: true } | { allowed: false; reason: string }

/**
 * Given a candidate's current communication_preferences.status for the
 * message's channel (null when no row exists yet, which the DB treats the
 * same as `not opted_out` — see the trigger's `v_status = 'opted_out'`
 * check, which is false for both 'opted_in'/'unknown' and no row at all),
 * and the status transition an application action is about to attempt,
 * determine whether the DB would allow it.
 */
export function checkOutreachOptOutGate(params: {
  channel: CommunicationChannel
  currentPreferenceStatus: CommunicationPreferenceStatus | null
  fromStatus: OutreachMessageStatus | null
  toStatus: OutreachMessageStatus
}): OutreachOptOutCheckResult {
  const { channel, currentPreferenceStatus, fromStatus, toStatus } = params

  // Mirrors the trigger's `tg_op = 'UPDATE' and new.status = old.status` no-op
  // exemption (an update that does not change status is never gated).
  if (fromStatus !== null && fromStatus === toStatus) {
    return { allowed: true }
  }

  if (!OPT_OUT_GATED_STATUSES.has(toStatus)) {
    return { allowed: true }
  }

  if (currentPreferenceStatus === 'opted_out') {
    return {
      allowed: false,
      reason: `This candidate has opted out of the ${channel} channel. Further automated communication on this channel is blocked until the candidate's preference is changed.`,
    }
  }

  return { allowed: true }
}
