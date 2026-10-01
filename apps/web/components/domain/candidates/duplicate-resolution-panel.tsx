'use client'

import { useState, useTransition } from 'react'
import { Button, Card, CardBody, StatusBadge } from '@rqi/ui'
import type { DuplicateCandidateSuggestion } from '@rqi/types'
import { mergeCandidatesAction } from '@/lib/candidates/merge-actions'

const BASIS_LABELS: Record<DuplicateCandidateSuggestion['basis'], string> = {
  exact_email: 'Same email',
  exact_phone: 'Same phone number',
  document_checksum: 'Identical CV file',
  fuzzy: 'Similar name, company or location',
}

/**
 * Duplicate-resolution screen — Build Phase 5 brief §"Deduplication":
 * "configurable fuzzy name/company/location suggestion", "human decision
 * before merging", "no destructive automatic merge". Suggestions come from
 * the deterministic, unit-tested findDuplicateSuggestions
 * (lib/candidates/dedup.ts) — nothing here is AI-generated. Merging is
 * always a deliberate act: the recruiter picks which record survives.
 */
export function DuplicateResolutionPanel({
  organizationId,
  candidateId,
  candidateName,
  suggestions,
  canMerge,
}: {
  organizationId: string
  candidateId: string
  candidateName: string
  suggestions: (DuplicateCandidateSuggestion & { matchedCandidateName: string })[]
  canMerge: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [mergingId, setMergingId] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)

  function handleMerge(matchedCandidateId: string, keepThis: boolean) {
    const winnerCandidateId = keepThis ? candidateId : matchedCandidateId
    const loserCandidateId = keepThis ? matchedCandidateId : candidateId
    if (
      !window.confirm(
        `Merge these two candidate records? The losing record is kept (never deleted) as a resolvable alias, and this is recorded in the audit log. This can't be undone automatically.`,
      )
    ) {
      return
    }

    setMergingId(matchedCandidateId)
    setMessage(null)
    const formData = new FormData()
    formData.set('organizationId', organizationId)
    formData.set('winnerCandidateId', winnerCandidateId)
    formData.set('loserCandidateId', loserCandidateId)

    startTransition(async () => {
      const result = await mergeCandidatesAction(formData)
      setMessage({
        tone: result.success ? 'success' : 'danger',
        text: result.message ?? 'Something went wrong.',
      })
      setMergingId(null)
    })
  }

  if (suggestions.length === 0) {
    return <p className="text-muted text-sm">No possible duplicates found for {candidateName}.</p>
  }

  return (
    <div className="flex flex-col gap-3">
      {message && (
        <p
          role={message.tone === 'danger' ? 'alert' : 'status'}
          className={
            message.tone === 'danger'
              ? 'rounded-card bg-danger-bg text-danger px-3 py-2 text-sm font-medium'
              : 'rounded-card bg-primary-container text-primary px-3 py-2 text-sm font-medium'
          }
        >
          {message.text}
        </p>
      )}
      {suggestions.map((s) => (
        <Card key={s.matchedCandidateId}>
          <CardBody className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-tertiary text-sm font-medium">{s.matchedCandidateName}</p>
              <StatusBadge status={s.basis === 'fuzzy' ? 'pending' : 'failed'}>
                {BASIS_LABELS[s.basis]} · {Math.round(s.score * 100)}% match
              </StatusBadge>
            </div>
            {canMerge && (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  loading={pending && mergingId === s.matchedCandidateId}
                  onClick={() => handleMerge(s.matchedCandidateId, true)}
                >
                  Keep {candidateName}, merge the other in
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  loading={pending && mergingId === s.matchedCandidateId}
                  onClick={() => handleMerge(s.matchedCandidateId, false)}
                >
                  Keep {s.matchedCandidateName} instead
                </Button>
              </div>
            )}
          </CardBody>
        </Card>
      ))}
    </div>
  )
}
