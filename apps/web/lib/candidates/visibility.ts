import type {
  CandidateProfile,
  ClientVisibleCandidateProfile,
  ContactPointType,
  Role,
} from '@rqi/types'

/**
 * Application-layer visibility/masking rules — Build Phase 5 brief
 * §PRIVACY: "Mask contact information for unauthorized roles", "Restrict
 * client reviewers to shortlisted or explicitly shared candidates" (the row-
 * level half of that lives in supabase/migrations/0021_candidate_pipeline.sql's
 * can_access_candidate()), "Separate recruiter notes from client-visible
 * notes."
 *
 * Row Level Security is row-level only — it can allow or deny a whole row,
 * never reshape or redact individual column values. Masking and note
 * separation are therefore necessarily an application-layer concern, and
 * this module is the single place that concern lives, so every screen and
 * server action applies it identically rather than each reimplementing its
 * own redaction.
 */

/**
 * Roles that see full, unmasked contact information for a candidate they
 * otherwise have row access to. Deliberately excludes read_only_reviewer
 * (read-only + no operational need to contact candidates directly) and
 * client_decision_maker (never contacts a candidate directly — outreach is
 * always run by the agency) — a decision recorded here, not left implicit.
 */
const UNMASKED_CONTACT_ROLES: Role[] = ['platform_admin', 'agency_admin', 'recruiter']

export function canViewUnmaskedContact(role: Role): boolean {
  return UNMASKED_CONTACT_ROLES.includes(role)
}

/** Masks a contact value for a role not in UNMASKED_CONTACT_ROLES — e.g. "j***@example.com" or "***-***-4567". Never returns the original value for a masked role. */
export function maskContactValue(type: ContactPointType, value: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) return trimmed

  if (type === 'email') {
    const atIndex = trimmed.indexOf('@')
    if (atIndex <= 0) return '***'
    const local = trimmed.slice(0, atIndex)
    const domain = trimmed.slice(atIndex)
    return `${local[0]}${'*'.repeat(Math.max(local.length - 1, 1))}${domain}`
  }

  if (type === 'phone') {
    const digits = trimmed.replace(/[^0-9]/g, '')
    if (digits.length <= 4) return '*'.repeat(digits.length)
    const lastFour = digits.slice(-4)
    return `${'*'.repeat(digits.length - 4)}${lastFour}`
  }

  // linkedin/other: mask everything but a short recognizable prefix.
  return trimmed.length <= 4
    ? '*'.repeat(trimmed.length)
    : `${trimmed.slice(0, 4)}${'*'.repeat(trimmed.length - 4)}`
}

/** Applies maskContactValue only when the role requires it — the single call site every screen/action should use instead of branching on canViewUnmaskedContact itself. */
export function contactValueForRole(role: Role, type: ContactPointType, value: string): string {
  return canViewUnmaskedContact(role) ? value : maskContactValue(type, value)
}

/**
 * Roles that may see recruiter_notes at all. Every other role — most
 * importantly client_decision_maker — gets clientVisibleNotes only,
 * recruiterNotes omitted entirely from the returned object (not nulled —
 * `in` / `Object.keys` checks on the result correctly show the field is
 * simply not there).
 */
const RECRUITER_NOTES_VISIBLE_ROLES: Role[] = [
  'platform_admin',
  'agency_admin',
  'recruiter',
  'read_only_reviewer',
]

export function serializeCandidateProfileForRole(
  profile: CandidateProfile,
  role: Role,
): CandidateProfile | ClientVisibleCandidateProfile {
  if (RECRUITER_NOTES_VISIBLE_ROLES.includes(role)) return profile

  const { recruiterNotes: _recruiterNotes, ...clientSafe } = profile
  return clientSafe
}
