import 'server-only'
import type {
  CandidateEligibility,
  GateResult,
  MandatoryGateComputation,
  MatchRequirementAssessment,
  ScoringCriterionComputation,
} from '@rqi/types'
import type { CandidateEvidenceBundleItem } from '@/lib/ai/matching-provider'
import { runMatchingPipeline, type MatchingPipelineResult } from '@/lib/matching/matching-pipeline'
import { SampleAssessmentMatchingProvider } from '@/lib/matching/demo-sample-assessment-provider'
import { canAddCandidateToShortlist, nextShortlistRank } from '@/lib/shortlists/rules'
import {
  validateProjectStatusTransition,
  computeWorkflowStageStatuses,
  type WorkflowStepDisplay,
} from '@/lib/projects/workflow-state-machine'
import type { ProjectStatus } from '@rqi/types'
import {
  DEMO_SCENARIOS,
  DEMO_CANDIDATE_SEEDS,
  DEMO_OUTREACH_TEMPLATES,
  DEMO_ORG_ID,
  type DemoProjectSeed,
  type DemoCandidateSeed,
} from './scenarios'

/**
 * Build Phase 18 — the private-demo runtime engine (brief steps 3-9).
 *
 * This is the ONE place demo-mode server actions and pages read/write
 * state when `!supabaseConfigured`. It exists so every reported failure
 * (matching, sorting, shortlisting, sourcing, outreach, AI labelling,
 * project flow) can be genuinely exercised end to end WITHOUT a live
 * Supabase or Anthropic credential (the correction from the Build Phase 18
 * brief: "The lack of Supabase and Anthropic credentials is not a blocker
 * for this private demo... provide a complete, honest deterministic demo
 * workflow without external infrastructure").
 *
 * Domain-rule reuse, not reinvention (brief: "Use the same domain rules in
 * demo and connected modes wherever practical"):
 * - Gate/score computation runs through the REAL pipeline
 *   (lib/matching/matching-pipeline.ts -> lib/matching/evaluate.ts ->
 *   gates.ts/scoring.ts), fed by the same honestly-labelled deterministic
 *   stand-in the seed/reset scripts already used
 *   (SampleAssessmentMatchingProvider, model id 'sample-assessment-v1' —
 *   never presented as a live model).
 * - Shortlist max-3/duplicate/eligibility enforcement runs through the
 *   REAL pure rule function (lib/shortlists/rules.ts's
 *   canAddCandidateToShortlist), the same function the live Supabase path
 *   uses as its pre-flight check ahead of the database trigger.
 * - Project-stage transitions run through the REAL state machine
 *   (lib/projects/workflow-state-machine.ts), shared with the live path.
 *
 * PERSISTENCE MODEL, stated honestly: this is a module-level in-memory
 * store, not a database. It persists for the lifetime of the Node process
 * (i.e., for an entire local/staging demo session) and is explicitly
 * reconstructable via resetDemoState(). It is NOT multi-instance-safe and
 * is never used when supabaseConfigured is true. This tradeoff — and why
 * it is acceptable for a private demo — is documented in
 * docs/demo-limitations.md and docs/build-phase-18-client-feedback-repair-report.md.
 */

export type DemoGateStatus = 'passed' | 'failed' | 'unknown'
export type DemoReviewStatus = 'pending_review' | 'reviewed'
export type DemoOutreachStatus = 'draft' | 'approved_not_sent' | 'rejected'
export type DemoOutreachChannel = 'email' | 'linkedin' | 'sms'

export interface DemoEvaluationResult {
  status: 'completed' | 'failed'
  evaluationMode: 'demo_deterministic'
  modelLabel: 'sample-assessment-v1'
  evaluatedAt: string
  scorecardVersion: string
  eligibility: CandidateEligibility | null
  overallScore: number | null
  evidenceCoveragePct: number | null
  dataCompletenessPct: number | null
  confidence: number | null
  gates: {
    requirementId: string
    requirementName: string
    result: DemoGateStatus
    hasEvidence: boolean
  }[]
  criteria: ScoringCriterionComputation[]
  assessments: MatchRequirementAssessment[]
  errorMessage: string | null
}

