import 'server-only'
import type { FrozenRequirement, MatchingErrorKind } from '@rqi/types'
import type {
  CandidateEvidenceBundleItem,
  MatchingAIProvider,
  TrustedMatchingContext,
} from '@/lib/ai/matching-provider'
import {
  runMatchingAssessment,
  type MatchingAssessmentOutcome,
} from '@/lib/ai/run-matching-assessment'
import { computeDeterministicMatchResult, type DeterministicMatchResult } from './evaluate'

/**
 * Pure orchestration of the FULL matching pipeline (Build Phase 7 brief
 * §MATCHING PIPELINE steps 5-9: retrieve evidence [caller-supplied, already
 * assembled by evidence-bundle.ts] -> call AI for semantic relevance ->
 * validate -> compute deterministic gates/score/coverage). No database —
 * steps 1 ("freeze the scorecard version"), 10 ("present for human
 * review") and 11 ("store the complete versioned evaluation") are all I/O
 * and belong to the caller (apps/web/lib/matching/matching-actions.ts),
 * exactly the same separation Build Phase 6 drew between
 * document-processing-pipeline.ts (pure) and document-processing-
 * actions.ts (I/O).
 */
export interface MatchingPipelineResult {
  status: 'completed' | 'failed'
  errorKind: MatchingErrorKind | null
  errorMessage: string | null
  ai: MatchingAssessmentOutcome
  deterministic: DeterministicMatchResult | null
}

function classifyAiErrorKind(ai: MatchingAssessmentOutcome): MatchingErrorKind {
  if (ai.status === 'not_configured') return 'ai_not_configured'
  if (ai.status === 'rejected_by_validation') return 'validation_failed'
  if (ai.errorMessage?.toLowerCase().includes('timed out')) return 'timeout'
  if (ai.errorMessage?.toLowerCase().includes('reach the ai provider')) return 'network'
  return 'provider_error'
}

export async function runMatchingPipeline(params: {
  jobTitle: string
  requirements: FrozenRequirement[]
  candidateEvidence: CandidateEvidenceBundleItem[]
  aiProvider?: MatchingAIProvider
}): Promise<MatchingPipelineResult> {
  const trustedContext: TrustedMatchingContext = {
    jobTitle: params.jobTitle,
    requirements: params.requirements.map((requirement) => ({
      requirementId: requirement.requirementId,
      name: requirement.name,
      description: '',
      evidenceExpected: '',
      type: requirement.type,
      weight: requirement.weight,
    })),
  }

  const ai = await runMatchingAssessment({
    trustedContext,
    candidateEvidence: params.candidateEvidence,
    provider: params.aiProvider,
  })

  if (ai.status !== 'success' || !ai.validated) {
    return {
      status: 'failed',
      errorKind: classifyAiErrorKind(ai),
      errorMessage: ai.errorMessage,
      ai,
      deterministic: null,
    }
  }

  const deterministic = computeDeterministicMatchResult({
    requirements: params.requirements,
    assessments: ai.validated.assessments,
  })

  return { status: 'completed', errorKind: null, errorMessage: null, ai, deterministic }
}
