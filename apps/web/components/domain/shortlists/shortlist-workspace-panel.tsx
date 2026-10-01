'use client'

import { useState, useTransition } from 'react'
import {
  Alert,
  Button,
  Card,
  CardBody,
  FormField,
  SectionHeader,
  StatusBadge,
  Textarea,
} from '@rqi/ui'
import type { ClientDecisionKind, ShortlistRecordStatus } from '@rqi/types'
import {
  internallyApproveShortlistAction,
  recordClientDecisionAction,
  sendShortlistToClientAction,
  submitShortlistForInternalApprovalAction,
} from '@/lib/shortlists/shortlist-actions'
import { SampleAssessmentNotice } from '@/components/domain/sample-assessment-notice'

/**
 * Shortlist workflow controls (Build Phase 8 brief §"Shortlist"/§"Client
 * decisions"/§UI "Internal approval", "Client-review view"). Brief workflow:
 * Proposed Shortlist -> Internal Approval -> Client Review -> Accepted,
 * Discuss or Rejected — each stage here is its own explicit, human-
 * initiated button; nothing here auto-advances (Core Principle #3/#8: "No
 * candidate may be submitted to an end client without human approval").
 */
export function ShortlistWorkspacePanel({
  organizationId,
  shortlistId,
  shortlistVersionId,
  clientId,
  status,
  candidateCount,
  canManageInternally,
  canDecideAsClient,
}: {
  organizationId: string
  shortlistId: string
  shortlistVersionId: string
  clientId: string
  status: ShortlistRecordStatus
  candidateCount: number
  canManageInternally: boolean
  canDecideAsClient: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)

  function run(action: () => Promise<{ success: boolean; message?: string }>) {
    startTransition(async () => {
      const outcome = await action()
      setMessage(
        outcome.message
          ? { tone: outcome.success ? 'success' : 'danger', text: outcome.message }
          : null,
      )
    })
  }

  return (
    <Card>
      <CardBody className="flex flex-col gap-4">
        <SampleAssessmentNotice />
        <div className="flex items-center justify-between gap-4">
          <SectionHeader title="Shortlist status" />
          <StatusBadge status={statusBadge(status)}>{status.replace(/_/g, ' ')}</StatusBadge>
        </div>

        {message && <Alert tone={message.tone} title={message.text} />}

        {canManageInternally && status === 'draft' && (
          <Button
            variant="primary"
            disabled={pending || candidateCount === 0}
            onClick={() =>
              run(() => {
                const fd = new FormData()
                fd.set('organizationId', organizationId)
                fd.set('shortlistId', shortlistId)
                fd.set('shortlistVersionId', shortlistVersionId)
                return submitShortlistForInternalApprovalAction(fd)
              })
            }
          >
            Submit for internal approval
          </Button>
        )}

        {canManageInternally && status === 'pending_internal_approval' && (
          <Button
            variant="primary"
            disabled={pending}
            onClick={() =>
              run(() => {
                const fd = new FormData()
                fd.set('organizationId', organizationId)
                fd.set('shortlistId', shortlistId)
                fd.set('shortlistVersionId', shortlistVersionId)
                return internallyApproveShortlistAction(fd)
              })
            }
          >
            Record internal approval
          </Button>
        )}

        {canManageInternally && status === 'internally_approved' && (
          <Button
            variant="primary"
            disabled={pending}
            onClick={() =>
              run(() => {
                const fd = new FormData()
                fd.set('organizationId', organizationId)
                fd.set('shortlistId', shortlistId)
                fd.set('shortlistVersionId', shortlistVersionId)
                return sendShortlistToClientAction(fd)
              })
            }
          >
            Send to client
          </Button>
        )}

        {canManageInternally && status === 'sent_to_client' && (
          <p className="text-muted text-xs">Awaiting the client&rsquo;s decision.</p>
        )}

        {canDecideAsClient && status === 'sent_to_client' && (
          <ClientDecisionForm
            organizationId={organizationId}
            shortlistId={shortlistId}
            shortlistVersionId={shortlistVersionId}
            clientId={clientId}
            pending={pending}
            run={run}
          />
        )}

        {(status === 'accepted' || status === 'discuss' || status === 'rejected') && (
          <p className="text-muted text-xs">
            The client has responded: <span className="font-semibold">{status}</span>.
            {canManageInternally &&
              (status === 'discuss' || status === 'rejected') &&
              ' Rebuild a new version from the shortlist builder to continue.'}
          </p>
        )}
      </CardBody>
    </Card>
  )
}

function statusBadge(status: ShortlistRecordStatus): 'passed' | 'pending' | 'failed' | 'neutral' {
  if (status === 'accepted') return 'passed'
  if (status === 'rejected') return 'failed'
  if (status === 'draft') return 'neutral'
  return 'pending'
}

function ClientDecisionForm({
  organizationId,
  shortlistId,
  shortlistVersionId,
  clientId,
  pending,
  run,
}: {
  organizationId: string
  shortlistId: string
  shortlistVersionId: string
  clientId: string
  pending: boolean
  run: (action: () => Promise<{ success: boolean; message?: string }>) => void
}) {
  const [decision, setDecision] = useState<ClientDecisionKind>('accept')
  const [notes, setNotes] = useState('')

  return (
    <div className="border-outline-cell flex flex-col gap-3 border-t pt-4">
      <SectionHeader title="Your decision" />
      <div className="flex gap-2">
        {(['accept', 'discuss', 'reject'] as ClientDecisionKind[]).map((option) => (
          <Button
            key={option}
            variant={decision === option ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setDecision(option)}
          >
            {option === 'accept' ? 'Accept' : option === 'discuss' ? 'Discuss' : 'Reject'}
          </Button>
        ))}
      </div>
      {decision !== 'accept' && (
        <FormField label="Notes" htmlFor="client-decision-notes" required>
          <Textarea
            id="client-decision-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
          />
        </FormField>
      )}
      <Button
        variant="primary"
        disabled={pending || (decision !== 'accept' && notes.trim().length === 0)}
        onClick={() =>
          run(() => {
            const fd = new FormData()
            fd.set('organizationId', organizationId)
            fd.set('shortlistId', shortlistId)
            fd.set('shortlistVersionId', shortlistVersionId)
            fd.set('clientId', clientId)
            fd.set('decision', decision)
            if (notes) fd.set('notes', notes)
            return recordClientDecisionAction(fd)
          })
        }
      >
        Submit decision
      </Button>
    </div>
  )
}
