import 'server-only'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import type {
  CandidateProjectEntry,
  CandidateResponse,
  CandidateRoleMatch,
  ClientDecisionRecord,
  MetricDefinition,
  OutreachMessage,
  PocBaseline,
  PocBenchmark,
  PocDecision,
  PocExclusion,
  PocMetricDataPoint,
  PocParticipant,
  PocResult,
  PocRole,
  ShortlistCandidate,
} from '@rqi/types'
import {
  compareRoleBenchmark,
  type RoleBenchmarkData,
  type RoleComparisonResult,
} from './compare-benchmark'

/**
 * Build Phase 10, Wave 3 — one-benchmark deep loader. Loads a poc_benchmarks
 * row plus every poc_roles/poc_participants/poc_baselines/poc_metrics/
 * poc_exclusions/poc_decisions row scoped to it, builds each role's
 * RoleBenchmarkData (wave 2's compare-benchmark.ts contract) by ALSO
 * pulling in whatever live platform tables (candidate_role_matches,
 * candidate_project_entries, shortlist_candidates, client_decisions,
 * outreach_messages, candidate_responses) the wave-2 calculators read, and
 * runs compareRoleBenchmark() server-side so the report UI always renders a
 * live-computed comparison rather than only whatever was last persisted to
 * poc_results.
 */

export interface PocRoleParticipantInfo {
  id: string
  status: PocParticipant['status']
  shortlistId: string | null
  startedAt: string | null
  completedAt: string | null
}

export interface PocRoleDetail {
  role: PocRole
  jobTitle: string
  clientBaselineParticipant: PocRoleParticipantInfo | null
  vendorAssistedParticipant: PocRoleParticipantInfo | null
  latestClientBaseline: PocBaseline | null
  baselineHistory: PocBaseline[]
  dataPointHistory: PocMetricDataPoint[]
  exclusions: PocExclusion[]
  persistedResults: PocResult[]
  comparison: RoleComparisonResult
}

export interface PocBenchmarkDetail {
  benchmark: PocBenchmark
  clientName: string
  roles: PocRoleDetail[]
  currentDecision: PocDecision | null
  decisionHistory: PocDecision[]
}

function mapBenchmark(row: Record<string, unknown>): PocBenchmark {
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    clientId: row.client_id as string,
    name: row.name as string,
    status: row.status as PocBenchmark['status'],
    startTime: row.start_time as string | null,
    searchBoundaries: (row.search_boundaries as Record<string, unknown>) ?? {},
    notes: row.notes as string | null,
    createdBy: row.created_by as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

function mapRole(row: Record<string, unknown>): PocRole {
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    pocBenchmarkId: row.poc_benchmark_id as string,
    jobId: row.job_id as string,
    recruitmentProjectId: row.recruitment_project_id as string,
    roleType: row.role_type as PocRole['roleType'],
    label: row.label as string | null,
    notes: row.notes as string | null,
    createdBy: row.created_by as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

function mapBaseline(row: Record<string, unknown>): PocBaseline {
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    pocBenchmarkId: row.poc_benchmark_id as string,
    pocRoleId: row.poc_role_id as string,
    pocParticipantId: row.poc_participant_id as string,
    candidatesSourcedCount: row.candidates_sourced_count as number | null,
    candidatesReviewedCount: row.candidates_reviewed_count as number | null,
    shortlistCandidateCount: row.shortlist_candidate_count as number | null,
    timeToFirstQualifiedHours: row.time_to_first_qualified_hours as number | null,
    timeToShortlistHours: row.time_to_shortlist_hours as number | null,
    recruiterHoursSpent: row.recruiter_hours_spent as number | null,
    reportedByUserId: row.reported_by_user_id as string | null,
    reportedByLabel: row.reported_by_label as string | null,
    notes: row.notes as string | null,
    correctionOfBaselineId: row.correction_of_baseline_id as string | null,
    createdBy: row.created_by as string | null,
    createdAt: row.created_at as string,
  }
}

function mapDataPoint(row: Record<string, unknown>): PocMetricDataPoint {
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    pocBenchmarkId: row.poc_benchmark_id as string,
    pocRoleId: row.poc_role_id as string,
    pocParticipantId: row.poc_participant_id as string,
    metricDefinitionId: row.metric_definition_id as string,
    metricDefinitionVersion: row.metric_definition_version as number,
    dataPointKey: row.data_point_key as string,
    valueNumeric: row.value_numeric as number | null,
    valueText: row.value_text as string | null,
    valueJsonb: row.value_jsonb as Record<string, unknown> | null,
    unit: row.unit as PocMetricDataPoint['unit'],
    source: row.source as PocMetricDataPoint['source'],
    supersedesMetricId: row.supersedes_metric_id as string | null,
    notes: row.notes as string | null,
    recordedBy: row.recorded_by as string | null,
    recordedAt: row.recorded_at as string,
    createdAt: row.created_at as string,
  }
}

