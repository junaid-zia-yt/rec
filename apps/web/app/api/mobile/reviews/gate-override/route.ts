import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { GateResult } from '@rqi/types'
import { authenticateMobileRequest } from '@/lib/auth/mobile-session'
import { requirePermission } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit/log'
import { deriveEligibility } from '@/lib/matching/gates'
import { computeRawWeightedScoreForOverride } from '@/lib/matching/evaluate'

/**
 * POST /api/mobile/reviews/gate-override — Build Phase 13 Wave 1.
 *
 * Mirrors `overrideMandatoryGateAction`
 * (apps/web/lib/matching/matching-actions.ts) exactly: same Zod shape,
 * same 'human_reviews'/'update' gate, same eligibility-recompute-from-
 * every-gate's-effective-result logic, same audit action. No
 * `revalidatePath` call (that is a Next.js page-cache primitive with no
 * meaning for a JSON API — intentionally omitted).
 *
 * Request body:
 * {
 *   organizationId: string (uuid)
 *   candidateId: string (uuid)
 *   candidateRoleMatchId: string (uuid)
 *   gateResultId: string (uuid)
 *   overrideResult: 'pass' | 'fail'
 *   reason: string (1-2000 chars)
 *   evidenceNote: string (1-2000 chars)
 * }
 *
 * Response:
 * { success: true, data: { gateResultId, eligibility, overallScore } }
 * { success: false, error: string }
 */
const OverrideGateSchema = z.object({
  organizationId: z.string().uuid(),
  candidateId: z.string().uuid(),
  candidateRoleMatchId: z.string().uuid(),
  gateResultId: z.string().uuid(),
  overrideResult: z.enum(['pass', 'fail']),
  reason: z.string().trim().min(1, 'A reason is required to override a mandatory gate.').max(2000),
  evidenceNote: z
    .string()
    .trim()
    .min(1, 'Supporting evidence is required to override a mandatory gate.')
    .max(2000),
})

export async function POST(request: Request) {
  const auth = await authenticateMobileRequest(request)
  if ('error' in auth) return auth.error
  const { user, supabase } = auth

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body.' }, { status: 400 })
  }

  const parsed = OverrideGateSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: parsed.error.issues[0]?.message ?? 'Check the request body and try again.',
      },
      { status: 400 },
    )
  }

  try {
    await requirePermission(
      user.id,
      parsed.data.organizationId,
      'human_reviews',
      'update',
      supabase,
    )
  } catch {
    return NextResponse.json(
      { success: false, error: 'You do not have permission to perform this action.' },
      { status: 403 },
    )
  }

  const overrideAt = new Date().toISOString()

  const { data: gate, error: gateError } = await supabase
    .from('mandatory_gate_results')
    .update({
      state: 'human_override',
      override_result: parsed.data.overrideResult,
      override_by: user.id,
      override_reason: parsed.data.reason,
      override_evidence_note: parsed.data.evidenceNote,
      override_at: overrideAt,
    })
    .eq('id', parsed.data.gateResultId)
    .eq('organization_id', parsed.data.organizationId)
    .select('id, requirement_id, deterministic_result, override_result')
    .single()

  if (gateError || !gate) {
    return NextResponse.json(
      { success: false, error: 'Could not record the override.' },
      { status: 400 },
    )
  }

  const { data: matchForReview } = await supabase
    .from('candidate_role_matches')
    .select('latest_matching_run_id')
    .eq('id', parsed.data.candidateRoleMatchId)
    .single()

  if (!matchForReview) {
    return NextResponse.json(
      { success: false, error: 'Could not find the match record for this override.' },
      { status: 404 },
    )
  }

  await supabase.from('human_reviews').insert({
    organization_id: parsed.data.organizationId,
    candidate_role_match_id: parsed.data.candidateRoleMatchId,
    matching_run_id: matchForReview.latest_matching_run_id,
    reviewer_id: user.id,
    decision: 'gate_overridden',
    reason: parsed.data.reason,
  })

  const { data: humanReview } = await supabase
    .from('human_reviews')
    .select('id')
    .eq('candidate_role_match_id', parsed.data.candidateRoleMatchId)
    .eq('reviewer_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (humanReview) {
    await supabase.from('review_decisions').insert({
      organization_id: parsed.data.organizationId,
      human_review_id: humanReview.id,
      field: `gate:${gate.requirement_id}`,
      before_value: { deterministicResult: gate.deterministic_result },
      after_value: { overrideResult: gate.override_result },
      reason: parsed.data.reason,
    })
  }

  const { data: allGates } = await supabase
    .from('mandatory_gate_results')
    .select('deterministic_result, override_result')
    .eq('candidate_role_match_id', parsed.data.candidateRoleMatchId)

  const effectiveResults: GateResult[] = (allGates ?? []).map(
    (row) => (row.override_result as GateResult | null) ?? (row.deterministic_result as GateResult),
  )
  const eligibility = deriveEligibility(effectiveResults)

  let overallScore: number | null = null
  if (eligibility === 'eligible') {
    const { data: breakdowns } = await supabase
      .from('scoring_breakdowns')
      .select(
        'requirement_id, requirement_name, weight, raw_score, confidence_discount, effective_score, weighted_contribution, has_evidence',
      )
      .eq('candidate_role_match_id', parsed.data.candidateRoleMatchId)

    overallScore = computeRawWeightedScoreForOverride(
      (breakdowns ?? []).map((row) => ({
        requirementId: row.requirement_id,
        requirementName: row.requirement_name,
        weight: row.weight,
        rawScore: row.raw_score,
        confidenceDiscount: row.confidence_discount,
        effectiveScore: row.effective_score,
        weightedContribution: row.weighted_contribution,
        hasEvidence: row.has_evidence,
      })),
    )
  }

  await supabase
    .from('candidate_role_matches')
    .update({ eligibility, overall_score: overallScore })
    .eq('id', parsed.data.candidateRoleMatchId)
    .eq('organization_id', parsed.data.organizationId)

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'candidate_match.gate_overridden',
      entityType: 'mandatory_gate_results',
      entityId: parsed.data.gateResultId,
      metadata: {
        overrideResult: parsed.data.overrideResult,
        reason: parsed.data.reason,
        resultingEligibility: eligibility,
      },
    },
    supabase,
  )

  return NextResponse.json({
    success: true,
    data: { gateResultId: parsed.data.gateResultId, eligibility, overallScore },
  })
}