export interface DemoCandidateState {
  seed: DemoCandidateSeed
  projectId: string
  createdAt: string
  addedVia: 'seed' | 'manual' | 'csv_import'
  latestEvaluation: DemoEvaluationResult | null
  reviewStatus: DemoReviewStatus
}

export interface DemoOutreachDraft {
  id: string
  projectId: string
  candidateId: string
  channel: DemoOutreachChannel
  templateId: string
  subject: string | null
  body: string
  status: DemoOutreachStatus
  createdAt: string
  createdBy: string
  decidedAt: string | null
  decidedBy: string | null
  decisionReason: string | null
}

export interface DemoShortlistEntry {
  candidateId: string
  rank: number
  addedAt: string
  addedBy: string
}

export interface DemoActivityEntry {
  id: string
  projectId: string
  actorName: string
  action: string
  summary: string
  createdAt: string
}

export interface DemoAuditEntry {
  id: string
  projectId: string
  actorName: string
  action: string
  entityType: string
  entityId: string
  metadata: Record<string, unknown>
  createdAt: string
}

export interface DemoProjectState {
  seed: DemoProjectSeed
  status: ProjectStatus
  scorecardApproved: boolean
  requirementsConfirmed: boolean
  shortlistStatus: 'not_started' | 'draft' | 'submitted' | 'client_review' | 'decided'
  shortlist: DemoShortlistEntry[]
  maxShortlistSize: number
}

interface DemoState {
  projects: Map<string, DemoProjectState>
  candidates: Map<string, DemoCandidateState>
  outreachDrafts: Map<string, DemoOutreachDraft>
  activity: DemoActivityEntry[]
  audit: DemoAuditEntry[]
  seq: number
}

let state: DemoState | null = null

function nextId(prefix: string): string {
  if (!state) throw new Error('demo state not initialized')
  state.seq += 1
  return `${prefix}-${state.seq.toString(36)}`
}

function nowIso(): string {
  return new Date().toISOString()
}

function buildInitialState(): DemoState {
  const projects = new Map<string, DemoProjectState>()
  const candidates = new Map<string, DemoCandidateState>()

  for (const seed of DEMO_SCENARIOS) {
    projects.set(seed.id, {
      seed,
      status: 'sourcing',
      scorecardApproved: true,
      requirementsConfirmed: true,
      shortlistStatus: 'not_started',
      shortlist: [],
      maxShortlistSize: 3,
    })
  }

  for (const candSeed of DEMO_CANDIDATE_SEEDS) {
    const projectId = DEMO_SCENARIOS.find((p) => p.candidateIds.includes(candSeed.id))!.id
    candidates.set(candSeed.id, {
      seed: candSeed,
      projectId,
      createdAt: nowIso(),
      addedVia: 'seed',
      latestEvaluation: null,
      reviewStatus: 'pending_review',
    })
  }

  const initial: DemoState = {
    projects,
    candidates,
    outreachDrafts: new Map(),
    activity: [],
    audit: [],
    seq: 0,
  }
  return initial
}

function getState(): DemoState {
  if (!state) state = buildInitialState()
  return state
}

/** Brief step 9's "Ensure demo reset restores the complete scenario." Rebuilds the entire in-memory store from the seed data — the ONLY function that discards prior demo mutations. */
export function resetDemoState(): void {
  state = buildInitialState()
  recordActivityForAllProjects('Demo data reset to the original scenario.')
}

function recordActivityForAllProjects(summary: string) {
  const s = getState()
  for (const projectId of s.projects.keys()) {
    recordActivity(projectId, 'demo.reset', summary, 'System')
  }
}

function recordActivity(projectId: string, action: string, summary: string, actorName: string) {
  const s = getState()
  s.activity.push({
    id: nextId('act'),
    projectId,
    actorName,
    action,
    summary,
    createdAt: nowIso(),
  })
}

