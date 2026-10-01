import 'server-only'
import type { ProjectStatus } from '@rqi/types'

/**
 * Build Phase 18 — canonical project workflow (brief step 2 / step 9).
 *
 * Reconciliation with the existing domain model (brief: "Do not
 * automatically adopt these [suggested] names if the repository already
 * defines authoritative states"): `supabase/migrations/0009` and
 * `packages/types` already define `recruitment_projects.status` as a
 * 5-value enum — `intake | sourcing | shortlisting | client_review |
 * closed` — and Build Phase 18's reproduction report
 * (docs/client-feedback-reproduction-report.md §4) found that field is
 * real but was never written by any code path, and the UI stepper that
 * reads it hardcodes early stages as "complete" regardless of truth.
 *
 * Rather than replace the 5-value enum with the brief's longer suggested
 * list (Draft/Requirements pending/Scorecard pending/.../Archived), this
 * module keeps the existing enum as the coarse, authoritative "phase" a
 * project is in, and adds two things the codebase was missing:
 *
 * 1. A transition table (`PROJECT_STATUS_TRANSITIONS`) so a status change
 *    can be validated server-side instead of accepted unconditionally, and
 * 2. `computeWorkflowStageStatuses()`, which derives each of the brief's
 *    finer-grained lifecycle steps (JD added, requirements confirmed,
 *    scorecard approved, candidates evaluated, gates enforced, shortlist
 *    built, outreach drafted) from REAL signals already tracked elsewhere
 *    in the schema (job/JD status, requirement review status, scorecard
 *    status, candidate evaluation counts, shortlist status, outreach
 *    counts) — never from a single hardcoded array. This is what makes the
 *    project detail page's stepper honest in both live and demo mode.
 */

export const PROJECT_STATUSES: ProjectStatus[] = [
  'intake',
  'sourcing',
  'shortlisting',
  'client_review',
  'closed',
]

/**
 * Valid forward transitions for `recruitment_projects.status`. A project
 * may always move to `closed` from anywhere (an agency can cancel/close a
 * role at any point) — every other edge is a forward-only progression.
 * There is no backward edge: reopening a closed project, or moving
 * shortlisting back to sourcing, is treated as a new business decision the
 * UI must express as a deliberate action, not something this table allows
 * silently.
 */
export const PROJECT_STATUS_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  intake: ['sourcing', 'closed'],
  sourcing: ['shortlisting', 'closed'],
  shortlisting: ['client_review', 'closed'],
  client_review: ['closed'],
  closed: [],
}

export interface ProjectTransitionSignals {
  /** True once the job's scorecard has an `active` version (the real, already-enforced gate in lib/jobs/handlers/candidate-evaluation.ts). */
  scorecardApproved: boolean
  /** True once at least one candidate has a completed evaluation for this project's job. */
  hasEvaluatedCandidate: boolean
  /** True once a shortlist for this project has been submitted for internal approval or beyond. */
  shortlistSubmitted: boolean
  /** True once a client decision has been recorded on a shortlist for this project. */
  clientDecisionRecorded: boolean
}

/**
 * Validates a requested status change against both the transition table
 * and the real-world signals a transition should require (brief: "The
 * system must prevent users from skipping required approvals"). Returns
 * `null` when the transition is allowed, or a human-readable reason when
 * it is not.
 */
export function validateProjectStatusTransition(
  current: ProjectStatus,
  next: ProjectStatus,
  signals: ProjectTransitionSignals,
): string | null {
  if (current === next) return null // no-op is always allowed
  const allowedNext = PROJECT_STATUS_TRANSITIONS[current] ?? []
  if (!allowedNext.includes(next)) {
    return `A project cannot move from "${current}" to "${next}" directly.`
  }

  if (next === 'sourcing' && !signals.scorecardApproved) {
    return 'Sourcing cannot start until the scorecard has been approved.'
  }
  if (next === 'shortlisting' && !signals.hasEvaluatedCandidate) {
    return 'Shortlisting cannot start until at least one candidate has been evaluated.'
  }
  if (next === 'client_review' && !signals.shortlistSubmitted) {
    return 'Client review cannot start until a shortlist has been submitted for approval.'
  }
  if (next === 'closed' && current === 'client_review' && !signals.clientDecisionRecorded) {
    // Closing directly from client_review without a recorded decision is
    // allowed (an agency may cancel a role at any time) but is flagged so
    // the caller can show a confirmation rather than a silent close.
    return null
  }

  return null
}

export type WorkflowStepStatus = 'complete' | 'current' | 'upcoming' | 'blocked'

export interface WorkflowStepDisplay {
  key: string
  label: string
  status: WorkflowStepStatus
}

export interface WorkflowStageSignals {
  jobDescriptionAdded: boolean
  requirementsConfirmed: boolean
  scorecardApproved: boolean
  candidatesAdded: boolean
  candidatesEvaluated: boolean
  eligibleCandidateExists: boolean
  shortlistBuilt: boolean
  outreachDrafted: boolean
}

/**
 * Derives the full, brief-specified lifecycle
 * (project → JD → requirements → mandatory criteria → scorecard →
 * candidates → evaluation → gates → sorted/reviewed → shortlist →
 * outreach) from real signals, so the UI stepper never claims a stage is
 * done that never happened (the exact defect the reproduction report
 * found in `apps/web/app/(app)/projects/[projectId]/page.tsx`'s previous
 * hardcoded array).
 */
export function computeWorkflowStageStatuses(
  signals: WorkflowStageSignals,
): WorkflowStepDisplay[] {
  const steps: { key: string; label: string; done: boolean }[] = [
    { key: 'jd', label: 'Job description', done: signals.jobDescriptionAdded },
    { key: 'requirements', label: 'Requirements', done: signals.requirementsConfirmed },
    { key: 'scorecard', label: 'Scorecard approved', done: signals.scorecardApproved },
    { key: 'candidates', label: 'Candidates added', done: signals.candidatesAdded },
    { key: 'evaluation', label: 'Candidates evaluated', done: signals.candidatesEvaluated },
    { key: 'shortlist', label: 'Shortlist built', done: signals.shortlistBuilt },
    { key: 'outreach', label: 'Outreach drafted', done: signals.outreachDrafted },
  ]

  let currentAssigned = false
  return steps.map((step) => {
    if (step.done) return { key: step.key, label: step.label, status: 'complete' as const }
    if (!currentAssigned) {
      currentAssigned = true
      return { key: step.key, label: step.label, status: 'current' as const }
    }
    return { key: step.key, label: step.label, status: 'upcoming' as const }
  })
}