function mapExclusion(row: Record<string, unknown>): PocExclusion {
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    pocBenchmarkId: row.poc_benchmark_id as string,
    pocRoleId: row.poc_role_id as string,
    candidateId: row.candidate_id as string | null,
    candidateReferenceLabel: row.candidate_reference_label as string | null,
    side: row.side as PocExclusion['side'],
    exclusionType: row.exclusion_type as PocExclusion['exclusionType'],
    reason: row.reason as string,
    stillCountsTowardSpeed: row.still_counts_toward_speed as boolean,
    reversesExclusionId: row.reverses_exclusion_id as string | null,
    excludedBy: row.excluded_by as string,
    excludedAt: row.excluded_at as string,
    createdAt: row.created_at as string,
  }
}

function mapDecision(row: Record<string, unknown>): PocDecision {
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    pocBenchmarkId: row.poc_benchmark_id as string,
    decision: row.decision as PocDecision['decision'],
    notes: row.notes as string,
    approvedBy: row.approved_by as string,
    approvedAt: row.approved_at as string,
    isCurrent: row.is_current as boolean,
    supersedesDecisionId: row.supersedes_decision_id as string | null,
    createdBy: row.created_by as string | null,
    createdAt: row.created_at as string,
  }
}

function mapCandidateRoleMatch(row: Record<string, unknown>): CandidateRoleMatch {
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    candidateId: row.candidate_id as string,
    jobId: row.job_id as string,
    recruitmentProjectId: row.recruitment_project_id as string,
    scorecardVersionId: row.scorecard_version_id as string,
    latestMatchingRunId: row.latest_matching_run_id as string,
    eligibility: row.eligibility as CandidateRoleMatch['eligibility'],
    overallScore: row.overall_score as number | null,
    evidenceCoveragePct: row.evidence_coverage_pct as number,
    dataCompletenessPct: row.data_completeness_pct as number,
    confidence: row.confidence as number | null,
    reviewStatus: row.review_status as CandidateRoleMatch['reviewStatus'],
    reviewedBy: row.reviewed_by as string | null,
    reviewedAt: row.reviewed_at as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

/** Loads everything one poc_benchmarks row needs for the full workspace/report UI, including a live compareRoleBenchmark() run per role. Returns null if the benchmark isn't found (or isn't in this org). */
export async function loadPocBenchmarkDetail(
  organizationId: string,
  benchmarkId: string,
): Promise<PocBenchmarkDetail | null> {
  const supabase = await createServerSupabaseClient()
  if (!supabase) return null

  const { data: benchmarkRow } = await supabase
    .from('poc_benchmarks')
    .select('*')
    .eq('id', benchmarkId)
    .eq('organization_id', organizationId)
    .maybeSingle()
  if (!benchmarkRow) return null

  const benchmark = mapBenchmark(benchmarkRow)

  const [{ data: clientRow }, { data: roleRows }, { data: decisionRows }] = await Promise.all([
    supabase.from('clients').select('name').eq('id', benchmark.clientId).maybeSingle(),
    supabase
      .from('poc_roles')
      .select('*')
      .eq('poc_benchmark_id', benchmarkId)
      .order('role_type', { ascending: true }),
    supabase
      .from('poc_decisions')
      .select('*')
      .eq('poc_benchmark_id', benchmarkId)
      .order('created_at', { ascending: false }),
  ])

  const roles = (roleRows ?? []).map(mapRole)
  const decisionHistory = (decisionRows ?? []).map(mapDecision)
  const currentDecision = decisionHistory.find((d) => d.isCurrent) ?? null

  const roleDetails = await Promise.all(
    roles.map((role) => loadRoleDetail(supabase, benchmark, role)),
  )

  return {
    benchmark,
    clientName: (clientRow?.name as string | undefined) ?? 'Unknown client',
    roles: roleDetails,
    currentDecision,
    decisionHistory,
  }
}

async function loadRoleDetail(
  supabase: NonNullable<Awaited<ReturnType<typeof createServerSupabaseClient>>>,
  benchmark: PocBenchmark,
  role: PocRole,
): Promise<PocRoleDetail> {
  const [
    { data: jobRow },
    { data: participantRows },
    { data: baselineRows },
    { data: dataPointRows },
    { data: exclusionRows },
    { data: resultRows },
  ] = await Promise.all([
    supabase.from('jobs').select('title').eq('id', role.jobId).maybeSingle(),
    supabase.from('poc_participants').select('*').eq('poc_role_id', role.id),
    supabase
      .from('poc_baselines')
      .select('*')
      .eq('poc_role_id', role.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('poc_metrics')
      .select('*')
      .eq('poc_role_id', role.id)
      .order('recorded_at', { ascending: false }),
    supabase
      .from('poc_exclusions')
      .select('*')
      .eq('poc_role_id', role.id)
      .order('excluded_at', { ascending: false }),
    supabase.from('poc_results').select('*').eq('poc_role_id', role.id),
  ])

  const participants = (participantRows ?? []) as Record<string, unknown>[]
  const clientParticipantRow =
    participants.find((p) => p.process_type === 'client_baseline') ?? null
  const vendorParticipantRow =
    participants.find((p) => p.process_type === 'vendor_assisted') ?? null

  const toParticipantInfo = (row: Record<string, unknown> | null): PocRoleParticipantInfo | null =>
    row
      ? {
          id: row.id as string,
          status: row.status as PocParticipant['status'],
          shortlistId: row.shortlist_id as string | null,
          startedAt: row.started_at as string | null,
          completedAt: row.completed_at as string | null,
        }
      : null

  const baselineHistory: PocBaseline[] = (baselineRows ?? []).map(mapBaseline)
  const dataPointHistory: PocMetricDataPoint[] = (dataPointRows ?? []).map(mapDataPoint)
  const exclusions: PocExclusion[] = (exclusionRows ?? []).map(mapExclusion)

  const vendorDataPoints = dataPointHistory.filter(
    (dp: PocMetricDataPoint) =>
      dp.pocParticipantId === (vendorParticipantRow?.id as string | undefined),
  )
  const clientDataPoints = dataPointHistory.filter(
    (dp: PocMetricDataPoint) =>
      dp.pocParticipantId === (clientParticipantRow?.id as string | undefined),
  )

  const shortlistId = (vendorParticipantRow?.shortlist_id as string | null | undefined) ?? null

  const [{ data: matchRows }, { data: entryRows }] = await Promise.all([
    supabase
      .from('candidate_role_matches')
      .select('*')
      .eq('job_id', role.jobId)
      .eq('organization_id', benchmark.organizationId),
    supabase
      .from('candidate_project_entries')
      .select(
        'id, candidate_id, recruitment_project_id, job_id, current_stage, client_visible, created_at, updated_at',
      )
      .eq('recruitment_project_id', role.recruitmentProjectId),
  ])

  const candidateRoleMatches: CandidateRoleMatch[] = (matchRows ?? []).map(mapCandidateRoleMatch)
  const candidateProjectEntries = (entryRows ?? []).map(
    (row: Record<string, unknown>): CandidateProjectEntry => ({
      id: row.id as string,
      candidateId: row.candidate_id as string,
      recruitmentProjectId: row.recruitment_project_id as string,
      jobId: row.job_id as string | null,
      currentStage: row.current_stage as CandidateProjectEntry['currentStage'],
      clientVisible: row.client_visible as boolean,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }),
  )

  let shortlistCandidates: ShortlistCandidate[] = []
  let vendorClientDecisions: ClientDecisionRecord[] = []
  if (shortlistId) {
    const { data: shortlistRow } = await supabase
      .from('shortlists')
      .select('current_version_id')
      .eq('id', shortlistId)
      .maybeSingle()
    const currentVersionId = shortlistRow?.current_version_id as string | null | undefined

    const [{ data: scRows }, { data: decisionRows2 }] = await Promise.all([
      currentVersionId
        ? supabase
            .from('shortlist_candidates')
            .select(
              'id, organization_id, shortlist_version_id, candidate_role_match_id, candidate_id, matching_run_id, scorecard_version_id, rank, recruiter_note, added_by, added_at',
            )
            .eq('shortlist_version_id', currentVersionId)
        : Promise.resolve({ data: [] }),
      supabase
        .from('client_decisions')
        .select(
          'id, shortlist_id, shortlist_version_id, client_id, decided_by, decision, notes, created_at',
        )
        .eq('shortlist_id', shortlistId),
    ])

    shortlistCandidates = (scRows ?? []).map(
      (row: Record<string, unknown>): ShortlistCandidate => ({
        id: row.id as string,
        organizationId: row.organization_id as string,
        shortlistVersionId: row.shortlist_version_id as string,
        candidateRoleMatchId: row.candidate_role_match_id as string,
        candidateId: row.candidate_id as string,
        matchingRunId: row.matching_run_id as string,
        scorecardVersionId: row.scorecard_version_id as string,
        rank: row.rank as number,
        recruiterNote: row.recruiter_note as string | null,
        addedBy: row.added_by as string | null,
        addedAt: row.added_at as string,
      }),
    )
    vendorClientDecisions = (decisionRows2 ?? []).map(
      (row: Record<string, unknown>): ClientDecisionRecord => ({
        id: row.id as string,
        shortlistId: row.shortlist_id as string,
        shortlistVersionId: row.shortlist_version_id as string,
        clientId: row.client_id as string,
        decidedBy: row.decided_by as string,
        decision: row.decision as ClientDecisionRecord['decision'],
        notes: row.notes as string | null,
        createdAt: row.created_at as string,
      }),
    )
  }

  const vendorCandidateIds = [
    ...new Set(candidateRoleMatches.map((m: CandidateRoleMatch) => m.candidateId)),
  ]
  let vendorOutreachMessages: OutreachMessage[] = []
  let vendorCandidateResponses: CandidateResponse[] = []
  if (vendorCandidateIds.length > 0) {
    const [{ data: msgRows }, { data: respRows }] = await Promise.all([
      supabase
        .from('outreach_messages')
        .select(
          'id, organization_id, outreach_sequence_id, candidate_id, recruitment_project_id, candidate_role_match_id, template_id, contact_point_id, channel, status, subject, draft_body, personalization_evidence, generated_by, ai_run_id, edited_by_human, sender_user_id, sender_account_identifier, scheduled_at, sent_at, delivered_at, failed_at, failure_reason, cancelled_at, cancelled_by, cancel_reason, idempotency_key, created_by, created_at, updated_at',
        )
        .eq('recruitment_project_id', role.recruitmentProjectId)
        .in('candidate_id', vendorCandidateIds),
      supabase
        .from('candidate_responses')
        .select(
          'id, organization_id, candidate_id, recruitment_project_id, outreach_message_id, channel, raw_response_text, received_at, ai_suggested_classification, ai_confidence, ai_run_id, reviewed_by, reviewed_at, confirmed_classification, review_note, created_at',
        )
        .eq('recruitment_project_id', role.recruitmentProjectId)
        .in('candidate_id', vendorCandidateIds),
    ])

    vendorOutreachMessages = (msgRows ?? []).map(
      (row: Record<string, unknown>): OutreachMessage => ({
        id: row.id as string,
        organizationId: row.organization_id as string,
        outreachSequenceId: row.outreach_sequence_id as string,
        candidateId: row.candidate_id as string,
        recruitmentProjectId: row.recruitment_project_id as string,
        candidateRoleMatchId: row.candidate_role_match_id as string,
        templateId: row.template_id as string | null,
        contactPointId: row.contact_point_id as string | null,
        channel: row.channel as OutreachMessage['channel'],
        status: row.status as OutreachMessage['status'],
        subject: row.subject as string | null,
        draftBody: row.draft_body as string,
        personalizationEvidence:
          (row.personalization_evidence as OutreachMessage['personalizationEvidence']) ?? [],
        generatedBy: row.generated_by as OutreachMessage['generatedBy'],
        aiRunId: row.ai_run_id as string | null,
        editedByHuman: row.edited_by_human as boolean,
        senderUserId: row.sender_user_id as string | null,
        senderAccountIdentifier: row.sender_account_identifier as string | null,
        scheduledAt: row.scheduled_at as string | null,
        sentAt: row.sent_at as string | null,
        deliveredAt: row.delivered_at as string | null,
        failedAt: row.failed_at as string | null,
        failureReason: row.failure_reason as string | null,
        cancelledAt: row.cancelled_at as string | null,
        cancelledBy: row.cancelled_by as string | null,
        cancelReason: row.cancel_reason as string | null,
        idempotencyKey: row.idempotency_key as string | null,
        createdBy: row.created_by as string | null,
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string,
      }),
    )

    vendorCandidateResponses = (respRows ?? []).map(
      (row: Record<string, unknown>): CandidateResponse => ({
        id: row.id as string,
        organizationId: row.organization_id as string,
        candidateId: row.candidate_id as string,
        recruitmentProjectId: row.recruitment_project_id as string,
        outreachMessageId: row.outreach_message_id as string | null,
        channel: row.channel as CandidateResponse['channel'],
        rawResponseText: row.raw_response_text as string,
        receivedAt: row.received_at as string,
        aiSuggestedClassification:
          row.ai_suggested_classification as CandidateResponse['aiSuggestedClassification'],
        aiConfidence: row.ai_confidence as number | null,
        aiRunId: row.ai_run_id as string | null,
        reviewedBy: row.reviewed_by as string | null,
        reviewedAt: row.reviewed_at as string | null,
        confirmedClassification:
          row.confirmed_classification as CandidateResponse['confirmedClassification'],
        reviewNote: row.review_note as string | null,
        createdAt: row.created_at as string,
      }),
    )
  }

  const roleData: RoleBenchmarkData = {
    role: { id: role.id, roleType: role.roleType },
    clientBaselines: baselineHistory,
    vendorDataPoints,
    clientDataPoints,
    exclusions,
    candidateRoleMatches,
    candidateProjectEntries,
    shortlistCandidates,
    vendorClientDecisions,
    vendorOutreachMessages,
    vendorCandidateResponses,
    // No directly-observed vendor timestamp source exists yet (no gate-
    // eligibility-reached or shortlist-submitted timestamp column) — both
    // speed metrics fall back to their DATA_POINT_KEYS manual-entry path.
    vendorFirstQualifiedObservedAt: null,
    vendorShortlistReadyObservedAt: null,
  }

  const comparison = compareRoleBenchmark({
    benchmark: { startTime: benchmark.startTime },
    role: roleData,
  })

  return {
    role,
    jobTitle: (jobRow?.title as string | undefined) ?? 'Unknown role',
    clientBaselineParticipant: toParticipantInfo(clientParticipantRow),
    vendorAssistedParticipant: toParticipantInfo(vendorParticipantRow),
    latestClientBaseline: baselineHistory[0] ?? null,
    baselineHistory,
    dataPointHistory,
    exclusions,
    persistedResults: ((resultRows ?? []) as Record<string, unknown>[]).map((row): PocResult => ({
      id: row.id as string,
      organizationId: row.organization_id as string,
      pocBenchmarkId: row.poc_benchmark_id as string,
      pocRoleId: row.poc_role_id as string,
      metricDefinitionId: row.metric_definition_id as string,
      metricDefinitionVersion: row.metric_definition_version as number,
      side: row.side as PocResult['side'],
      status: row.status as PocResult['status'],
      value: row.value as number | null,
      valueUnit: row.value_unit as PocResult['valueUnit'],
      calculationInputRef: (row.calculation_input_ref as PocResult['calculationInputRef']) ?? [],
      computedAt: row.computed_at as string | null,
      computedBy: row.computed_by as string | null,
      notes: row.notes as string | null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    })),
    comparison,
  }
}

/** Map of metricKey -> {id, version} for the currently-active seeded metric_definitions rows — used by poc-actions.ts's computePocResultsAction to know which metric_definition_id/version to write against, without hardcoding ids. */
export async function loadMetricDefinitionRefMap(): Promise<
  Map<string, { id: string; version: number }>
> {
  const supabase = await createServerSupabaseClient()
  const map = new Map<string, { id: string; version: number }>()
  if (!supabase) return map
  const { data } = await supabase
    .from('metric_definitions')
    .select('id, metric_key, version')
    .eq('status', 'active')
  for (const row of data ?? []) {
    map.set(row.metric_key as string, { id: row.id as string, version: row.version as number })
  }
  return map
}