function recordAudit(
  projectId: string,
  actorName: string,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown>,
) {
  const s = getState()
  s.audit.push({
    id: nextId('audit'),
    projectId,
    actorName,
    action,
    entityType,
    entityId,
    metadata,
    createdAt: nowIso(),
  })
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function listDemoProjects() {
  const s = getState()
  return Array.from(s.projects.values()).map((p) => summarizeProject(p))
}

function summarizeProject(project: DemoProjectState) {
  const s = getState()
  const candidates = Array.from(s.candidates.values()).filter((c) => c.projectId === project.seed.id)
  const evaluated = candidates.filter((c) => c.latestEvaluation !== null)
  const eligible = evaluated.filter((c) => c.latestEvaluation?.eligibility === 'eligible')
  return {
    id: project.seed.id,
    clientName: project.seed.clientName,
    clientVertical: project.seed.clientVertical,
    roleTitle: project.seed.roleTitle,
    status: project.status,
    candidateCount: candidates.length,
    evaluatedCount: evaluated.length,
    eligibleCount: eligible.length,
    shortlistCount: project.shortlist.length,
    shortlistStatus: project.shortlistStatus,
  }
}

export function getDemoProject(projectId: string) {
  const s = getState()
  const project = s.projects.get(projectId)
  if (!project) return null
  return summarizeProject(project)
}

export function getDemoProjectStageSignals(projectId: string): WorkflowStepDisplay[] {
  const s = getState()
  const project = s.projects.get(projectId)
  if (!project) return []
  const candidates = Array.from(s.candidates.values()).filter((c) => c.projectId === projectId)
  const evaluated = candidates.filter((c) => c.latestEvaluation?.status === 'completed')
  const eligible = evaluated.filter((c) => c.latestEvaluation?.eligibility === 'eligible')
  const drafts = Array.from(s.outreachDrafts.values()).filter((d) => d.projectId === projectId)

  return computeWorkflowStageStatuses({
    jobDescriptionAdded: true, // seeded with a parsed JD
    requirementsConfirmed: project.requirementsConfirmed,
    scorecardApproved: project.scorecardApproved,
    candidatesAdded: candidates.length > 0,
    candidatesEvaluated: evaluated.length > 0,
    eligibleCandidateExists: eligible.length > 0,
    shortlistBuilt: project.shortlist.length > 0,
    outreachDrafted: drafts.length > 0,
  })
}

export function getDemoJob(projectId: string) {
  const s = getState()
  const project = s.projects.get(projectId)
  if (!project) return null
  return project.seed.job
}

/** Every demo job belongs to exactly one demo project (1:1 in the seed scenarios) — this is the lookup the live-mode-shaped `jobId` form field needs to reach the right project in the engine. */
export function getDemoProjectIdForJob(jobId: string): string | null {
  const s = getState()
  for (const project of s.projects.values()) {
    if (project.seed.job.id === jobId) return project.seed.id
  }
  return null
}

/** The inverse lookup — the job id the candidate-evaluation panel's `jobId` form field needs, given a demo project id. */
export function getDemoJobIdForProject(projectId: string): string {
  const s = getState()
  const project = s.projects.get(projectId)
  if (!project) throw new Error(`Unknown demo project: ${projectId}`)
  return project.seed.job.id
}

export function listDemoCandidatesForProject(projectId: string) {
  const s = getState()
  return Array.from(s.candidates.values())
    .filter((c) => c.projectId === projectId)
    .map((c) => publicCandidate(c))
}

function publicCandidate(c: DemoCandidateState) {
  const s = getState()
  const isShortlisted = s.projects.get(c.projectId)?.shortlist.some((e) => e.candidateId === c.seed.id) ?? false
  return {
    id: c.seed.id,
    projectId: c.projectId,
    fullName: c.seed.fullName,
    currentTitle: c.seed.currentTitle,
    currentCompany: c.seed.currentCompany,
    location: c.seed.location,
    yearsExperience: c.seed.yearsExperience,
    email: c.seed.email,
    phone: c.seed.phone,
    source: c.seed.source,
    createdAt: c.createdAt,
    addedVia: c.addedVia,
    reviewStatus: c.reviewStatus,
    isShortlisted,
    evaluation: c.latestEvaluation,
  }
}

export function getDemoCandidate(candidateId: string) {
  const s = getState()
  const c = s.candidates.get(candidateId)
  if (!c) return null
  return publicCandidate(c)
}

export type DemoSortKey =
  | 'score_desc'
  | 'score_asc'
  | 'recently_evaluated'
  | 'recently_created'
  | 'review_status'
  | 'gate_status'

/**
 * Brief step 4 ("Repair sorting"). Eligible candidates are ALWAYS
 * partitioned ahead of ineligible/pending ones regardless of the requested
 * sort key (brief: "Ineligible candidates must not appear above eligible
 * candidates merely because of their numerical score") — this mirrors the
 * real live-mode query in lib/shortlists/load-detail.ts, which filters to
 * `eligibility = 'eligible'` before ever sorting.
 */
export function sortDemoCandidates(projectId: string, sortKey: DemoSortKey = 'score_desc') {
  const all = listDemoCandidatesForProject(projectId)
  const eligible = all.filter((c) => c.evaluation?.eligibility === 'eligible')
  const notEligible = all.filter((c) => c.evaluation?.eligibility !== 'eligible')

  function byKey(a: (typeof all)[number], b: (typeof all)[number]): number {
    switch (sortKey) {
      case 'score_asc':
        return (a.evaluation?.overallScore ?? 0) - (b.evaluation?.overallScore ?? 0)
      case 'recently_evaluated':
        return (b.evaluation?.evaluatedAt ?? '').localeCompare(a.evaluation?.evaluatedAt ?? '')
      case 'recently_created':
        return b.createdAt.localeCompare(a.createdAt)
      case 'review_status':
        return a.reviewStatus.localeCompare(b.reviewStatus)
      case 'gate_status': {
        const rank = (c: (typeof all)[number]) =>
          c.evaluation?.eligibility === 'eligible' ? 0 : c.evaluation?.eligibility === 'pending_verification' ? 1 : 2
        return rank(a) - rank(b)
      }
      case 'score_desc':
      default:
        return (b.evaluation?.overallScore ?? 0) - (a.evaluation?.overallScore ?? 0)
    }
  }

  eligible.sort(byKey)
  // Ineligible/pending candidates are always shown, honestly, just never
  // ranked above eligible ones — default secondary order: most recently
  // evaluated first, so a reviewer sees the newest failures/pending items.
  notEligible.sort((a, b) => (b.evaluation?.evaluatedAt ?? '').localeCompare(a.evaluation?.evaluatedAt ?? ''))

  return { eligible, notEligible }
}

/** Rank/added-by metadata for the candidates currently on a project's shortlist — used by the shortlist workspace UI to show rank order. */
export function getDemoShortlistEntries(projectId: string): DemoShortlistEntry[] {
  const s = getState()
  const project = s.projects.get(projectId)
  if (!project) return []
  return [...project.shortlist].sort((a, b) => a.rank - b.rank)
}

export function getDemoActivity(projectId: string): DemoActivityEntry[] {
  const s = getState()
  return s.activity.filter((a) => a.projectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function getDemoAuditEvents(projectId: string): DemoAuditEntry[] {
  const s = getState()
  return s.audit.filter((a) => a.projectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function listDemoOutreachDrafts(projectId?: string): DemoOutreachDraft[] {
  const s = getState()
  const drafts = Array.from(s.outreachDrafts.values())
  return (projectId ? drafts.filter((d) => d.projectId === projectId) : drafts).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )
}

export function listDemoOutreachTemplates() {
  return DEMO_OUTREACH_TEMPLATES
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface DemoActionResult<T = undefined> {
  success: boolean
  message: string
  data?: T
}

/** Brief step 2/8 ("Repair candidate matching", "Wire the deterministic demo evaluation"). */
export async function runDemoEvaluation(
  projectId: string,
  candidateId: string,
  actorName: string,
): Promise<DemoActionResult> {
  const s = getState()
  const project = s.projects.get(projectId)
  const candidate = s.candidates.get(candidateId)
  if (!project || !candidate || candidate.projectId !== projectId) {
    return { success: false, message: 'Candidate or project not found.' }
  }
  if (!project.scorecardApproved) {
    return { success: false, message: 'Evaluation requires an approved scorecard.' }
  }

  // The seed data already knows, honestly, which requirement each evidence
  // item was captured against (`evidenceByRequirement` is keyed by
  // requirementId — see lib/demo/scenarios.ts). The deterministic sample
  // provider (lib/matching/demo-sample-assessment-provider.ts) mirrors a
  // real AI provider's contract and only receives a flat, unlabeled
  // evidence bundle, so it identifies relevant evidence the same way the
  // test adapter does: a case-insensitive substring match of the
  // requirement's name against each item's text. Tagging each item with
  // its already-known requirement name here is not inventing evidence —
  // it is preserving the one fact this seed structure already states
  // (which requirement this item was captured against) through a bundle
  // shape that intentionally drops it, so the same substring-matching
  // provider used elsewhere works correctly for naturalistic demo
  // evidence text that does not itself repeat the requirement's exact name.
  const requirementNameById = new Map(
    project.seed.job.requirements.map((r) => [r.requirementId, r.name]),
  )
  const candidateEvidence: CandidateEvidenceBundleItem[] = Object.entries(
    candidate.seed.evidenceByRequirement,
  ).flatMap(([requirementId, items]) => {
    const reqName = requirementNameById.get(requirementId)
    return items.map((item) => ({
      ...item,
      text: reqName && !item.text.toLowerCase().includes(reqName.toLowerCase())
        ? `${reqName}: ${item.text}`
        : item.text,
    }))
  })

  const pipelineResult: MatchingPipelineResult = await runMatchingPipeline({
    jobTitle: project.seed.job.title,
    requirements: project.seed.job.requirements,
    candidateEvidence,
    aiProvider: new SampleAssessmentMatchingProvider(),
  })

  const evaluatedAt = nowIso()

  if (pipelineResult.status !== 'completed' || !pipelineResult.deterministic) {
    candidate.latestEvaluation = {
      status: 'failed',
      evaluationMode: 'demo_deterministic',
      modelLabel: 'sample-assessment-v1',
      evaluatedAt,
      scorecardVersion: `${projectId}:v1`,
      eligibility: null,
      overallScore: null,
      evidenceCoveragePct: null,
      dataCompletenessPct: null,
      confidence: null,
      gates: [],
      criteria: [],
      assessments: [],
      errorMessage: pipelineResult.errorMessage ?? 'The demonstration evaluation could not be completed.',
    }
    recordActivity(
      projectId,
      'candidate.evaluation_failed',
      `Demonstration evaluation failed for ${candidate.seed.fullName}: ${candidate.latestEvaluation.errorMessage}`,
      actorName,
    )
    return { success: false, message: candidate.latestEvaluation.errorMessage! }
  }

  const det = pipelineResult.deterministic
  const gates: MandatoryGateComputation[] = det.gates
  candidate.latestEvaluation = {
    status: 'completed',
    evaluationMode: 'demo_deterministic',
    modelLabel: 'sample-assessment-v1',
    evaluatedAt,
    scorecardVersion: `${projectId}:v1`,
    eligibility: det.eligibility,
    overallScore: det.weighted.overallScore,
    evidenceCoveragePct: det.weighted.evidenceCoveragePct,
    dataCompletenessPct: det.weighted.dataCompletenessPct,
    confidence: det.weighted.confidence,
    gates: gates.map((g: MandatoryGateComputation & { deterministicResult: GateResult }) => ({
      requirementId: g.requirementId,
      requirementName: g.requirementName,
      result: g.deterministicResult === 'pass' ? 'passed' : g.deterministicResult === 'fail' ? 'failed' : 'unknown',
      hasEvidence: g.hasAnyEvidence,
    })),
    criteria: det.criteria,
    assessments: pipelineResult.ai.validated?.assessments ?? [],
    errorMessage: null,
  }
  candidate.reviewStatus = 'pending_review'

  recordActivity(
    projectId,
    'candidate.evaluated',
    `Ran demonstration evaluation for ${candidate.seed.fullName}: ${det.eligibility}${
      det.weighted.overallScore !== null ? `, score ${det.weighted.overallScore}` : ''
    }.`,
    actorName,
  )
  recordAudit(projectId, actorName, 'candidate_match.evaluated', 'candidate', candidateId, {
    eligibility: det.eligibility,
    overallScore: det.weighted.overallScore,
    evaluationMode: 'demo_deterministic',
  })

  return { success: true, message: 'Demonstration evaluation complete — live AI is not connected.' }
}

export function markDemoCandidateReviewed(
  projectId: string,
  candidateId: string,
  actorName: string,
): DemoActionResult {
  const s = getState()
  const candidate = s.candidates.get(candidateId)
  if (!candidate || candidate.projectId !== projectId) {
    return { success: false, message: 'Candidate not found.' }
  }
  if (!candidate.latestEvaluation || candidate.latestEvaluation.status !== 'completed') {
    return { success: false, message: 'This candidate has not been evaluated yet.' }
  }
  candidate.reviewStatus = 'reviewed'
  recordActivity(projectId, 'candidate.reviewed', `${candidate.seed.fullName} marked reviewed by ${actorName}.`, actorName)
  recordAudit(projectId, actorName, 'candidate_match.review_decided', 'candidate', candidateId, {
    decision: 'reviewed',
  })
  return { success: true, message: 'Marked as reviewed.' }
}

/** Brief step 5 ("Repair shortlisting") — enforces the SAME pure rule the live path uses, server-side (this function, not the UI, is authoritative). */
export function shortlistDemoCandidate(
  projectId: string,
  candidateId: string,
  actorName: string,
): DemoActionResult {
  const s = getState()
  const project = s.projects.get(projectId)
  const candidate = s.candidates.get(candidateId)
  if (!project || !candidate || candidate.projectId !== projectId) {
    return { success: false, message: 'Candidate or project not found.' }
  }
  if (!candidate.latestEvaluation || candidate.latestEvaluation.status !== 'completed') {
    return { success: false, message: 'This candidate has not been evaluated yet.' }
  }
  if (candidate.reviewStatus !== 'reviewed') {
    return { success: false, message: 'This candidate must be reviewed before being shortlisted.' }
  }

  const violation = canAddCandidateToShortlist({
    shortlist: { maxCandidates: project.maxShortlistSize, overrideMaxCandidates: false },
    existingCandidates: project.shortlist.map((e) => ({ candidateId: e.candidateId })),
    candidate: { candidateId, eligibility: candidate.latestEvaluation.eligibility ?? 'ineligible' },
  })
  if (violation) return { success: false, message: violation.message }

  const rank = nextShortlistRank(project.shortlist.map((e) => ({ rank: e.rank })))
  project.shortlist.push({ candidateId, rank, addedAt: nowIso(), addedBy: actorName })
  project.shortlistStatus = 'draft'

  recordActivity(projectId, 'shortlist.candidate_added', `${candidate.seed.fullName} added to the shortlist by ${actorName}.`, actorName)
  recordAudit(projectId, actorName, 'shortlist.candidate_added', 'shortlist_candidate', candidateId, {
    rank,
  })
  return { success: true, message: `${candidate.seed.fullName} added to the shortlist.` }
}

export function removeDemoShortlistCandidate(
  projectId: string,
  candidateId: string,
  actorName: string,
): DemoActionResult {
  const s = getState()
  const project = s.projects.get(projectId)
  if (!project) return { success: false, message: 'Project not found.' }
  const before = project.shortlist.length
  project.shortlist = project.shortlist.filter((e) => e.candidateId !== candidateId)
  if (project.shortlist.length === before) {
    return { success: false, message: 'This candidate is not on the shortlist.' }
  }
  if (project.shortlist.length === 0) project.shortlistStatus = 'not_started'
  recordActivity(projectId, 'shortlist.candidate_removed', `A candidate was removed from the shortlist by ${actorName}.`, actorName)
  recordAudit(projectId, actorName, 'shortlist.candidate_removed', 'shortlist_candidate', candidateId, {})
  return { success: true, message: 'Removed from the shortlist.' }
}

export function submitDemoShortlist(projectId: string, actorName: string): DemoActionResult {
  const s = getState()
  const project = s.projects.get(projectId)
  if (!project) return { success: false, message: 'Project not found.' }
  if (project.shortlist.length === 0) return { success: false, message: 'Add at least one candidate before submitting.' }
  project.shortlistStatus = 'submitted'
  recordActivity(projectId, 'shortlist.submitted', `Shortlist submitted for approval by ${actorName}.`, actorName)
  recordAudit(projectId, actorName, 'shortlist.submitted', 'shortlist', projectId, {
    candidateCount: project.shortlist.length,
  })
  return { success: true, message: 'Shortlist submitted.' }
}

// ---------------------------------------------------------------------------
// Candidate creation / import — brief step 6
// ---------------------------------------------------------------------------

export interface DemoNewCandidateInput {
  fullName: string
  primaryEmail?: string
  primaryPhone?: string
  currentTitle?: string
  currentCompany?: string
  location?: string
  sourceChannel?: DemoCandidateSeed['source']
  sourceDetail?: string
}

function findDuplicateCandidate(input: DemoNewCandidateInput): DemoCandidateState | null {
  const s = getState()
  for (const c of s.candidates.values()) {
    const emailMatch =
      input.primaryEmail && c.seed.email && input.primaryEmail.toLowerCase() === c.seed.email.toLowerCase()
    const phoneMatch = input.primaryPhone && c.seed.phone && input.primaryPhone === c.seed.phone
    if (emailMatch || phoneMatch) return c
  }
  return null
}

export function addDemoCandidate(
  projectId: string,
  input: DemoNewCandidateInput,
  actorName: string,
): DemoActionResult<{ candidateId: string }> {
  const s = getState()
  const project = s.projects.get(projectId)
  if (!project) return { success: false, message: 'Project not found.' }
  if (!input.fullName || input.fullName.trim().length === 0) {
    return { success: false, message: 'Full name is required.' }
  }

  const duplicate = findDuplicateCandidate(input)
  if (duplicate) {
    return {
      success: false,
      message: `A candidate with this email or phone already exists (${duplicate.seed.fullName}). Not added again.`,
    }
  }

  const id = nextId('demo-cand')
  const seed: DemoCandidateSeed = {
    id,
    fullName: input.fullName.trim(),
    currentTitle: input.currentTitle?.trim() || 'Unverified',
    currentCompany: input.currentCompany?.trim() || 'Unverified',
    location: input.location?.trim() || 'Unverified',
    yearsExperience: 0,
    email: input.primaryEmail?.trim() || '',
    phone: input.primaryPhone?.trim() || '',
    source: input.sourceChannel ?? 'manual',
    evidenceByRequirement: {},
  }
  s.candidates.set(id, {
    seed,
    projectId,
    createdAt: nowIso(),
    addedVia: 'manual',
    latestEvaluation: null,
    reviewStatus: 'pending_review',
  })

  recordActivity(projectId, 'candidate.created', `${seed.fullName} added manually by ${actorName}.`, actorName)
  recordAudit(projectId, actorName, 'candidate.created', 'candidate', id, { source: seed.source })

  return { success: true, message: `${seed.fullName} added.`, data: { candidateId: id } }
}

export function importDemoCandidatesCsv(
  projectId: string,
  rows: DemoNewCandidateInput[],
  actorName: string,
): DemoActionResult<{ addedCount: number; skippedCount: number }> {
  const s = getState()
  const project = s.projects.get(projectId)
  if (!project) return { success: false, message: 'Project not found.' }
  let added = 0
  let skipped = 0
  for (const row of rows) {
    const result = addDemoCandidate(projectId, { ...row, sourceChannel: 'csv_import' }, actorName)
    if (result.success) added += 1
    else skipped += 1
  }
  recordActivity(
    projectId,
    'candidate.csv_imported',
    `CSV import by ${actorName}: ${added} added, ${skipped} skipped (duplicates or invalid rows).`,
    actorName,
  )
  return {
    success: added > 0,
    message: `${added} candidate(s) imported, ${skipped} skipped.`,
    data: { addedCount: added, skippedCount: skipped },
  }
}

// ---------------------------------------------------------------------------
// Outreach — brief step 7
// ---------------------------------------------------------------------------

function interpolateTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '')
}

export function createDemoOutreachDraft(
  projectId: string,
  candidateId: string,
  templateId: string,
  actorName: string,
): DemoActionResult<{ draftId: string }> {
  const s = getState()
  const project = s.projects.get(projectId)
  const candidate = s.candidates.get(candidateId)
  if (!project || !candidate || candidate.projectId !== projectId) {
    return { success: false, message: 'Candidate or project not found.' }
  }
  if (candidate.latestEvaluation?.eligibility !== 'eligible') {
    return {
      success: false,
      message: 'Outreach can only be drafted for a candidate who has passed every mandatory requirement.',
    }
  }
  const template = DEMO_OUTREACH_TEMPLATES.find((t) => t.id === templateId)
  if (!template) return { success: false, message: 'Unknown outreach template.' }

  const vars = {
    firstName: candidate.seed.fullName.split(' ')[0] ?? candidate.seed.fullName,
    roleTitle: project.seed.roleTitle,
    clientName: project.seed.clientName,
    currentCompany: candidate.seed.currentCompany,
    recruiterName: actorName,
  }

  const id = nextId('demo-outreach')
  const draft: DemoOutreachDraft = {
    id,
    projectId,
    candidateId,
    channel: template.channel,
    templateId,
    subject: template.subject ? interpolateTemplate(template.subject, vars) : null,
    body: interpolateTemplate(template.body, vars),
    status: 'draft',
    createdAt: nowIso(),
    createdBy: actorName,
    decidedAt: null,
    decidedBy: null,
    decisionReason: null,
  }
  s.outreachDrafts.set(id, draft)

  recordActivity(
    projectId,
    'outreach.draft_created',
    `Draft ${template.channel} outreach generated for ${candidate.seed.fullName} by ${actorName}. Demo mode — messages are not sent.`,
    actorName,
  )
  recordAudit(projectId, actorName, 'outreach.draft_created', 'outreach_message', id, {
    channel: template.channel,
    candidateId,
  })

  return { success: true, message: 'Draft generated. Demo mode — messages are not sent.', data: { draftId: id } }
}

export function decideDemoOutreachDraft(
  draftId: string,
  decision: 'approve' | 'reject',
  actorName: string,
  reason?: string,
): DemoActionResult {
  const s = getState()
  const draft = s.outreachDrafts.get(draftId)
  if (!draft) return { success: false, message: 'Draft not found.' }
  if (draft.status !== 'draft') return { success: false, message: 'This draft has already been decided.' }

  // No external provider is ever invoked here, on approval or otherwise —
  // this function performs a pure state transition and nothing else. This
  // is the entire "send" implementation in the private demo, by design.
  draft.status = decision === 'approve' ? 'approved_not_sent' : 'rejected'
  draft.decidedAt = nowIso()
  draft.decidedBy = actorName
  draft.decisionReason = reason ?? null

  const candidate = s.candidates.get(draft.candidateId)
  recordActivity(
    draft.projectId,
    `outreach.${decision}d`,
    `${actorName} ${decision === 'approve' ? 'approved' : 'rejected'} the ${draft.channel} draft for ${
      candidate?.seed.fullName ?? 'a candidate'
    }. No message was sent — demo mode.`,
    actorName,
  )
  recordAudit(draft.projectId, actorName, `outreach.${decision}d`, 'outreach_message', draftId, {
    decision,
    reason: reason ?? null,
    sent: false,
  })

  return {
    success: true,
    message:
      decision === 'approve'
        ? 'Approved. Demo mode — messages are not sent.'
        : 'Draft rejected.',
  }
}

// ---------------------------------------------------------------------------
// Project stage transitions — brief step 1 / step 9
// ---------------------------------------------------------------------------

export function transitionDemoProjectStatus(
  projectId: string,
  next: ProjectStatus,
  actorName: string,
): DemoActionResult {
  const s = getState()
  const project = s.projects.get(projectId)
  if (!project) return { success: false, message: 'Project not found.' }

  const candidates = Array.from(s.candidates.values()).filter((c) => c.projectId === projectId)
  const hasEvaluatedCandidate = candidates.some((c) => c.latestEvaluation?.status === 'completed')

  const reason = validateProjectStatusTransition(project.status, next, {
    scorecardApproved: project.scorecardApproved,
    hasEvaluatedCandidate,
    shortlistSubmitted: project.shortlistStatus === 'submitted' || project.shortlistStatus === 'client_review' || project.shortlistStatus === 'decided',
    clientDecisionRecorded: project.shortlistStatus === 'decided',
  })
  if (reason) return { success: false, message: reason }

  const previous = project.status
  project.status = next
  recordActivity(projectId, 'project.status_changed', `Project moved from "${previous}" to "${next}" by ${actorName}.`, actorName)
  recordAudit(projectId, actorName, 'project.status_changed', 'recruitment_project', projectId, {
    from: previous,
    to: next,
  })
  return { success: true, message: `Project status is now "${next}".` }
}

export const DEMO_ORG = DEMO_ORG_ID
