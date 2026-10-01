'use client'

import { useMemo, useState, useTransition } from 'react'
import {
  Alert,
  Button,
  Card,
  CardBody,
  Dialog,
  DialogContent,
  EmptyState,
  FormField,
  ProgressIndicator,
  Select,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@rqi/ui'
import {
  overrideMandatoryGateAction,
  recordReviewDecisionAction,
  requestGateVerificationAction,
  runMatchingEvaluationAction,
} from '@/lib/matching/matching-actions'
import { SampleAssessmentNotice } from '@/components/domain/sample-assessment-notice'

/**
 * Candidate x role evaluation UI (Build Phase 7 brief §UI): candidate
 * evaluation, mandatory-gate results, score breakdown, evidence viewer,
 * missing-information alerts, risks, human-review decision, request-
 * verification action, approve-for-outreach, reject-with-reason,
 * evaluation history, and mobile evaluation tabs.
 *
 * A candidate can be evaluated against more than one role (matches are
 * keyed by candidate x job), so this panel starts with a role picker, then
 * renders one nested Tabs group (Overview / Gates / Evidence / History)
 * per selected role — the same stacked, single-column-reflow layout
 * established by CandidateDocumentProcessingPanel (Build Phase 6),
 * satisfying "Mobile evaluation tabs" without a second implementation.
 *
 * §"Do not combine these into one misleading number": eligibility, overall
 * score, evidence coverage, data completeness, confidence and review
 * status are always rendered as separate fields below, never folded
 * together.
 */

export interface JobOption {
  id: string
  title: string
}

export interface MatchSummary {
  id: string
  jobId: string
  latestMatchingRunId: string
  eligibility: 'eligible' | 'ineligible' | 'pending_verification'
  overallScore: number | null
  evidenceCoveragePct: number
  dataCompletenessPct: number
  confidence: number | null
  reviewStatus: 'pending' | 'approved_for_outreach' | 'rejected' | 'requires_verification'
  reviewedAt: string | null
  updatedAt: string
}

export interface GateResultSummary {
  id: string
  candidateRoleMatchId: string
  matchingRunId: string
  requirementId: string
  requirementName: string
  deterministicResult: 'pass' | 'fail' | 'insufficient_evidence'
  aiSuggestedResult: string | null
  aiSuggestionNote: string | null
  riskNotes: string[]
  state: 'passed' | 'failed' | 'unknown' | 'requires_verification' | 'human_override'
  verificationNote: string | null
  overrideResult: 'pass' | 'fail' | null
  overrideReason: string | null
  overrideEvidenceNote: string | null
  overrideAt: string | null
}

export interface EvidenceSummary {
  id: string
  candidateRoleMatchId: string
  matchingRunId: string
  requirementId: string
  sourceKind: string
  excerpt: string
  location: string | null
  relevanceScore: number | null
  confidence: number | null
  isDirectStatement: boolean
}

export interface ScoringBreakdownSummary {
  id: string
  candidateRoleMatchId: string
  matchingRunId: string
  requirementId: string
  requirementName: string
  weight: number
  effectiveScore: number | null
  weightedContribution: number
  hasEvidence: boolean
  riskNotes: string[]
}

export interface MatchingRunSummary {
  id: string
  jobId: string
  status: string
  triggerReason: string
  triggerNote: string | null
  errorKind: string | null
  errorMessage: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
}

export interface HumanReviewSummary {
  id: string
  candidateRoleMatchId: string
  decision: string
  reason: string | null
  createdAt: string
}

const GATE_STATE_BADGE: Record<
  GateResultSummary['state'],
  'passed' | 'failed' | 'pending' | 'neutral'
> = {
  passed: 'passed',
  failed: 'failed',
  unknown: 'pending',
  requires_verification: 'pending',
  human_override: 'neutral',
}

const ELIGIBILITY_BADGE: Record<MatchSummary['eligibility'], 'passed' | 'failed' | 'pending'> = {
  eligible: 'passed',
  ineligible: 'failed',
  pending_verification: 'pending',
}

const REVIEW_STATUS_BADGE: Record<
  MatchSummary['reviewStatus'],
  'passed' | 'failed' | 'pending' | 'neutral'
> = {
  pending: 'neutral',
  approved_for_outreach: 'passed',
  rejected: 'failed',
  requires_verification: 'pending',
}

const RUN_STATUS_BADGE: Record<string, 'passed' | 'failed' | 'pending' | 'neutral'> = {
  queued: 'pending',
  evaluating_gates: 'pending',
  assessing_semantic: 'pending',
  scoring: 'pending',
  completed: 'passed',
  failed: 'failed',
}

function pct(value: number | null): string {
  return value === null ? '—' : `${value}%`
}

function GateOverrideDialog({
  organizationId,
  candidateId,
  candidateRoleMatchId,
  gate,
  onDone,
}: {
  organizationId: string
  candidateId: string
  candidateRoleMatchId: string
  gate: GateResultSummary
  onDone: (message: string | null, success: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<'pass' | 'fail'>('pass')
  const [reason, setReason] = useState('')
  const [evidenceNote, setEvidenceNote] = useState('')
  const [pending, startTransition] = useTransition()

  function submit() {
    const formData = new FormData()
    formData.set('organizationId', organizationId)
    formData.set('candidateId', candidateId)
    formData.set('candidateRoleMatchId', candidateRoleMatchId)
    formData.set('gateResultId', gate.id)
    formData.set('overrideResult', result)
    formData.set('reason', reason)
    formData.set('evidenceNote', evidenceNote)
    startTransition(async () => {
      const outcome = await overrideMandatoryGateAction(formData)
      onDone(outcome.message ?? null, outcome.success)
      if (outcome.success) {
        setOpen(false)
        setReason('')
        setEvidenceNote('')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Override
      </Button>
      {open && (
        <DialogContent
          title={`Override: ${gate.requirementName}`}
          description="A human override requires an authorized role, a reason and supporting evidence — every field below is recorded to the audit trail."
        >
          <div className="flex flex-col gap-3">
            <FormField label="Override result" htmlFor="override-result">
              <Select
                options={[
                  { value: 'pass', label: 'Pass' },
                  { value: 'fail', label: 'Fail' },
                ]}
                value={result}
                onValueChange={(value) => setResult(value as 'pass' | 'fail')}
              />
            </FormField>
            <FormField label="Reason" htmlFor="override-reason" required>
              <Textarea
                id="override-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder="Why does the deterministic result need to be overridden?"
              />
            </FormField>
            <FormField label="Supporting evidence" htmlFor="override-evidence" required>
              <Textarea
                id="override-evidence"
                value={evidenceNote}
                onChange={(e) => setEvidenceNote(e.target.value)}
                rows={2}
                placeholder="What evidence supports this override (e.g. a document reference, a direct recruiter conversation)?"
              />
            </FormField>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button
                onClick={submit}
                loading={pending}
                disabled={reason.trim().length === 0 || evidenceNote.trim().length === 0}
              >
                Record override
              </Button>
            </div>
          </div>
        </DialogContent>
      )}
    </Dialog>
  )
}

function GateRow({
  organizationId,
  candidateId,
  candidateRoleMatchId,
  gate,
  canReview,
  onDone,
}: {
  organizationId: string
  candidateId: string
  candidateRoleMatchId: string
  gate: GateResultSummary
  canReview: boolean
  onDone: (message: string | null, success: boolean) => void
}) {
  const [pending, startTransition] = useTransition()

  function requestVerification() {
    const formData = new FormData()
    formData.set('organizationId', organizationId)
    formData.set('candidateId', candidateId)
    formData.set('gateResultId', gate.id)
    startTransition(async () => {
      const outcome = await requestGateVerificationAction(formData)
      onDone(outcome.message ?? null, outcome.success)
    })
  }

  return (
    <div className="border-outline-cell flex flex-col gap-2 border-b px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-tertiary text-sm font-medium">{gate.requirementName}</p>
        <StatusBadge status={GATE_STATE_BADGE[gate.state]}>
          {gate.state.replace('_', ' ')}
        </StatusBadge>
      </div>

      {gate.state === 'unknown' && (
        <p className="text-muted text-xs italic">
          Missing information — no evidence was found for this mandatory requirement. Unknown is
          never treated as a pass.
        </p>
      )}

      {gate.aiSuggestionNote && <p className="text-muted text-xs">{gate.aiSuggestionNote}</p>}

      {gate.riskNotes.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {gate.riskNotes.map((note, i) => (
            <li key={i} className="text-warning text-xs">
              ⚠ {note}
            </li>
          ))}
        </ul>
      )}

      {gate.state === 'human_override' && (
        <p className="text-muted text-xs">
          Overridden to <strong>{gate.overrideResult}</strong>: {gate.overrideReason} (evidence:{' '}
          {gate.overrideEvidenceNote})
        </p>
      )}

      {canReview && gate.state !== 'human_override' && (
        <div className="flex flex-wrap gap-2">
          {gate.state === 'unknown' && (
            <Button variant="ghost" size="sm" onClick={requestVerification} loading={pending}>
              Request verification
            </Button>
          )}
          <GateOverrideDialog
            organizationId={organizationId}
            candidateId={candidateId}
            candidateRoleMatchId={candidateRoleMatchId}
            gate={gate}
            onDone={onDone}
          />
        </div>
      )}
    </div>
  )
}

function EvaluationForJob({
  organizationId,
  candidateId,
  job,
  match,
  gates,
  evidence,
  scoring,
  runs,
  reviews,
  canEvaluate,
  canReview,
}: {
  organizationId: string
  candidateId: string
  job: JobOption
  match: MatchSummary | undefined
  gates: GateResultSummary[]
  evidence: EvidenceSummary[]
  scoring: ScoringBreakdownSummary[]
  runs: MatchingRunSummary[]
  reviews: HumanReviewSummary[]
  canEvaluate: boolean
  canReview: boolean
}) {
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [runPending, startRunTransition] = useTransition()
  const [reviewPending, startReviewTransition] = useTransition()
  const [rejectReason, setRejectReason] = useState('')
  const [showRejectForm, setShowRejectForm] = useState(false)

  const latestRunGates = match
    ? gates.filter((g) => g.matchingRunId === match.latestMatchingRunId)
    : []
  const latestRunEvidence = match
    ? evidence.filter((e) => e.matchingRunId === match.latestMatchingRunId)
    : []
  const latestRunScoring = match
    ? scoring.filter((s) => s.matchingRunId === match.latestMatchingRunId)
    : []
  const sortedRuns = [...runs].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  const sortedReviews = [...reviews].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))

  const unknownGates = latestRunGates.filter(
    (g) => g.state === 'unknown' || g.state === 'requires_verification',
  )
  const allRiskNotes = [
    ...latestRunGates.flatMap((g) =>
      g.riskNotes.map((note) => ({ requirement: g.requirementName, note })),
    ),
    ...latestRunScoring.flatMap((s) =>
      s.riskNotes.map((note) => ({ requirement: s.requirementName, note })),
    ),
  ]

  function onDecisionDone(text: string | null, success: boolean) {
    setMessage({ tone: success ? 'success' : 'danger', text: text ?? '' })
  }

  function runEvaluation(triggerReason: 'initial_evaluation' | 'manual_reevaluation') {
    setMessage(null)
    const formData = new FormData()
    formData.set('organizationId', organizationId)
    formData.set('candidateId', candidateId)
    formData.set('jobId', job.id)
    formData.set('triggerReason', triggerReason)
    startRunTransition(async () => {
      const outcome = await runMatchingEvaluationAction(formData)
      setMessage({ tone: outcome.success ? 'success' : 'danger', text: outcome.message ?? '' })
    })
  }

  function recordDecision(
    decision: 'approved_for_outreach' | 'rejected' | 'requires_verification',
    reason?: string,
  ) {
    if (!match) return
    setMessage(null)
    const formData = new FormData()
    formData.set('organizationId', organizationId)
    formData.set('candidateId', candidateId)
    formData.set('candidateRoleMatchId', match.id)
    formData.set('decision', decision)
    if (reason) formData.set('reason', reason)
    startReviewTransition(async () => {
      const outcome = await recordReviewDecisionAction(formData)
      setMessage({ tone: outcome.success ? 'success' : 'danger', text: outcome.message ?? '' })
      if (outcome.success) {
        setShowRejectForm(false)
        setRejectReason('')
      }
    })
  }

  if (!match) {
    return (
      <div className="flex flex-col gap-4">
        {message && (
          <Alert tone={message.tone === 'success' ? 'success' : 'danger'} title={message.text} />
        )}
        <EmptyState
          title="Not evaluated yet"
          description={`No matching evaluation has run for ${job.title} yet.`}
          action={
            canEvaluate && (
              <Button onClick={() => runEvaluation('initial_evaluation')} loading={runPending}>
                Run evaluation
              </Button>
            )
          }
        />
      </div>
    )
  }

  const isInFlight = ['queued', 'evaluating_gates', 'assessing_semantic', 'scoring'].includes(
    sortedRuns[0]?.status ?? '',
  )

  return (
    <div className="flex flex-col gap-4">
      {message && (
        <Alert tone={message.tone === 'success' ? 'success' : 'danger'} title={message.text} />
      )}

      <Card>
        <CardBody className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={ELIGIBILITY_BADGE[match.eligibility]}>
                {match.eligibility.replace('_', ' ')}
              </StatusBadge>
              <StatusBadge status={REVIEW_STATUS_BADGE[match.reviewStatus]}>
                {match.reviewStatus.replace(/_/g, ' ')}
              </StatusBadge>
            </div>
            {canEvaluate && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => runEvaluation('manual_reevaluation')}
                loading={runPending}
                disabled={isInFlight}
              >
                Re-evaluate
              </Button>
            )}
          </div>

          {isInFlight && <ProgressIndicator value={60} label="Evaluation in progress" />}

          {/* Score breakdown: every figure shown separately, never combined (brief §SCORING OUTPUT). */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-muted text-xs">Overall score</p>
              <p className="font-display text-tertiary text-2xl font-bold">
                {match.eligibility === 'eligible' ? pct(match.overallScore) : '—'}
              </p>
              {match.eligibility !== 'eligible' && (
                <p className="text-muted text-xs">Suppressed — a mandatory gate has not passed</p>
              )}
            </div>
            <div>
              <p className="text-muted text-xs">Evidence coverage</p>
              <p className="text-tertiary text-lg font-semibold">
                {pct(match.evidenceCoveragePct)}
              </p>
            </div>
            <div>
              <p className="text-muted text-xs">Data completeness</p>
              <p className="text-tertiary text-lg font-semibold">
                {pct(match.dataCompletenessPct)}
              </p>
            </div>
            <div>
              <p className="text-muted text-xs">Confidence</p>
              <p className="text-tertiary text-lg font-semibold">
                {match.confidence === null ? '—' : `${Math.round(match.confidence * 100)}%`}
              </p>
            </div>
          </div>

          {unknownGates.length > 0 && (
            <Alert tone="warning" title="Missing information">
              {unknownGates.length} mandatory requirement(s) have no evidence yet:{' '}
              {unknownGates.map((g) => g.requirementName).join(', ')}.
            </Alert>
          )}

          {allRiskNotes.length > 0 && (
            <Alert tone="warning" title="Risks">
              <ul className="flex flex-col gap-0.5">
                {allRiskNotes.map((r, i) => (
                  <li key={i}>
                    <strong>{r.requirement}:</strong> {r.note}
                  </li>
                ))}
              </ul>
            </Alert>
          )}

          {canReview && (
            <div className="border-outline-cell flex flex-wrap items-center gap-2 border-t pt-3">
              <Button
                variant="verify"
                size="sm"
                onClick={() => recordDecision('approved_for_outreach')}
                loading={reviewPending}
                disabled={match.eligibility === 'ineligible'}
              >
                Approve for outreach
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  recordDecision(
                    'requires_verification',
                    'Additional verification requested by reviewer.',
                  )
                }
                loading={reviewPending}
              >
                Request verification
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowRejectForm((v) => !v)}
                disabled={reviewPending}
              >
                Reject with reason
              </Button>
            </div>
          )}

          {showRejectForm && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex-1">
                <FormField label="Rejection reason" htmlFor="reject-reason" required>
                  <Textarea
                    id="reject-reason"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    rows={2}
                  />
                </FormField>
              </div>
              <Button
                variant="destructive"
                onClick={() => recordDecision('rejected', rejectReason)}
                loading={reviewPending}
                disabled={rejectReason.trim().length === 0}
              >
                Confirm rejection
              </Button>
            </div>
          )}
        </CardBody>
      </Card>

      <Tabs defaultValue="gates">
        <TabsList>
          <TabsTrigger value="gates">Mandatory gates</TabsTrigger>
          <TabsTrigger value="evidence">Evidence</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="gates" className="pt-3">
          <Card>
            <div className="divide-outline-cell divide-y">
              {latestRunGates.length > 0 ? (
                latestRunGates.map((gate) => (
                  <GateRow
                    key={gate.id}
                    organizationId={organizationId}
                    candidateId={candidateId}
                    candidateRoleMatchId={match.id}
                    gate={gate}
                    canReview={canReview}
                    onDone={onDecisionDone}
                  />
                ))
              ) : (
                <p className="text-muted px-4 py-6 text-center text-sm">
                  No mandatory gates recorded for this evaluation.
                </p>
              )}
            </div>
          </Card>

          {latestRunScoring.length > 0 && (
            <Card className="mt-3">
              <CardBody>
                <p className="text-tertiary mb-2 text-sm font-medium">
                  Preferred-requirement score breakdown
                </p>
                <div className="divide-outline-cell divide-y">
                  {latestRunScoring.map((row) => (
                    <div key={row.id} className="flex items-center justify-between py-2 text-sm">
                      <span className="text-tertiary">{row.requirementName}</span>
                      <span className="text-muted text-xs">
                        {row.hasEvidence
                          ? `${row.effectiveScore ?? 0} × ${row.weight} weight`
                          : 'no evidence — contributes 0'}
                      </span>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="evidence" className="pt-3">
          <Card>
            <div className="divide-outline-cell divide-y">
              {latestRunEvidence.length > 0 ? (
                latestRunEvidence.map((item) => (
                  <div key={item.id} className="flex flex-col gap-1 px-4 py-3">
                    <p className="text-tertiary text-sm italic">&ldquo;{item.excerpt}&rdquo;</p>
                    <div className="text-muted flex flex-wrap items-center gap-2 text-xs">
                      <span className="capitalize">{item.sourceKind.replace('_', ' ')}</span>
                      {item.location && <span>{item.location}</span>}
                      {item.relevanceScore !== null && (
                        <span>relevance {Math.round(item.relevanceScore * 100)}%</span>
                      )}
                      {item.confidence !== null && (
                        <span>confidence {Math.round(item.confidence * 100)}%</span>
                      )}
                      {!item.isDirectStatement && (
                        <StatusBadge status="pending">inferred</StatusBadge>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-muted px-4 py-6 text-center text-sm">
                  No evidence has been retrieved for this evaluation.
                </p>
              )}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="flex flex-col gap-3 pt-3">
          <Card>
            <CardBody>
              <p className="text-tertiary mb-2 text-sm font-medium">Evaluation runs</p>
              <div className="divide-outline-cell divide-y">
                {sortedRuns.map((run) => (
                  <div key={run.id} className="flex flex-col gap-0.5 py-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-tertiary">{run.triggerReason.replace(/_/g, ' ')}</span>
                      <StatusBadge status={RUN_STATUS_BADGE[run.status] ?? 'neutral'}>
                        {run.status.replace(/_/g, ' ')}
                      </StatusBadge>
                    </div>
                    <span className="text-muted text-xs">
                      {new Date(run.createdAt).toLocaleString()}
                      {run.errorMessage ? ` — ${run.errorMessage}` : ''}
                      {run.triggerNote ? ` — ${run.triggerNote}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>

          {sortedReviews.length > 0 && (
            <Card>
              <CardBody>
                <p className="text-tertiary mb-2 text-sm font-medium">Review decisions</p>
                <div className="divide-outline-cell divide-y">
                  {sortedReviews.map((review) => (
                    <div key={review.id} className="flex flex-col gap-0.5 py-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-tertiary capitalize">
                          {review.decision.replace(/_/g, ' ')}
                        </span>
                        <span className="text-muted text-xs">
                          {new Date(review.createdAt).toLocaleString()}
                        </span>
                      </div>
                      {review.reason && <span className="text-muted text-xs">{review.reason}</span>}
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

export function CandidateEvaluationPanel({
  organizationId,
  candidateId,
  jobs,
  matches,
  gates,
  evidence,
  scoring,
  runs,
  reviews,
  canEvaluate,
  canReview,
}: {
  organizationId: string
  candidateId: string
  jobs: JobOption[]
  matches: MatchSummary[]
  gates: GateResultSummary[]
  evidence: EvidenceSummary[]
  scoring: ScoringBreakdownSummary[]
  runs: MatchingRunSummary[]
  reviews: HumanReviewSummary[]
  canEvaluate: boolean
  canReview: boolean
}) {
  const [selectedJobId, setSelectedJobId] = useState(jobs[0]?.id ?? '')

  const selectedJob = useMemo(() => jobs.find((j) => j.id === selectedJobId), [jobs, selectedJobId])

  if (jobs.length === 0) {
    return (
      <EmptyState
        title="Not assigned to a role yet"
        description="Assign this candidate to a project role in the Pipeline tab before running a matching evaluation."
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <SampleAssessmentNotice />
      {jobs.length > 1 && (
        <FormField label="Role" htmlFor="evaluation-job">
          <Select
            options={jobs.map((j) => ({ value: j.id, label: j.title }))}
            value={selectedJobId}
            onValueChange={setSelectedJobId}
          />
        </FormField>
      )}

      {selectedJob && (
        <EvaluationForJob
          organizationId={organizationId}
          candidateId={candidateId}
          job={selectedJob}
          match={matches.find((m) => m.jobId === selectedJob.id)}
          gates={gates.filter(
            (g) => matches.find((m) => m.id === g.candidateRoleMatchId)?.jobId === selectedJob.id,
          )}
          evidence={evidence.filter(
            (e) => matches.find((m) => m.id === e.candidateRoleMatchId)?.jobId === selectedJob.id,
          )}
          scoring={scoring.filter(
            (s) => matches.find((m) => m.id === s.candidateRoleMatchId)?.jobId === selectedJob.id,
          )}
          runs={runs.filter((r) => r.jobId === selectedJob.id)}
          reviews={reviews.filter(
            (r) => matches.find((m) => m.id === r.candidateRoleMatchId)?.jobId === selectedJob.id,
          )}
          canEvaluate={canEvaluate}
          canReview={canReview}
        />
      )}
    </div>
  )
}
