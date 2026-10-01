import type { CopilotDataClassification } from '@rqi/types'

/**
 * Build Phase 11, Wave 2 — field-level redaction of recruiter-only content
 * before it can ever reach a prompt-construction step (governing brief:
 * "redact unauthorized fields before model access").
 *
 * RLS is row-level only (0031's "HIDDEN RECRUITER NOTES" header note, and
 * apps/web/lib/candidates/visibility.ts's own module comment) — column-
 * level redaction is necessarily an application-layer concern, and this is
 * the copilot's single place for it, mirroring
 * `serializeCandidateProfileForRole` exactly rather than reinventing the
 * rule: a `client_decision_maker` conversation is a
 * `data_classification: 'restricted_notes_excluded'` conversation
 * (DB-CHECK-enforced, 0031), and that classification means every recruiter-
 * only field below is stripped from every record before it is placed into
 * any tool output a prompt could later read — never merely nulled (a caller
 * checking `'recruiterNotes' in record` must see the field is simply
 * absent, same convention as visibility.ts).
 */

/**
 * Every known recruiter-only / internal-only annotation field this wave
 * found across the schema, grepped for "recruiter_note"/"internal"/
 * "private" per the task brief. Grouped by the resource shape it appears
 * on so `redactForClassification` can be called generically and each
 * specific redactor below can document exactly which fields it strips.
 *
 *   - candidate_profiles.recruiter_notes (0018) — vs. client_visible_notes,
 *     the field 0031's header note names explicitly.
 *   - shortlist_candidates.recruiter_note (0028) — that table's own
 *     comment: "never returned to a client_decision_maker caller".
 *   - human_reviews.reason / review_decisions detail — internal reviewer
 *     reasoning, never client-facing (docs/06-roles-permissions.md §6.2.3;
 *     human_reviews resource-level grant is client_decision_maker: 'none'
 *     entirely, so a client-classified conversation must never surface a
 *     human_reviews row's content at all, not just its reason field — see
 *     `redactCandidateMatchRecord`, which drops the whole reviewerNote
 *     concept rather than partially redacting it).
 */
export const RECRUITER_ONLY_CANDIDATE_PROFILE_FIELDS = ['recruiterNotes'] as const
export const RECRUITER_ONLY_SHORTLIST_CANDIDATE_FIELDS = ['recruiterNote'] as const
export const RECRUITER_ONLY_CANDIDATE_MATCH_FIELDS = ['reviewerNote', 'humanReviewReason'] as const

/**
 * Generic redactor: strips `fields` from `record` entirely (delete, not
 * null) whenever `classification` is `'restricted_notes_excluded'`. A
 * `'standard'` classification (recruiter/admin conversations) returns the
 * record unchanged. Pure, synchronous, no I/O — every specific redactor
 * below is a thin, typed call to this function so the actual stripping
 * logic exists in exactly one place.
 */
export function redactForClassification<T extends Record<string, unknown>>(
  record: T,
  fields: readonly (keyof T)[],
  classification: CopilotDataClassification,
): Partial<T> {
  if (classification === 'standard') return record
  const copy: Partial<T> = { ...record }
  for (const field of fields) {
    delete copy[field]
  }
  return copy
}

/** Same as `redactForClassification`, applied to every element of an array. */
export function redactArrayForClassification<T extends Record<string, unknown>>(
  records: readonly T[],
  fields: readonly (keyof T)[],
  classification: CopilotDataClassification,
): Partial<T>[] {
  return records.map((record) => redactForClassification(record, fields, classification))
}

export interface RedactableCandidateProfile extends Record<string, unknown> {
  recruiterNotes?: string | null
}

/** `candidate_profiles.recruiter_notes` — the field 0031's "HIDDEN RECRUITER NOTES" header note names explicitly as this wave's job to redact. */
export function redactCandidateProfile<T extends RedactableCandidateProfile>(
  profile: T,
  classification: CopilotDataClassification,
): Partial<T> {
  return redactForClassification(
    profile,
    RECRUITER_ONLY_CANDIDATE_PROFILE_FIELDS as readonly (keyof T)[],
    classification,
  )
}

export interface RedactableShortlistCandidate extends Record<string, unknown> {
  recruiterNote?: string | null
}

/** `shortlist_candidates.recruiter_note` — that table's own migration comment already documents this exact "never returned to a client_decision_maker caller" rule; this is where it is actually enforced in code. */
export function redactShortlistCandidate<T extends RedactableShortlistCandidate>(
  candidate: T,
  classification: CopilotDataClassification,
): Partial<T> {
  return redactForClassification(
    candidate,
    RECRUITER_ONLY_SHORTLIST_CANDIDATE_FIELDS as readonly (keyof T)[],
    classification,
  )
}

export function redactShortlistCandidates<T extends RedactableShortlistCandidate>(
  candidates: readonly T[],
  classification: CopilotDataClassification,
): Partial<T>[] {
  return candidates.map((c) => redactShortlistCandidate(c, classification))
}

export interface RedactableCandidateMatchDetail extends Record<string, unknown> {
  reviewerNote?: string | null
  humanReviewReason?: string | null
}

/**
 * `human_reviews.reason` / review-decision internal notes attached to a
 * candidate_role_match. Whole-field drop, same pattern as the others — see
 * this module's header note on why `human_reviews` is excluded entirely
 * (not partially) from a restricted-classification conversation's context.
 */
export function redactCandidateMatchDetail<T extends RedactableCandidateMatchDetail>(
  detail: T,
  classification: CopilotDataClassification,
): Partial<T> {
  return redactForClassification(
    detail,
    RECRUITER_ONLY_CANDIDATE_MATCH_FIELDS as readonly (keyof T)[],
    classification,
  )
}

/**
 * True when `classification` means recruiter-only sources (human_reviews
 * rows, recruiter notes, any not-client-shared annotation) must be excluded
 * from retrieval ENTIRELY, not merely field-redacted after the fact — use
 * this to skip a whole query (e.g. never even SELECT human_reviews at all)
 * rather than fetch-then-strip when the source itself is recruiter-only in
 * its entirety.
 */
export function excludesRecruiterOnlySources(classification: CopilotDataClassification): boolean {
  return classification === 'restricted_notes_excluded'
}
