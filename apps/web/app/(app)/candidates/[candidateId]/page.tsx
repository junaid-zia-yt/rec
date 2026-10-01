import { notFound } from 'next/navigation'
import {
  AvatarInitials,
  Breadcrumbs,
  Card,
  CardBody,
  PageHeader,
  SectionHeader,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@rqi/ui'
import { hasPermission, type Role } from '@rqi/types'
import type {
  CandidateCertification,
  CandidateConsent,
  CandidateContactPoint,
  CandidateDocument,
  CandidateEducation,
  CandidateExperience,
  CandidateProfile,
  CandidateProjectEntry,
  CandidateRecord,
  CandidateSkill,
  DuplicateCandidateSuggestion,
} from '@rqi/types'
import {
  listDemoProjects,
  getDemoCandidate,
  getDemoJobIdForProject,
  DEMO_ORG,
  type DemoEvaluationResult,
} from '@/lib/demo/engine'
import { CandidateProfileEditor } from '@/components/domain/candidates/candidate-profile-editor'
import { CandidateDocumentPanel } from '@/components/domain/candidates/candidate-document-panel'
import {
  CandidateDocumentProcessingPanel,
  type ExtractedFieldSummary,
  type ProcessingJobSummary,
} from '@/components/domain/candidates/candidate-document-processing-panel'
import {
  CandidateCertificationList,
  CandidateEducationList,
  CandidateExperienceList,
  CandidateSkillList,
} from '@/components/domain/candidates/candidate-detail-lists'
import { CandidateStagePanel } from '@/components/domain/candidates/candidate-stage-panel'
import {
  CandidateEvaluationPanel,
  type EvidenceSummary,
  type GateResultSummary,
  type HumanReviewSummary,
  type JobOption,
  type MatchSummary,
  type MatchingRunSummary,
  type ScoringBreakdownSummary,
} from '@/components/domain/candidates/candidate-evaluation-panel'
import { DuplicateResolutionPanel } from '@/components/domain/candidates/duplicate-resolution-panel'
import { CandidatePrivacyPanel } from '@/components/domain/candidates/candidate-privacy-panel'
import { contactValueForRole, serializeCandidateProfileForRole } from '@/lib/candidates/visibility'
import { findDuplicateSuggestions } from '@/lib/candidates/dedup'
import { loadDuplicateSuggestions } from '@/lib/candidates/dedup-lookup'
import { supabaseConfigured } from '@/lib/env'
import { requireAuth, resolveActiveOrg } from '@/lib/auth/session'
import { createServerSupabaseClient } from '@/lib/supabase/server'

/**
 * Build Phase 18 repair: this page (and every other page that reads the
 * private demo's in-memory engine — lib/demo/engine.ts) must never be
 * statically prerendered. `next build`'s static optimizer would otherwise
 * render it ONCE at build time and freeze that snapshot forever in
 * production (`next start`), so no candidate creation, evaluation,
 * shortlist or outreach action taken afterwards would ever show up here —
 * discovered via Playwright testing against a real production build, not
 * caught by unit tests or `next dev` (which never statically optimizes).
 * `generateStaticParams` used to pin this route to the seed candidate ids
 * only, which would also 404 (or silently stale-cache) any candidate
 * created after build. See docs/demo-limitations.md §8.
 */
export const dynamic = 'force-dynamic'

interface CandidateDetailData {
  organizationId: string
  role: Role
  candidate: CandidateRecord
  profile: CandidateProfile | null
  contactPoints: CandidateContactPoint[]
  documents: CandidateDocument[]
  experiences: CandidateExperience[]
  education: CandidateEducation[]
  certifications: CandidateCertification[]
  skills: CandidateSkill[]
  projectEntries: (CandidateProjectEntry & { projectName: string; projectClientId: string })[]
  availableProjects: { id: string; name: string; clientId: string }[]
  consent: CandidateConsent | null
  duplicates: (DuplicateCandidateSuggestion & { matchedCandidateName: string })[]
  processingJobs: ProcessingJobSummary[]
  extractedFields: ExtractedFieldSummary[]
  evaluationJobs: JobOption[]
  evaluationMatches: MatchSummary[]
  evaluationGates: GateResultSummary[]
  evaluationEvidence: EvidenceSummary[]
  evaluationScoring: ScoringBreakdownSummary[]
  evaluationRuns: MatchingRunSummary[]
  evaluationReviews: HumanReviewSummary[]
}

/**
 * Build Phase 18: sourced from the demo engine instead of static,
 * score-less fixtures (docs/client-feedback-reproduction-report.md §1 —
 * `evaluationJobs`/`evaluationMatches`/etc. used to be hardcoded to `[]`
 * unconditionally, which is why the Evaluation tab always showed "not
 * assigned to a role yet" for every demo candidate, no matter what). The
 * candidate's profile/background/documents fields outside the evaluation
 * are intentionally left honestly empty here — those were not part of the
 * client's reported failures and are unaffected by this repair.
 */
function loadDemoDetail(candidateId: string): CandidateDetailData | null {
  const engineCandidate = getDemoCandidate(candidateId)
  if (!engineCandidate) return null

  const project = listDemoProjects().find((p) => p.id === engineCandidate.projectId)

  const candidate: CandidateRecord = {
    id: engineCandidate.id,
    organizationId: DEMO_ORG,
    fullName: engineCandidate.fullName,
    primaryEmail: engineCandidate.email || null,
    primaryPhone: engineCandidate.phone || null,
    status: 'active',
    mergedIntoCandidateId: null,
    createdBy: 'demo',
    createdAt: engineCandidate.createdAt,
    updatedAt: engineCandidate.createdAt,
  }

  const jobOptions: JobOption[] = project ? [{ id: getDemoJobIdForProject(project.id), title: project.roleTitle }] : []

  const ev: DemoEvaluationResult | null = engineCandidate.evaluation
  const evaluationMatches: MatchSummary[] = []
  const evaluationGates: GateResultSummary[] = []
  const evaluationEvidence: EvidenceSummary[] = []
  const evaluationScoring: ScoringBreakdownSummary[] = []
  const evaluationRuns: MatchingRunSummary[] = []

  if (ev && jobOptions[0]) {
    const matchId = `${candidateId}:match`
    const runId = `${candidateId}:run:${ev.evaluatedAt}`

    evaluationMatches.push({
      id: matchId,
      jobId: jobOptions[0].id,
      latestMatchingRunId: runId,
      eligibility: ev.eligibility ?? 'pending_verification',
      overallScore: ev.overallScore,
      evidenceCoveragePct: ev.evidenceCoveragePct ?? 0,
      dataCompletenessPct: ev.dataCompletenessPct ?? 0,
      confidence: ev.confidence,
      reviewStatus: engineCandidate.reviewStatus === 'reviewed' ? 'approved_for_outreach' : 'pending',
      reviewedAt: engineCandidate.reviewStatus === 'reviewed' ? ev.evaluatedAt : null,
      updatedAt: ev.evaluatedAt,
    })

    for (const gate of ev.gates) {
      evaluationGates.push({
        id: `${candidateId}:gate:${gate.requirementId}`,
        candidateRoleMatchId: matchId,
        matchingRunId: runId,
        requirementId: gate.requirementId,
        requirementName: gate.requirementName,
        deterministicResult: gate.result === 'passed' ? 'pass' : gate.result === 'failed' ? 'fail' : 'insufficient_evidence',
        aiSuggestedResult: null,
        aiSuggestionNote: null,
        riskNotes: [],
        state: gate.result,
        verificationNote: null,
        overrideResult: null,
        overrideReason: null,
        overrideEvidenceNote: null,
        overrideAt: null,
      })
    }

    for (const assessment of ev.assessments) {
      for (const [i, refItem] of assessment.evidenceRefs.entries()) {
        evaluationEvidence.push({
          id: `${candidateId}:evidence:${assessment.requirementId}:${i}`,
          candidateRoleMatchId: matchId,
          matchingRunId: runId,
          requirementId: assessment.requirementId,
          sourceKind: refItem.sourceKind,
          excerpt: refItem.excerpt,
          location: refItem.location,
          relevanceScore: assessment.relevanceScore,
          confidence: assessment.confidence,
          isDirectStatement: refItem.isDirectStatement,
        })
      }
      if (assessment.requirementType === 'preferred') {
        const criterion = ev.criteria.find((c) => c.requirementId === assessment.requirementId)
        evaluationScoring.push({
          id: `${candidateId}:scoring:${assessment.requirementId}`,
          candidateRoleMatchId: matchId,
          matchingRunId: runId,
          requirementId: assessment.requirementId,
          requirementName: criterion?.requirementName ?? assessment.requirementId,
          weight: criterion?.weight ?? 0,
          effectiveScore: criterion?.effectiveScore ?? null,
          weightedContribution: criterion?.weightedContribution ?? 0,
          hasEvidence: criterion?.hasEvidence ?? assessment.evidenceRefs.length > 0,
          riskNotes: assessment.riskNotes,
        })
      }
    }

    evaluationRuns.push({
      id: runId,
      jobId: jobOptions[0].id,
      status: ev.status === 'completed' ? 'completed' : 'failed',
      triggerReason: 'initial_evaluation',
      triggerNote: null,
      errorKind: ev.status === 'failed' ? 'provider_error' : null,
      errorMessage: ev.errorMessage,
      startedAt: ev.evaluatedAt,
      completedAt: ev.evaluatedAt,
      createdAt: ev.evaluatedAt,
    })
  }

  return {
    organizationId: DEMO_ORG,
    role: 'agency_admin',
    candidate,
    profile: null,
    contactPoints: [
      ...(engineCandidate.email
        ? [{ id: `${candidateId}:c-email`, candidateId, type: 'email' as const, value: engineCandidate.email, isPrimary: true }]
        : []),
      ...(engineCandidate.phone
        ? [{ id: `${candidateId}:c-phone`, candidateId, type: 'phone' as const, value: engineCandidate.phone, isPrimary: true }]
        : []),
    ],
    documents: [],
    experiences: [],
    education: [],
    certifications: [],
    skills: [],
    projectEntries: project
      ? [
          {
            id: `${candidateId}:entry`,
            candidateId,
            recruitmentProjectId: project.id,
            jobId: jobOptions[0]?.id ?? project.id,
            currentStage: engineCandidate.isShortlisted
              ? 'shortlisted'
              : ev?.eligibility === 'ineligible'
                ? 'rejected'
                : ev?.eligibility === 'pending_verification'
                  ? 'eligibility_check'
                  : ev
                    ? 'scored'
                    : 'discovered',
            clientVisible: engineCandidate.isShortlisted,
            createdAt: engineCandidate.createdAt,
            updatedAt: engineCandidate.createdAt,
            projectName: project.roleTitle,
            projectClientId: project.id,
          },
        ]
      : [],
    availableProjects: listDemoProjects()
      .filter((p) => p.id !== engineCandidate.projectId)
      .map((p) => ({ id: p.id, name: p.roleTitle, clientId: p.id })),
    consent: null,
    duplicates: [],
    // AI document processing (Build Phase 6) has no demo fixtures for
    // engine candidates — the demo path shows the panel's own empty state
    // honestly rather than fabricating fake processing history.
    processingJobs: [],
    extractedFields: [],
    evaluationJobs: jobOptions,
    evaluationMatches,
    evaluationGates,
    evaluationEvidence,
    evaluationScoring,
    evaluationRuns,
    evaluationReviews: [],
  }
}

async function loadLiveDetail(candidateId: string): Promise<CandidateDetailData | null> {
  const user = await requireAuth(`/candidates/${candidateId}`)
  const membership = await resolveActiveOrg(user.id)
  const supabase = await createServerSupabaseClient()

  const { data: row } = await supabase!
    .from('candidates')
    .select(
      'id, organization_id, full_name, primary_email, primary_phone, status, merged_into_candidate_id, created_by, created_at, updated_at',
    )
    .eq('id', candidateId)
    .eq('organization_id', membership.organizationId)
    .maybeSingle()

  if (!row) return null

  const candidate: CandidateRecord = {
    id: row.id,
    organizationId: row.organization_id,
    fullName: row.full_name,
    primaryEmail: row.primary_email,
    primaryPhone: row.primary_phone,
    status: row.status,
    mergedIntoCandidateId: row.merged_into_candidate_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }

  const [
    { data: profileRow },
    { data: contactRows },
    { data: documentRows },
    { data: experienceRows },
    { data: educationRows },
    { data: certificationRows },
    { data: skillRows },
    { data: entryRows },
    { data: projectRows },
    { data: consentRow },
    { data: processingJobRows },
    { data: extractedFieldRows },
  ] = await Promise.all([
    supabase!.from('candidate_profiles').select('*').eq('candidate_id', candidateId).maybeSingle(),
    supabase!
      .from('candidate_contact_points')
      .select('id, candidate_id, type, value, is_primary')
      .eq('candidate_id', candidateId),
    supabase!
      .from('candidate_documents')
      .select(
        'id, candidate_id, document_upload_id, doc_type, version_no, status, created_at, document_uploads(file_name, checksum_sha256, size_bytes)',
      )
      .eq('candidate_id', candidateId),
    supabase!.from('candidate_experiences').select('*').eq('candidate_id', candidateId),
    supabase!.from('candidate_education').select('*').eq('candidate_id', candidateId),
    supabase!.from('candidate_certifications').select('*').eq('candidate_id', candidateId),
    supabase!.from('candidate_skills').select('*').eq('candidate_id', candidateId),
    supabase!
      .from('candidate_project_entries')
      .select(
        'id, candidate_id, recruitment_project_id, job_id, current_stage, client_visible, created_at, updated_at',
      )
      .eq('candidate_id', candidateId),
    supabase!
      .from('recruitment_projects')
      .select('id, role_title, client_id')
      .eq('organization_id', membership.organizationId),
    supabase!.from('candidate_consents').select('*').eq('candidate_id', candidateId).maybeSingle(),
    supabase!
      .from('candidate_document_processing_jobs')
      .select(
        'id, candidate_document_id, status, error_kind, error_message, attempt_no, reprocess_reason, model, prompt_version, created_at, completed_at',
      )
      .eq('candidate_id', candidateId)
      .order('created_at', { ascending: false }),
    supabase!
      .from('candidate_extracted_fields')
      .select(
        'id, processing_job_id, field_group, field_key, item_index, extracted_value, has_evidence, source_location, source_excerpt, confidence, verification_status, edited_value, applied_at',
      )
      .eq('candidate_id', candidateId),
  ])

  const projectById = new Map(
    (projectRows ?? []).map((p) => [
      p.id,
      { name: p.role_title as string, clientId: p.client_id as string },
    ]),
  )
  const assignedProjectIds = new Set(
    (entryRows ?? []).map((e) => e.recruitment_project_id as string),
  )

  const profile: CandidateProfile | null = profileRow
    ? {
        id: profileRow.id,
        candidateId: profileRow.candidate_id,
        currentTitle: profileRow.current_title,
        currentCompany: profileRow.current_company,
        summary: profileRow.summary,
        location: profileRow.location,
        workAuthorization: profileRow.work_authorization,
        compensationMin: profileRow.compensation_min,
        compensationMax: profileRow.compensation_max,
        compensationCurrency: profileRow.compensation_currency,
        compensationPeriod: profileRow.compensation_period,
        availabilityDate: profileRow.availability_date,
        availabilityNotes: profileRow.availability_notes,
        noticePeriodDays: profileRow.notice_period_days,
        workplacePreference: profileRow.workplace_preference,
        yearsExperience: profileRow.years_experience,
        recruiterNotes: profileRow.recruiter_notes,
        clientVisibleNotes: profileRow.client_visible_notes,
      }
    : null

  const documents: CandidateDocument[] = (documentRows ?? []).map((d) => {
    const upload = d.document_uploads as unknown as {
      file_name: string
      checksum_sha256: string
      size_bytes: number
    } | null
    return {
      id: d.id,
      candidateId: d.candidate_id,
      documentUploadId: d.document_upload_id,
      docType: d.doc_type,
      versionNo: d.version_no,
      status: d.status,
      fileName: upload?.file_name ?? 'Unknown file',
      checksumSha256: upload?.checksum_sha256 ?? '',
      sizeBytes: upload?.size_bytes ?? 0,
      createdAt: d.created_at,
    }
  })

  // Build Phase 7 candidate-matching data — one job picker's worth of
  // context per role the candidate is assigned to (a match is keyed by
  // candidate x job, not just candidate). Loaded in a batch keyed off the
  // candidate's project-entry job ids, mirroring the Promise.all pattern
  // used for the rest of this page's data.
  const evaluationJobIds = Array.from(new Set((entryRows ?? []).map((e) => e.job_id as string)))

  // Performance (Build Phase 14 Wave 4): these two queries are independent
  // (evaluationJobRows only needs evaluationJobIds; matchRows only needs
  // candidateId) but were previously awaited sequentially — one extra,
  // avoidable network round trip on every candidate-detail page load.
  // Promise.all runs them concurrently instead, mirroring every other
  // batch on this page.
  const [{ data: evaluationJobRows }, { data: matchRows }] = evaluationJobIds.length
    ? await Promise.all([
        supabase!.from('jobs').select('id, title').in('id', evaluationJobIds),
        supabase!
          .from('candidate_role_matches')
          .select(
            'id, job_id, latest_matching_run_id, eligibility, overall_score, evidence_coverage_pct, data_completeness_pct, confidence, review_status, reviewed_at, updated_at',
          )
          .eq('candidate_id', candidateId),
      ])
    : [
        { data: [] as { id: string; title: string }[] },
        { data: [] as Array<Record<string, unknown>> },
      ]

  const evaluationMatchIds = (matchRows ?? []).map((m) => m.id as string)

  const [
    { data: gateRows },
    { data: evidenceRows },
    { data: scoringRows },
    { data: runRows },
    { data: reviewRows },
  ] = evaluationMatchIds.length
    ? await Promise.all([
        supabase!
          .from('mandatory_gate_results')
          .select(
            'id, candidate_role_match_id, matching_run_id, requirement_id, requirement_name, deterministic_result, ai_suggested_result, ai_suggestion_note, risk_notes, state, verification_note, override_result, override_reason, override_evidence_note, override_at',
          )
          .in('candidate_role_match_id', evaluationMatchIds),
        supabase!
          .from('requirement_evidence')
          .select(
            'id, candidate_role_match_id, matching_run_id, requirement_id, source_kind, excerpt, location, relevance_score, confidence, is_direct_statement',
          )
          .in('candidate_role_match_id', evaluationMatchIds),
        supabase!
          .from('scoring_breakdowns')
          .select(
            'id, candidate_role_match_id, matching_run_id, requirement_id, requirement_name, weight, effective_score, weighted_contribution, has_evidence, risk_notes',
          )
          .in('candidate_role_match_id', evaluationMatchIds),
        supabase!
          .from('matching_runs')
          .select(
            'id, job_id, status, trigger_reason, trigger_note, error_kind, error_message, started_at, completed_at, created_at',
          )
          .eq('candidate_id', candidateId),
        supabase!
          .from('human_reviews')
          .select('id, candidate_role_match_id, decision, reason, created_at')
          .in('candidate_role_match_id', evaluationMatchIds),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }]

  const duplicates = (
    await loadDuplicateSuggestions(supabase!, membership.organizationId, candidateId)
  ).map((d) => ({
    ...d,
    matchedCandidateName: 'Another candidate',
  }))
  if (duplicates.length > 0) {
    const { data: matchedRows } = await supabase!
      .from('candidates')
      .select('id, full_name')
      .in(
        'id',
        duplicates.map((d) => d.matchedCandidateId),
      )
    for (const d of duplicates) {
      d.matchedCandidateName =
        matchedRows?.find((m) => m.id === d.matchedCandidateId)?.full_name ?? 'Another candidate'
    }
  }

  return {
    organizationId: membership.organizationId,
    role: membership.role,
    candidate,
    profile,
    contactPoints: (contactRows ?? []).map((c) => ({
      id: c.id,
      candidateId: c.candidate_id,
      type: c.type,
      value: c.value,
      isPrimary: c.is_primary,
    })),
    documents,
    experiences: (experienceRows ?? []).map((e) => ({
      id: e.id,
      candidateId: e.candidate_id,
      company: e.company,
      title: e.title,
      location: e.location,
      startDate: e.start_date,
      endDate: e.end_date,
      isCurrent: e.is_current,
      description: e.description,
    })),
    education: (educationRows ?? []).map((e) => ({
      id: e.id,
      candidateId: e.candidate_id,
      institution: e.institution,
      degree: e.degree,
      fieldOfStudy: e.field_of_study,
      startDate: e.start_date,
      endDate: e.end_date,
    })),
    certifications: (certificationRows ?? []).map((c) => ({
      id: c.id,
      candidateId: c.candidate_id,
      name: c.name,
      issuingBody: c.issuing_body,
      issuedDate: c.issued_date,
      expiresDate: c.expires_date,
    })),
    skills: (skillRows ?? []).map((s) => ({
      id: s.id,
      candidateId: s.candidate_id,
      skillName: s.skill_name,
      proficiency: s.proficiency,
      yearsExperience: s.years_experience,
    })),
    projectEntries: (entryRows ?? []).map((e) => ({
      id: e.id,
      candidateId: e.candidate_id,
      recruitmentProjectId: e.recruitment_project_id,
      jobId: e.job_id,
      currentStage: e.current_stage,
      clientVisible: e.client_visible,
      createdAt: e.created_at,
      updatedAt: e.updated_at,
      projectName: projectById.get(e.recruitment_project_id)?.name ?? 'Unknown project',
      projectClientId: projectById.get(e.recruitment_project_id)?.clientId ?? '',
    })),
    availableProjects: (projectRows ?? [])
      .filter((p) => !assignedProjectIds.has(p.id))
      .map((p) => ({ id: p.id, name: p.role_title as string, clientId: p.client_id as string })),
    consent: consentRow
      ? {
          id: consentRow.id,
          candidateId: consentRow.candidate_id,
          consentStatus: consentRow.consent_status,
          consentRecordedAt: consentRow.consent_recorded_at,
          deletionRequested: consentRow.deletion_requested,
          deletionRequestedAt: consentRow.deletion_requested_at,
          deletionReason: consentRow.deletion_reason,
        }
      : null,
    duplicates,
    processingJobs: (processingJobRows ?? []).map((j) => ({
      id: j.id,
      candidateDocumentId: j.candidate_document_id,
      status: j.status,
      errorKind: j.error_kind,
      errorMessage: j.error_message,
      attemptNo: j.attempt_no,
      reprocessReason: j.reprocess_reason,
      model: j.model,
      promptVersion: j.prompt_version,
      createdAt: j.created_at,
      completedAt: j.completed_at,
    })),
    extractedFields: (extractedFieldRows ?? []).map((f) => ({
      id: f.id,
      processingJobId: f.processing_job_id,
      fieldGroup: f.field_group,
      fieldKey: f.field_key,
      itemIndex: f.item_index,
      extractedValue: f.extracted_value,
      hasEvidence: f.has_evidence,
      sourceLocation: f.source_location,
      sourceExcerpt: f.source_excerpt,
      confidence: f.confidence,
      verificationStatus: f.verification_status,
      editedValue: f.edited_value,
      appliedAt: f.applied_at,
    })),
    evaluationJobs: (evaluationJobRows ?? []).map((j) => ({
      id: j.id as string,
      title: j.title as string,
    })),
    evaluationMatches: (matchRows ?? []).map((m) => ({
      id: m.id as string,
      jobId: m.job_id as string,
      latestMatchingRunId: m.latest_matching_run_id as string,
      eligibility: m.eligibility as MatchSummary['eligibility'],
      overallScore: m.overall_score as number | null,
      evidenceCoveragePct: m.evidence_coverage_pct as number,
      dataCompletenessPct: m.data_completeness_pct as number,
      confidence: m.confidence as number | null,
      reviewStatus: m.review_status as MatchSummary['reviewStatus'],
      reviewedAt: m.reviewed_at as string | null,
      updatedAt: m.updated_at as string,
    })),
    evaluationGates: (gateRows ?? []).map((g) => ({
      id: g.id,
      candidateRoleMatchId: g.candidate_role_match_id,
      matchingRunId: g.matching_run_id,
      requirementId: g.requirement_id,
      requirementName: g.requirement_name,
      deterministicResult: g.deterministic_result,
      aiSuggestedResult: g.ai_suggested_result,
      aiSuggestionNote: g.ai_suggestion_note,
      riskNotes: g.risk_notes ?? [],
      state: g.state,
      verificationNote: g.verification_note,
      overrideResult: g.override_result,
      overrideReason: g.override_reason,
      overrideEvidenceNote: g.override_evidence_note,
      overrideAt: g.override_at,
    })),
    evaluationEvidence: (evidenceRows ?? []).map((e) => ({
      id: e.id,
      candidateRoleMatchId: e.candidate_role_match_id,
      matchingRunId: e.matching_run_id,
      requirementId: e.requirement_id,
      sourceKind: e.source_kind,
      excerpt: e.excerpt,
      location: e.location,
      relevanceScore: e.relevance_score,
      confidence: e.confidence,
      isDirectStatement: e.is_direct_statement,
    })),
    evaluationScoring: (scoringRows ?? []).map((s) => ({
      id: s.id,
      candidateRoleMatchId: s.candidate_role_match_id,
      matchingRunId: s.matching_run_id,
      requirementId: s.requirement_id,
      requirementName: s.requirement_name,
      weight: s.weight,
      effectiveScore: s.effective_score,
      weightedContribution: s.weighted_contribution,
      hasEvidence: s.has_evidence,
      riskNotes: s.risk_notes ?? [],
    })),
    evaluationRuns: (runRows ?? []).map((r) => ({
      id: r.id,
      jobId: r.job_id,
      status: r.status,
      triggerReason: r.trigger_reason,
      triggerNote: r.trigger_note,
      errorKind: r.error_kind,
      errorMessage: r.error_message,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      createdAt: r.created_at,
    })),
    evaluationReviews: (reviewRows ?? []).map((r) => ({
      id: r.id,
      candidateRoleMatchId: r.candidate_role_match_id,
      decision: r.decision,
      reason: r.reason,
      createdAt: r.created_at,
    })),
  }
}

/**
 * Candidate detail page — composes the whole Build Phase 5 brief §UI list
 * for a single candidate: "Candidate details", "Candidate document
 * history", "Duplicate-resolution screen", "Stage-transition controls".
 * Contact values and recruiter notes are passed through
 * lib/candidates/visibility.ts before rendering, so masking/omission is
 * never left to an individual tab to remember.
 *
 * The Phase-1 "Mandatory gates" / "Evidence" section below (sourced from
 * the untouched DEMO_GATE_RESULTS/DEMO_EVIDENCE/DEMO_CANDIDATE_MATCHES
 * fixtures) is kept as-is and labeled a preview: it models the future
 * AI-scoring entity (candidate_role_matches, docs/07-data-model.md §7.1),
 * which this build phase explicitly does not implement
 * ("Do not implement AI CV parsing or match scoring yet").
 */
export default async function CandidateDetailPage({
  params,
}: {
  params: Promise<{ candidateId: string }>
}) {
  const { candidateId } = await params
  const data = supabaseConfigured ? await loadLiveDetail(candidateId) : loadDemoDetail(candidateId)
  if (!data) notFound()

  const {
    organizationId,
    role,
    candidate,
    profile,
    contactPoints,
    documents,
    experiences,
    education,
    certifications,
    skills,
    projectEntries,
    availableProjects,
    consent,
    duplicates,
    processingJobs,
    extractedFields,
    evaluationJobs,
    evaluationMatches,
    evaluationGates,
    evaluationEvidence,
    evaluationScoring,
    evaluationRuns,
    evaluationReviews,
  } = data

  const canEditRecords = hasPermission(role, 'candidate_records', 'update')
  const canDeleteRecords = hasPermission(role, 'candidate_records', 'delete')
  const canCreateRecords = hasPermission(role, 'candidate_records', 'create')
  const canEditDocuments = hasPermission(role, 'candidate_documents', 'create')
  const canProcessDocuments = hasPermission(role, 'candidate_documents', 'update')
  const canEvaluate = hasPermission(role, 'candidate_records', 'update')
  const canReviewMatches = hasPermission(role, 'human_reviews', 'update')

  const visibleProfile = profile ? serializeCandidateProfileForRole(profile, role) : null
  const canSeeRecruiterNotes = visibleProfile ? 'recruiterNotes' in visibleProfile : false
  const maskedContactPoints = contactPoints.map((c) => ({
    ...c,
    value: contactValueForRole(role, c.type, c.value),
  }))

  // Build Phase 18: the Phase-1 "AI match preview" tab below is a
  // deliberately separate, already-labelled-honest placeholder
  // (distinct from the real "Evaluation" tab, which now runs the actual
  // demo engine — see evaluationJobs/evaluationMatches/etc. above). It
  // never had demo fixtures of its own to begin with; kept empty here
  // rather than wired to real data, which would duplicate the Evaluation
  // tab's content under a second, confusing label.
  const legacyCandidate = null as { id: string } | null
  const match = null as { overallScore: number; evidencePercent: number; gatesPassed: number; gatesTotal: number } | null
  const gates: { id: string; requirementLabel: string; result: string }[] = []
  const evidence: { id: string; excerpt: string; sourceDocumentName: string; verificationStatus: string; confidence: number }[] = []

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[{ label: 'Candidates', href: '/candidates' }, { label: candidate.fullName }]}
      />

      <Card>
        <CardBody className="flex items-start gap-4">
          <AvatarInitials
            initials={candidate.fullName
              .split(' ')
              .map((p) => p[0])
              .slice(0, 2)
              .join('')}
            size="lg"
            tone="secondary"
          />
          <div className="flex-1">
            <PageHeader
              title={candidate.fullName}
              description={`${profile?.currentTitle ?? 'Title unverified'}${profile?.currentCompany ? ` · ${profile.currentCompany}` : ''}`}
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge status={candidate.status === 'active' ? 'passed' : 'neutral'}>
                {candidate.status.replace('_', ' ')}
              </StatusBadge>
              {maskedContactPoints.map((c) => (
                <span key={c.id} className="text-muted text-xs">
                  {c.type}: {c.value}
                </span>
              ))}
            </div>
          </div>
          {match && (
            <div className="text-right">
              <p className="font-display text-tertiary text-3xl font-bold">{match.overallScore}%</p>
              <p className="text-muted text-xs">{match.evidencePercent}% evidence</p>
            </div>
          )}
        </CardBody>
      </Card>

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="background">Background</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="ai-processing">AI Processing</TabsTrigger>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="evaluation">Evaluation</TabsTrigger>
          <TabsTrigger value="duplicates">Duplicates</TabsTrigger>
          <TabsTrigger value="privacy">Privacy</TabsTrigger>
          <TabsTrigger value="preview">AI match preview</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="pt-4">
          {visibleProfile ? (
            <div className="max-w-2xl">
              <CandidateProfileEditor
                organizationId={organizationId}
                candidate={candidate}
                profile={profile!}
                canEditRecruiterNotes={canSeeRecruiterNotes}
              />
            </div>
          ) : (
            <p className="text-muted text-sm">No profile recorded yet.</p>
          )}
        </TabsContent>

        <TabsContent value="background" className="flex flex-col gap-6 pt-4">
          <section className="flex flex-col gap-3">
            <SectionHeader title="Employment history" />
            <CandidateExperienceList
              organizationId={organizationId}
              candidateId={candidate.id}
              canEdit={canEditRecords}
              items={experiences}
            />
          </section>
          <section className="flex flex-col gap-3">
            <SectionHeader title="Education" />
            <CandidateEducationList
              organizationId={organizationId}
              candidateId={candidate.id}
              canEdit={canEditRecords}
              items={education}
            />
          </section>
          <section className="flex flex-col gap-3">
            <SectionHeader title="Certifications" />
            <CandidateCertificationList
              organizationId={organizationId}
              candidateId={candidate.id}
              canEdit={canEditRecords}
              items={certifications}
            />
          </section>
          <section className="flex flex-col gap-3">
            <SectionHeader title="Skills" />
            <CandidateSkillList
              organizationId={organizationId}
              candidateId={candidate.id}
              canEdit={canEditRecords}
              items={skills}
            />
          </section>
        </TabsContent>

        <TabsContent value="documents" className="pt-4">
          <CandidateDocumentPanel
            organizationId={organizationId}
            candidateId={candidate.id}
            documents={documents}
            canEdit={canEditDocuments}
          />
        </TabsContent>

        <TabsContent value="ai-processing" className="pt-4">
          <CandidateDocumentProcessingPanel
            organizationId={organizationId}
            candidateId={candidate.id}
            documentOptions={documents
              .filter((d) => d.docType === 'cv' && d.status === 'active')
              .map((d) => ({ id: d.id, label: `${d.fileName} (v${d.versionNo})` }))}
            jobs={processingJobs}
            fields={extractedFields}
            canProcess={canProcessDocuments}
          />
        </TabsContent>

        <TabsContent value="pipeline" className="pt-4">
          <CandidateStagePanel
            organizationId={organizationId}
            candidateId={candidate.id}
            entries={projectEntries}
            availableProjects={availableProjects}
            canTransition={canEditRecords}
            canShare={canEditRecords}
            canAssign={canCreateRecords}
          />
        </TabsContent>

        <TabsContent value="evaluation" className="pt-4">
          <CandidateEvaluationPanel
            organizationId={organizationId}
            candidateId={candidate.id}
            jobs={evaluationJobs}
            matches={evaluationMatches}
            gates={evaluationGates}
            evidence={evaluationEvidence}
            scoring={evaluationScoring}
            runs={evaluationRuns}
            reviews={evaluationReviews}
            canEvaluate={canEvaluate}
            canReview={canReviewMatches}
          />
        </TabsContent>

        <TabsContent value="duplicates" className="pt-4">
          <DuplicateResolutionPanel
            organizationId={organizationId}
            candidateId={candidate.id}
            candidateName={candidate.fullName}
            suggestions={duplicates}
            canMerge={canDeleteRecords}
          />
        </TabsContent>

        <TabsContent value="privacy" className="pt-4">
          <div className="max-w-xl">
            <CandidatePrivacyPanel
              organizationId={organizationId}
              candidateId={candidate.id}
              status={candidate.status}
              consent={consent}
              canManage={canDeleteRecords}
            />
          </div>
        </TabsContent>

        <TabsContent value="preview" className="flex flex-col gap-6 pt-4">
          <p className="text-muted text-sm">
            This preview shows how mandatory-gate and evidence-based scoring will surface once AI CV
            parsing and match scoring are implemented in a later phase — not part of this build.
          </p>

          <section aria-labelledby="gates-heading" className="flex flex-col gap-3">
            <SectionHeader
              title="Mandatory gates"
              badge={
                match && (
                  <StatusBadge
                    status={match.gatesPassed === match.gatesTotal ? 'passed' : 'failed'}
                  >
                    {match.gatesPassed}/{match.gatesTotal} passed
                  </StatusBadge>
                )
              }
            />
            <Card>
              <ul className="divide-outline-cell divide-y">
                {gates.length > 0 ? (
                  gates.map((gate) => (
                    <li key={gate.id} className="flex items-center justify-between px-4 py-3">
                      <span className="text-tertiary text-sm">{gate.requirementLabel}</span>
                      <StatusBadge
                        status={
                          gate.result === 'pass'
                            ? 'passed'
                            : gate.result === 'fail'
                              ? 'failed'
                              : 'pending'
                        }
                      >
                        {gate.result.replace('_', ' ')}
                      </StatusBadge>
                    </li>
                  ))
                ) : (
                  <li className="text-muted px-4 py-6 text-center text-sm">
                    No mandatory-gate evaluation has run for this candidate yet.
                  </li>
                )}
              </ul>
            </Card>
          </section>

          <section aria-labelledby="evidence-heading" className="flex flex-col gap-3">
            <SectionHeader title="Evidence" />
            <Card>
              <ul className="divide-outline-cell divide-y">
                {evidence.length > 0 ? (
                  evidence.map((item) => (
                    <li key={item.id} className="flex flex-col gap-1 px-4 py-3">
                      <p className="text-tertiary text-sm italic">&ldquo;{item.excerpt}&rdquo;</p>
                      <div className="text-muted flex items-center gap-2 text-xs">
                        <span>{item.sourceDocumentName}</span>
                        <StatusBadge
                          status={item.verificationStatus === 'verified' ? 'passed' : 'pending'}
                        >
                          {item.verificationStatus}
                        </StatusBadge>
                      </div>
                    </li>
                  ))
                ) : (
                  <li className="text-muted px-4 py-6 text-center text-sm">
                    No evidence has been extracted for this candidate yet — fields remain
                    unverified.
                  </li>
                )}
              </ul>
            </Card>
          </section>

          {!legacyCandidate && (
            <p className="text-muted text-xs">
              This candidate has no linked AI-scoring preview record (it was created after the
              Phase-1 demo set).
            </p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
