import 'server-only'
import type {
  ClientSafeShortlistCandidate,
  ShortlistActivityEntry,
  ShortlistCandidate,
} from '@rqi/types'

/**
 * Application-layer visibility/masking rules for the client-review surface
 * (Build Phase 8 brief §"Client decisions": "restrict visibility to
 * client-safe fields"; §UI: "Do not expose private recruiter notes to
 * clients"). Mirrors apps/web/lib/candidates/visibility.ts's established
 * pattern exactly: Row Level Security is row-level only, so column-level
 * redaction is necessarily an application-layer concern, and this module is
 * the single place it lives for the shortlist domain — every screen and
 * server action serving a client_decision_maker caller goes through it
 * rather than each reimplementing its own redaction.
 */

/** Strips recruiterNote. Not a null-out — the field is omitted entirely, so an `in`/`Object.keys` check on the result correctly shows it is simply not there. */
export function serializeShortlistCandidateForClient(
  candidate: ShortlistCandidate,
): ClientSafeShortlistCandidate {
  const { recruiterNote: _recruiterNote, ...clientSafe } = candidate
  return clientSafe
}

export function serializeShortlistCandidatesForClient(
  candidates: ShortlistCandidate[],
): ClientSafeShortlistCandidate[] {
  return candidates.map(serializeShortlistCandidateForClient)
}

/** Only clientVisible = true rows are ever returned — internal recruiter reasoning, overrides, and notes default to false at write time and stay agency-internal (mirrors the RLS policy in supabase/migrations/0028, applied again here since a caller may aggregate rows from multiple sources before rendering). */
export function filterShortlistActivityForClient(
  entries: ShortlistActivityEntry[],
): ShortlistActivityEntry[] {
  return entries.filter((entry) => entry.clientVisible)
}
