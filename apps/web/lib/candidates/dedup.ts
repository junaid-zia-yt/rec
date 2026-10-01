import type { DuplicateCandidateSuggestion } from '@rqi/types'

/**
 * Deterministic candidate deduplication — Build Phase 5 brief
 * §"Deduplication". Pure, dependency-free module (no Supabase, no AI) so
 * every rule here is unit-testable without a live project.
 *
 * docs/07-data-model.md §7.4 describes a further fuzzy pass using pgvector
 * similarity over a name+work-history embedding — that requires an
 * embedding model call and is deliberately deferred to a later, AI-enabled
 * phase (this build's brief: "Do not implement AI CV parsing ... yet", and
 * no Anthropic key is configured in this environment regardless). This
 * module implements only the brief's two deterministic passes: exact
 * normalized email/phone/checksum matching, and a configurable, purely
 * string-based fuzzy name+company+location heuristic — never a suggestion
 * an LLM produced, and never anything that merges on its own.
 */

/** Lowercase + trim. Mirrors the generated `normalized_email` column in supabase/migrations/0018_candidates.sql exactly, so app-layer and DB-layer normalization can never drift. */
export function normalizeEmail(email: string | null | undefined): string | null {
  const trimmed = (email ?? '').trim().toLowerCase()
  return trimmed.length > 0 ? trimmed : null
}

/** Digits only. Mirrors the generated `normalized_phone` column in supabase/migrations/0018_candidates.sql exactly. */
export function normalizePhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/[^0-9]/g, '')
  return digits.length > 0 ? digits : null
}

/** Lowercase, trim, collapse internal whitespace — for the fuzzy name/company/location comparison only (never used for exact-match dedup, which uses normalizeEmail/normalizePhone). */
function normalizeForFuzzyCompare(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Token-overlap (Jaccard) similarity on whitespace-separated tokens — a
 * simple, deterministic, explainable string-similarity measure. Not
 * Levenshtein/edit-distance (which is sensitive to word order and typos
 * differently); token overlap suits "same person, name/company written in a
 * different order or with a middle initial" better for this use case.
 * Returns 0-1.
 */
function tokenOverlapSimilarity(a: string, b: string): number {
  const tokensA = new Set(normalizeForFuzzyCompare(a).split(' ').filter(Boolean))
  const tokensB = new Set(normalizeForFuzzyCompare(b).split(' ').filter(Boolean))
  if (tokensA.size === 0 && tokensB.size === 0) return 0
  if (tokensA.size === 0 || tokensB.size === 0) return 0

  let intersection = 0
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection += 1
  }
  const union = tokensA.size + tokensB.size - intersection
  return union === 0 ? 0 : intersection / union
}

export interface DedupCandidateInput {
  id: string
  fullName: string
  normalizedEmail: string | null
  normalizedPhone: string | null
  currentCompany: string | null
  location: string | null
  /** sha256 checksums of every document_uploads row for this candidate. */
  documentChecksums: string[]
}

export interface DedupConfig {
  /** Fuzzy name+company+location score at/above which a "possible duplicate" is suggested. Brief: "Configurable fuzzy ... suggestion" — this is the configuration point. */
  fuzzyThreshold: number
  /** Relative weights for the three fuzzy fields; must sum to 1. */
  weights: { name: number; company: number; location: number }
}

export const DEFAULT_DEDUP_CONFIG: DedupConfig = {
  fuzzyThreshold: 0.6,
  weights: { name: 0.6, company: 0.25, location: 0.15 },
}

/**
 * Compares one candidate (typically a newly-created or just-edited one)
 * against every other existing candidate in the same organization and
 * returns duplicate suggestions, most-confident first. Exact bases
 * (email/phone/checksum) always score 1 and are always reported even below
 * the fuzzy threshold — an exact match is never "maybe."
 *
 * Never merges anything — this is a read-only suggestion list. A merge
 * always requires an explicit human decision (see ./merge.ts).
 */
export function findDuplicateSuggestions(
  candidate: DedupCandidateInput,
  existingCandidates: DedupCandidateInput[],
  config: DedupConfig = DEFAULT_DEDUP_CONFIG,
): DuplicateCandidateSuggestion[] {
  const suggestions: DuplicateCandidateSuggestion[] = []

  for (const other of existingCandidates) {
    if (other.id === candidate.id) continue

    if (candidate.normalizedEmail && candidate.normalizedEmail === other.normalizedEmail) {
      suggestions.push({
        candidateId: candidate.id,
        matchedCandidateId: other.id,
        basis: 'exact_email',
        score: 1,
      })
      continue
    }

    if (candidate.normalizedPhone && candidate.normalizedPhone === other.normalizedPhone) {
      suggestions.push({
        candidateId: candidate.id,
        matchedCandidateId: other.id,
        basis: 'exact_phone',
        score: 1,
      })
      continue
    }

    const sharedChecksum = candidate.documentChecksums.find((c) =>
      other.documentChecksums.includes(c),
    )
    if (sharedChecksum) {
      suggestions.push({
        candidateId: candidate.id,
        matchedCandidateId: other.id,
        basis: 'document_checksum',
        score: 1,
      })
      continue
    }

    const nameScore = tokenOverlapSimilarity(candidate.fullName, other.fullName)
    const companyScore = tokenOverlapSimilarity(
      candidate.currentCompany ?? '',
      other.currentCompany ?? '',
    )
    const locationScore = tokenOverlapSimilarity(candidate.location ?? '', other.location ?? '')
    const combined =
      nameScore * config.weights.name +
      companyScore * config.weights.company +
      locationScore * config.weights.location

    if (combined >= config.fuzzyThreshold) {
      suggestions.push({
        candidateId: candidate.id,
        matchedCandidateId: other.id,
        basis: 'fuzzy',
        score: Math.round(combined * 1000) / 1000,
      })
    }
  }

  return suggestions.sort((a, b) => b.score - a.score)
}
