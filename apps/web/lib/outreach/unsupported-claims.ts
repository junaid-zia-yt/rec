/**
 * Deterministic enforcement of Build Phase 9 brief functional requirement
 * #5, "Prevent unsupported claims." An AI outreach draft (lib/ai/
 * outreach-draft-provider.ts) self-reports which evidence backs each
 * personalized claim it makes (OutreachDraftEvidenceRef[]), but the AI's
 * own self-report is never trusted blindly — this module deterministically
 * checks every one of those references against the candidate's real,
 * already-verified evidence bundle (the exact same
 * CandidateEvidenceBundleItem[] produced by apps/web/lib/matching/
 * evidence-bundle.ts's buildCandidateEvidenceBundle, which already only
 * includes verified/accepted candidate data — see that file's module
 * comment) before a draft may ever be persisted or shown to a reviewer as
 * evidence-backed.
 *
 * Pure, synchronous, no DB/network I/O — unit-testable in isolation.
 */

import type { OutreachDraftEvidenceRef } from '@/lib/ai/outreach-draft-provider'
import type { CandidateEvidenceBundleItem } from '@/lib/ai/matching-provider'

export type UnsupportedClaimsValidationResult = { valid: true } | { valid: false; issues: string[] }

/**
 * An evidence bundle item is matched by (sourceKind, sourceId) pair — the
 * same identity buildCandidateEvidenceBundle assigns each item. A 'profile'
 * item always has sourceId null (there is exactly one profile per
 * candidate), so two 'profile' items are considered the same identity;
 * every other sourceKind carries a real row id.
 */
function evidenceIdentity(sourceKind: string, sourceId: string | null): string {
  return `${sourceKind}:${sourceId ?? '(profile)'}`
}

/**
 * Checks that every OutreachDraftEvidenceRef in a draft's
 * personalizationEvidence array:
 *   1. references a (sourceKind, sourceId) pair that actually exists in the
 *      candidate's real, verified evidence bundle (never a fabricated or
 *      stale id), and
 *   2. quotes an evidenceExcerpt that is genuinely contained in that real
 *      bundle item's text (never a fabricated excerpt — mirrors the "never
 *      fabricate an excerpt" rule already enforced by prompting in
 *      outreach-draft-prompt.ts; this is the deterministic backstop for it).
 *
 * Every item returned by buildCandidateEvidenceBundle is, by that
 * function's own contract, already restricted to verified/accepted
 * candidate data (verificationStatus 'verified'/'edited' for extracted
 * fields; accepted rows for everything else) — so "exists in the bundle"
 * and "is verified" are the same check here. A caller that has a reason to
 * pass a bundle containing not-yet-verified items must filter it before
 * calling this function; this function does not re-derive verification
 * status itself.
 *
 * An empty personalizationEvidence array (a fully generic draft,
 * `wroteGenerically: true`) is always valid — no claims to check.
 */
export function validateOutreachDraftEvidence(params: {
  personalizationEvidence: OutreachDraftEvidenceRef[]
  verifiedEvidenceBundle: CandidateEvidenceBundleItem[]
}): UnsupportedClaimsValidationResult {
  const { personalizationEvidence, verifiedEvidenceBundle } = params

  if (personalizationEvidence.length === 0) {
    return { valid: true }
  }

  const bundleByIdentity = new Map<string, CandidateEvidenceBundleItem[]>()
  for (const item of verifiedEvidenceBundle) {
    const key = evidenceIdentity(item.sourceKind, item.sourceId)
    const existing = bundleByIdentity.get(key)
    if (existing) {
      existing.push(item)
    } else {
      bundleByIdentity.set(key, [item])
    }
  }

  const issues: string[] = []

  personalizationEvidence.forEach((ref, index) => {
    const key = evidenceIdentity(ref.sourceKind, ref.sourceId)
    const candidates = bundleByIdentity.get(key)

    if (!candidates || candidates.length === 0) {
      issues.push(
        `personalizationEvidence[${index}]: cites ${key}, which does not exist in the candidate's verified evidence bundle (rejected — cannot cite unverified or non-existent evidence).`,
      )
      return
    }

    const excerpt = ref.evidenceExcerpt.trim()
    const excerptFound =
      excerpt.length > 0 && candidates.some((item) => item.text.includes(excerpt))

    if (!excerptFound) {
      issues.push(
        `personalizationEvidence[${index}]: evidenceExcerpt for ${key} is not found verbatim in that evidence item's text (rejected — the excerpt may be fabricated or paraphrased).`,
      )
    }
  })

  if (issues.length > 0) {
    return { valid: false, issues }
  }

  return { valid: true }
}
