import 'server-only'
import {
  DEFAULT_PREFERRED_SHORTLIST_THRESHOLD_PCT,
  DEFAULT_RANKED_CONSIDERATION_THRESHOLD_PCT,
} from '@rqi/types'

/**
 * Resolves this scorecard's quality thresholds — a nullable per-scorecard
 * override falls back to the system default (Build Phase 7 brief
 * §"Quality thresholds": "Use configurable defaults... Do not hardcode
 * these globally"). This is the ONE place either number is read; nothing
 * else in the matching pipeline references the DEFAULT_* constants or a
 * literal 90/95 directly.
 */
export interface ResolvedQualityThresholds {
  rankedConsiderationThresholdPct: number
  preferredShortlistThresholdPct: number
}

export function resolveQualityThresholds(scorecard: {
  rankedConsiderationThresholdPct: number | null
  preferredShortlistThresholdPct: number | null
}): ResolvedQualityThresholds {
  return {
    rankedConsiderationThresholdPct:
      scorecard.rankedConsiderationThresholdPct ?? DEFAULT_RANKED_CONSIDERATION_THRESHOLD_PCT,
    preferredShortlistThresholdPct:
      scorecard.preferredShortlistThresholdPct ?? DEFAULT_PREFERRED_SHORTLIST_THRESHOLD_PCT,
  }
}

export type QualityTier =
  'preferred_shortlist' | 'ranked_consideration' | 'below_threshold' | 'not_eligible'

/** Classifies an already-computed (eligibility-gated) overall score against the resolved thresholds. A null score (ineligible/unresolved candidate) is always 'not_eligible', never silently compared as if it were 0. */
export function classifyByQualityThreshold(
  overallScore: number | null,
  thresholds: ResolvedQualityThresholds,
): QualityTier {
  if (overallScore === null) return 'not_eligible'
  if (overallScore >= thresholds.preferredShortlistThresholdPct) return 'preferred_shortlist'
  if (overallScore >= thresholds.rankedConsiderationThresholdPct) return 'ranked_consideration'
  return 'below_threshold'
}
