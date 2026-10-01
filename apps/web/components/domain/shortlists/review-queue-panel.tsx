'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import {
  Alert,
  Button,
  Card,
  CardBody,
  Dialog,
  DialogContent,
  EmptyState,
  FormField,
  Select,
  StatusBadge,
  Textarea,
} from '@rqi/ui'
import type { CandidateEligibility, MatchHumanReviewDecision, MatchReviewStatus } from '@rqi/types'
import { recordReviewDecisionAction } from '@/lib/matching/matching-actions'
import { openVerificationRequestAction } from '@/lib/shortlists/verification-actions'
import { SampleAssessmentNotice } from '@/components/domain/sample-assessment-notice'

/**
 * Quality-review queue (Build Phase 8 brief §"Quality-review queue" /
 * §UI "Reviewer decision dialog" / "Verification-request workflow").
 * Consolidates the queue, its decision dialog, and the verification-request
 * flow into one screen rather than sending a reviewer to the candidate
 * detail page for each — a deliberate scope decision documented in
 * docs/build-phase-8-report.md. The candidate detail page's Evaluation tab
 * (Build Phase 7) remains the place for a per-gate override, which needs
 * the full gate-by-gate breakdown this compact queue view does not show;
 * this panel's "Open full evaluation" link goes there.
 *
 * Never ranks (never interleaves) a failed-gate candidate among eligible
 * ones — entries arrive already sorted by apps/web/lib/shortlists/
 * queue.ts's sortQualityReviewQueue, called server-side before this
 * component ever renders.
 */
export interface ReviewQueueEntry {
  candidateRoleMatchId: string
  candidateId: string
  candidateName: string
  jobId: string
  jobTitle: string
  eligibility: CandidateEligibility
  overallScore: number | null
  evidenceCoveragePct: number
  dataCompletenessPct: number
  reviewStatus: MatchReviewStatus
  missingEvidenceCount: number
  unverifiedFieldCount: number
  createdAt: string
}

export function ReviewQueuePanel({
  organizationId,
  entries,
}: {
  organizationId: string
  entries: ReviewQueueEntry[]
}) {
  if (entries.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <SampleAssessmentNotice />
        <EmptyState
          title="No candidates awaiting review"
          description="Every evaluated candidate has a recorded reviewer decision."
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <SampleAssessmentNotice />
      {entries.map((entry) => (
        <ReviewQueueRow
          key={entry.candidateRoleMatchId}
          organizationId={organizationId}
          entry={entry}
        />
      ))}
    </div>
  )
}

const ELIGIBILITY_STATUS: Record<CandidateEligibility, 'passed' | 'failed' | 'pending'> = {
  eligible: 'passed',
  ineligible: 'failed',
  pending_verification: 'pending',
}

const REVIEW_STATUS_LABEL: Record<MatchReviewStatus, string> = {
  pending: 'Awaiting review',
  approved_for_outreach: 'Approved for outreach',
  rejected: 'Rejected',
  requires_verification: 'Verification requested',
  escalated: 'Escalated',
}

