'use client'

import { useState, useTransition } from 'react'
import { Alert, Button, Card, CardBody, EmptyState, SectionHeader, StatusBadge } from '@rqi/ui'
import {
  addCandidateToShortlistAction,
  removeCandidateFromShortlistAction,
} from '@/lib/shortlists/shortlist-actions'
import type {
  EligibleCandidateForShortlist,
  ShortlistCandidateRow,
} from '@/lib/shortlists/load-detail'

/**
 * Shortlist builder + preview (Build Phase 8 brief §"Shortlist"/§UI
 * "Shortlist builder", "Shortlist preview"). Only rendered for a draft
 * version — once submitted for internal approval, the version is frozen
 * (brief: "store shortlist version") and this panel is replaced by the
 * read-only comparison view.
 */
export function ShortlistBuilderPanel({
  organizationId,
  shortlistId,
  shortlistVersionId,
  maxCandidates,
  current,
  eligible,
}: {
  organizationId: string
  shortlistId: string
  shortlistVersionId: string
  maxCandidates: number
  current: ShortlistCandidateRow[]
  eligible: EligibleCandidateForShortlist[]
}) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)

  function add(candidate: EligibleCandidateForShortlist) {
    const fd = new FormData()
    fd.set('organizationId', organizationId)
    fd.set('shortlistId', shortlistId)
    fd.set('shortlistVersionId', shortlistVersionId)
    fd.set('candidateRoleMatchId', candidate.candidateRoleMatchId)
    fd.set('candidateId', candidate.candidateId)
    fd.set('matchingRunId', candidate.matchingRunId)
    fd.set('scorecardVersionId', candidate.scorecardVersionId)
    startTransition(async () => {
      const outcome = await addCandidateToShortlistAction(fd)
      setMessage(
        outcome.message
          ? { tone: outcome.success ? 'success' : 'danger', text: outcome.message }
          : null,
      )
    })
  }

  function remove(row: ShortlistCandidateRow) {
    const fd = new FormData()
    fd.set('organizationId', organizationId)
    fd.set('shortlistId', shortlistId)
    fd.set('shortlistCandidateId', row.shortlistCandidateId)
    startTransition(async () => {
      const outcome = await removeCandidateFromShortlistAction(fd)
      setMessage(
        outcome.message
          ? { tone: outcome.success ? 'success' : 'danger', text: outcome.message }
          : null,
      )
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {message && <Alert tone={message.tone} title={message.text} />}

      <Card>
        <CardBody className="flex flex-col gap-3">
          <SectionHeader
            title={`On this shortlist (${current.length} / ${maxCandidates})`}
            badge={
              current.length > maxCandidates ? (
                <StatusBadge status="pending">Override in effect</StatusBadge>
              ) : undefined
            }
          />
          {current.length === 0 ? (
            <EmptyState
              title="No candidates yet"
              description="Add an eligible candidate from the list below."
            />
          ) : (
            <div className="flex flex-col gap-2">
              {current.map((row) => (
                <div
                  key={row.shortlistCandidateId}
                  className="border-outline-cell flex items-center justify-between gap-3 border-b py-2 last:border-0"
                >
                  <div>
                    <p className="text-tertiary text-sm font-medium">
                      #{row.rank} {row.candidateName}
                    </p>
                    <p className="text-muted text-xs">
                      {row.overallScore !== null ? `${row.overallScore}% match` : 'Score pending'} ·{' '}
                      {row.gatesPassed}/{row.gatesTotal} gates passed
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={pending}
                    onClick={() => remove(row)}
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="flex flex-col gap-3">
          <SectionHeader title="Eligible candidates" />
          {eligible.length === 0 ? (
            <EmptyState
              title="No eligible candidates"
              description="No candidate for this role has passed every mandatory gate yet."
            />
          ) : (
            <div className="flex flex-col gap-2">
              {eligible.map((candidate) => (
                <div
                  key={candidate.candidateRoleMatchId}
                  className="border-outline-cell flex items-center justify-between gap-3 border-b py-2 last:border-0"
                >
                  <div>
                    <p className="text-tertiary text-sm font-medium">{candidate.candidateName}</p>
                    <p className="text-muted text-xs">
                      {candidate.overallScore !== null
                        ? `${candidate.overallScore}% match`
                        : 'Score pending'}
                    </p>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={pending}
                    onClick={() => add(candidate)}
                  >
                    Add
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
