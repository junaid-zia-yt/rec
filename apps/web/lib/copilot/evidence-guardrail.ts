/**
 * Build Phase 11, Wave 2 — the copilot-specific equivalent of Phase 9's
 * `apps/web/lib/outreach/unsupported-claims.ts`. Governing brief: "AI must
 * never invent evidence." An eventual copilot response (wave 3's job) will
 * self-report which authorized records back each factual claim it makes
 * about a candidate — that self-report is never trusted blindly, exactly
 * like the outreach draft's `personalizationEvidence`. This module
 * deterministically checks every claimed citation against the set of
 * records THIS TURN'S tool calls actually returned (the "authorized
 * records" the brief's citation mechanism refers to — CopilotCitationSchema
 * in packages/types), never against some other, wider notion of "anything
 * in the database".
 *
 * Pure, synchronous, no DB/network I/O — unit-testable in isolation, same
 * convention as unsupported-claims.ts.
 */

import type { CopilotCitation } from '@rqi/types'

export type CopilotEvidenceValidationResult = { valid: true } | { valid: false; issues: string[] }

/** One claim the eventual AI response makes, paired with the citation it self-reports as its support. Wave 3 constructs these from the model's structured output; this module never parses free text itself. */
export interface CopilotClaimWithCitation {
  /** A short description of the claim, for the issues list only (e.g. "candidate has 5 years' retail management experience"). */
  claimText: string
  citation: CopilotCitation
}

function citationIdentity(citation: Pick<CopilotCitation, 'kind' | 'id'>): string {
  return `${citation.kind}:${citation.id}`
}

/**
 * Checks that every claim's citation:
 *   1. references an (kind, id) pair that actually exists among the
 *      records this turn's tool calls returned as `authorizedRecords`
 *      (never a fabricated or stale id, never a record from a DIFFERENT
 *      turn or a different, unauthorized resource), and
 *   2. when the citation carries a non-null `excerpt`, that excerpt is
 *      genuinely contained in that authorized record's own text (never a
 *      fabricated or paraphrased excerpt — mirrors
 *      `validateOutreachDraftEvidence`'s identical rule).
 *
 * `authorizedRecords` must already be the REDACTED, ownership-validated
 * output of this turn's tool calls (see redaction.ts / resource-
 * ownership.ts) — this function does not itself check redaction or
 * ownership, only that a citation is not fabricated relative to what was
 * actually, legitimately retrieved.
 */
export function validateCopilotEvidenceCitations(params: {
  claims: CopilotClaimWithCitation[]
  authorizedRecords: CopilotCitation[]
}): CopilotEvidenceValidationResult {
  const { claims, authorizedRecords } = params

  if (claims.length === 0) return { valid: true }

  const byIdentity = new Map<string, CopilotCitation[]>()
  for (const record of authorizedRecords) {
    const key = citationIdentity(record)
    const existing = byIdentity.get(key)
    if (existing) existing.push(record)
    else byIdentity.set(key, [record])
  }

  const issues: string[] = []

  claims.forEach((claim, index) => {
    const key = citationIdentity(claim.citation)
    const candidates = byIdentity.get(key)

    if (!candidates || candidates.length === 0) {
      issues.push(
        `claims[${index}] ("${claim.claimText}"): cites ${key}, which is not among this turn's authorized records (rejected — cannot cite unauthorized, unretrieved, or invented evidence).`,
      )
      return
    }

    const claimedExcerpt = claim.citation.excerpt?.trim() ?? null
    if (claimedExcerpt === null) return // A citation with no excerpt (e.g. "the whole record") needs no excerpt match.

    const excerptFound =
      claimedExcerpt.length > 0 &&
      candidates.some((record) => (record.excerpt ?? '').includes(claimedExcerpt))
    if (!excerptFound) {
      issues.push(
        `claims[${index}] ("${claim.claimText}"): excerpt for ${key} is not found verbatim in that record's authorized excerpt (rejected — the excerpt may be fabricated or paraphrased).`,
      )
    }
  })

  if (issues.length > 0) return { valid: false, issues }
  return { valid: true }
}

/**
 * A response with zero citations is not automatically invalid — a purely
 * procedural answer ("here is how to submit a shortlist") makes no factual
 * candidate/evidence claim at all. This helper exists only so wave 3's
 * orchestration code has one canonical place to express "does this response
 * make any evidence-backed claim", rather than re-deriving it from
 * `claims.length` inline at every call site.
 */
export function copilotResponseMakesEvidenceClaims(claims: CopilotClaimWithCitation[]): boolean {
  return claims.length > 0
}