function ReviewQueueRow({
  organizationId,
  entry,
}: {
  organizationId: string
  entry: ReviewQueueEntry
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-tertiary text-sm font-semibold">{entry.candidateName}</p>
            <p className="text-muted text-xs">{entry.jobTitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={ELIGIBILITY_STATUS[entry.eligibility]}>
              {entry.eligibility === 'eligible'
                ? 'Eligible'
                : entry.eligibility === 'ineligible'
                  ? 'Ineligible'
                  : 'Pending verification'}
            </StatusBadge>
            <StatusBadge status="neutral">{REVIEW_STATUS_LABEL[entry.reviewStatus]}</StatusBadge>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <Metric
            label="Match score"
            value={entry.overallScore !== null ? `${entry.overallScore}%` : '—'}
          />
          <Metric label="Evidence coverage" value={`${entry.evidenceCoveragePct}%`} />
          <Metric label="Data completeness" value={`${entry.dataCompletenessPct}%`} />
          <Metric
            label="Missing evidence"
            value={
              entry.missingEvidenceCount > 0 ? `${entry.missingEvidenceCount} item(s)` : 'None'
            }
            warn={entry.missingEvidenceCount > 0}
          />
        </div>

        {entry.unverifiedFieldCount > 0 && (
          <p className="text-warning text-xs">
            {entry.unverifiedFieldCount} field(s) unverified — never treated as a pass.
          </p>
        )}

        {message && (
          <Alert tone={message.tone === 'success' ? 'success' : 'danger'} title={message.text} />
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="sm" onClick={() => setDialogOpen(true)}>
            Review decision
          </Button>
          <Link
            href={`/candidates/${entry.candidateId}`}
            className="text-secondary text-xs font-medium underline"
          >
            Open full evaluation
          </Link>
        </div>
      </CardBody>

      {dialogOpen && (
        <ReviewDecisionDialog
          organizationId={organizationId}
          entry={entry}
          onOpenChange={setDialogOpen}
          onDone={(text, success) =>
            setMessage(text ? { tone: success ? 'success' : 'error', text } : null)
          }
        />
      )}
    </Card>
  )
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <p className="text-muted text-[10px] font-semibold uppercase tracking-wide">{label}</p>
      <p className={`text-sm font-semibold ${warn ? 'text-warning' : 'text-tertiary'}`}>{value}</p>
    </div>
  )
}

type QueueDecision = MatchHumanReviewDecision | 'request_verification'

function ReviewDecisionDialog({
  organizationId,
  entry,
  onOpenChange,
  onDone,
}: {
  organizationId: string
  entry: ReviewQueueEntry
  onOpenChange: (open: boolean) => void
  onDone: (message: string | null, success: boolean) => void
}) {
  const [decision, setDecision] = useState<QueueDecision>('approved_for_outreach')
  const [reason, setReason] = useState('')
  const [pending, startTransition] = useTransition()

  const reasonRequired = decision !== 'approved_for_outreach'
  const reasonLabel =
    decision === 'note_added'
      ? 'Internal note'
      : decision === 'request_verification'
        ? 'What needs verifying'
        : 'Reason'

  function submit() {
    if (reasonRequired && reason.trim().length === 0) {
      onDone(
        decision === 'note_added'
          ? 'The note cannot be empty.'
          : 'A reason is required for this decision.',
        false,
      )
      return
    }

    const formData = new FormData()
    formData.set('organizationId', organizationId)
    formData.set('candidateId', entry.candidateId)
    formData.set('candidateRoleMatchId', entry.candidateRoleMatchId)

    startTransition(async () => {
      const outcome =
        decision === 'request_verification'
          ? await openVerificationRequestAction(
              (() => {
                const vfd = new FormData()
                vfd.set('organizationId', organizationId)
                vfd.set('candidateId', entry.candidateId)
                vfd.set('candidateRoleMatchId', entry.candidateRoleMatchId)
                vfd.set('note', reason)
                return vfd
              })(),
            )
          : await recordReviewDecisionAction(
              (() => {
                formData.set('decision', decision)
                if (reason) formData.set('reason', reason)
                return formData
              })(),
            )
      onDone(outcome.message ?? null, outcome.success)
      if (outcome.success) onOpenChange(false)
    })
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        title={`Review decision: ${entry.candidateName}`}
        description="Every decision here is recorded to the candidate's review history and the audit log."
      >
        <div className="flex flex-col gap-3">
          <FormField label="Decision" htmlFor="queue-decision">
            <Select
              options={[
                { value: 'approved_for_outreach', label: 'Approve for outreach' },
                { value: 'requires_verification', label: 'Requires verification' },
                {
                  value: 'request_verification',
                  label: 'Request verification (open tracked request)',
                },
                { value: 'rejected', label: 'Reject' },
                { value: 'escalated', label: 'Escalate' },
                { value: 'note_added', label: 'Add internal note' },
              ]}
              value={decision}
              onValueChange={(value) => setDecision(value as QueueDecision)}
            />
          </FormField>
          <FormField
            label={reasonLabel}
            htmlFor="queue-reason"
            required={reasonRequired}
            hint={!reasonRequired ? 'Optional for an approval.' : undefined}
          >
            <Textarea
              id="queue-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
          </FormField>
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} disabled={pending}>
              {pending ? 'Saving…' : 'Save decision'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
