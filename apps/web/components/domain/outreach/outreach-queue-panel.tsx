'use client'

import { useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button, Card, CardBody, EmptyState, StatusBadge } from '@rqi/ui'
import { Send } from 'lucide-react'
import type { OutreachMessageStatus, OutreachSequenceStatus } from '@rqi/types'
import type { OutreachReadyCandidate, OutreachSequenceSummary } from '@/lib/outreach/load'
import { startOutreachSequenceAction } from '@/lib/outreach/outreach-actions'

/**
 * Outreach workspace list (Build Phase 9 Wave 3 Task C). Mirrors
 * apps/web/components/domain/shortlists/review-queue-panel.tsx's list-of-
 * cards + per-row action pattern, and the "ready to start" section from
 * apps/web/app/(app)/shortlists/page.tsx.
 */

const MESSAGE_STATUS_BADGE: Record<
  OutreachMessageStatus,
  'passed' | 'pending' | 'failed' | 'neutral'
> = {
  drafted: 'neutral',
  awaiting_approval: 'pending',
  approved: 'pending',
  scheduled: 'pending',
  sent: 'passed',
  delivered: 'passed',
  responded: 'passed',
  failed: 'failed',
  cancelled: 'neutral',
}

const SEQUENCE_STATUS_BADGE: Record<
  OutreachSequenceStatus,
  'passed' | 'pending' | 'failed' | 'neutral'
> = {
  active: 'pending',
  completed: 'passed',
  cancelled: 'neutral',
}

export function OutreachQueuePanel({
  organizationId,
  readyCandidates,
  sequences,
  canStartSequence,
}: {
  organizationId: string
  readyCandidates: OutreachReadyCandidate[]
  sequences: OutreachSequenceSummary[]
  canStartSequence: boolean
}) {
  return (
    <div className="flex flex-col gap-6">
      {canStartSequence && readyCandidates.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="font-display text-tertiary text-[15px] font-semibold">
            Ready to start outreach
          </h2>
          {readyCandidates.map((candidate) => (
            <ReadyCandidateRow
              key={candidate.candidateRoleMatchId}
              organizationId={organizationId}
              candidate={candidate}
            />
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h2 className="font-display text-tertiary text-[15px] font-semibold">Active outreach</h2>
        {sequences.length === 0 ? (
          <EmptyState
            icon={Send}
            title="No outreach activity yet"
            description="Approve a candidate for outreach from the quality-review queue, then start their outreach sequence here."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {sequences.map((sequence) => (
              <Card key={sequence.sequenceId}>
                <Link href={`/outreach/${sequence.sequenceId}`}>
                  <CardBody className="hover:bg-canvas flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-tertiary text-sm font-semibold">
                        {sequence.candidateName}
                      </p>
                      <p className="text-muted text-xs">{sequence.jobTitle}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {sequence.hasUnclassifiedResponse && (
                        <StatusBadge status="pending">Response to review</StatusBadge>
                      )}
                      <StatusBadge status={SEQUENCE_STATUS_BADGE[sequence.sequenceStatus]}>
                        {sequence.sequenceStatus}
                      </StatusBadge>
                      {sequence.latestMessageStatus && (
                        <StatusBadge status={MESSAGE_STATUS_BADGE[sequence.latestMessageStatus]}>
                          {sequence.latestMessageChannel
                            ? `${sequence.latestMessageChannel} · `
                            : ''}
                          {sequence.latestMessageStatus.replace(/_/g, ' ')}
                        </StatusBadge>
                      )}
                      {!sequence.latestMessageStatus && (
                        <StatusBadge status="neutral">No draft yet</StatusBadge>
                      )}
                    </div>
                  </CardBody>
                </Link>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ReadyCandidateRow({
  organizationId,
  candidate,
}: {
  organizationId: string
  candidate: OutreachReadyCandidate
}) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  return (
    <Card>
      <CardBody className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-tertiary text-sm font-semibold">{candidate.candidateName}</p>
          <p className="text-muted text-xs">{candidate.jobTitle}</p>
        </div>
        <Button
          variant="primary"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const fd = new FormData()
              fd.set('organizationId', organizationId)
              fd.set('candidateRoleMatchId', candidate.candidateRoleMatchId)
              const outcome = await startOutreachSequenceAction(fd)
              if (outcome.success) router.refresh()
            })
          }
        >
          {pending ? 'Starting…' : 'Start outreach'}
        </Button>
      </CardBody>
    </Card>
  )
}
