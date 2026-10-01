'use client'

import { useState, useTransition } from 'react'
import { Button, Card, CardBody, FormField, StatusBadge, Textarea } from '@rqi/ui'
import type { CandidateConsent, CandidateStatus } from '@rqi/types'
import { archiveCandidateAction, requestCandidateDeletionAction } from '@/lib/candidates/actions'

/**
 * Archive / deletion-request / consent status — Build Phase 5 brief
 * §PRIVACY: "Support archive and deletion-request status." Both actions are
 * soft: archiving keeps the row and all history, and a deletion request
 * only records the request (candidate_consents.deletion_requested) — actual
 * erasure is a separate, later, explicitly audited step pending a
 * data-retention policy (see lib/candidates/actions.ts header comment).
 */
export function CandidatePrivacyPanel({
  organizationId,
  candidateId,
  status,
  consent,
  canManage,
}: {
  organizationId: string
  candidateId: string
  status: CandidateStatus
  consent: CandidateConsent | null
  canManage: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [showDeletionForm, setShowDeletionForm] = useState(false)
  const [reason, setReason] = useState('')

  function handleArchive() {
    if (
      !window.confirm(
        'Archive this candidate? The record and its history are kept, just hidden from active views.',
      )
    ) {
      return
    }
    setMessage(null)
    const formData = new FormData()
    formData.set('organizationId', organizationId)
    formData.set('candidateId', candidateId)
    startTransition(async () => {
      const result = await archiveCandidateAction(formData)
      setMessage({
        tone: result.success ? 'success' : 'danger',
        text: result.message ?? 'Something went wrong.',
      })
    })
  }

  function handleDeletionRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage(null)
    const formData = new FormData()
    formData.set('organizationId', organizationId)
    formData.set('candidateId', candidateId)
    if (reason) formData.set('reason', reason)
    startTransition(async () => {
      const result = await requestCandidateDeletionAction(formData)
      setMessage({
        tone: result.success ? 'success' : 'danger',
        text: result.message ?? 'Something went wrong.',
      })
      if (result.success) setShowDeletionForm(false)
    })
  }

  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-tertiary text-sm font-medium">Status</p>
          <StatusBadge
            status={
              status === 'active'
                ? 'passed'
                : status === 'deletion_requested'
                  ? 'failed'
                  : 'neutral'
            }
          >
            {status.replace('_', ' ')}
          </StatusBadge>
        </div>

        {consent?.deletionRequested && (
          <p className="text-muted text-xs">
            Deletion requested
            {consent.deletionRequestedAt
              ? ` on ${new Date(consent.deletionRequestedAt).toLocaleDateString()}`
              : ''}
            {consent.deletionReason ? ` — "${consent.deletionReason}"` : ''}. Actual erasure
            requires a separate administrative step once a data-retention policy is in place.
          </p>
        )}

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

        {canManage && status !== 'merged' && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              {status !== 'archived' && (
                <Button type="button" variant="secondary" loading={pending} onClick={handleArchive}>
                  Archive
                </Button>
              )}
              {status !== 'deletion_requested' && !showDeletionForm && (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => setShowDeletionForm(true)}
                >
                  Request deletion
                </Button>
              )}
            </div>
            {showDeletionForm && (
              <form
                onSubmit={handleDeletionRequest}
                className="border-outline-cell flex flex-col gap-2 rounded-lg border p-3"
              >
                <FormField label="Reason (optional)" htmlFor="deletion-reason">
                  <Textarea
                    id="deletion-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                  />
                </FormField>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setShowDeletionForm(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" variant="destructive" loading={pending}>
                    Confirm deletion request
                  </Button>
                </div>
              </form>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  )
}
