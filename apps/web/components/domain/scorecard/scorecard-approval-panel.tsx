'use client'

import { useState, useTransition } from 'react'
import { Alert, Button, FormField, StatusBadge, Switch, Textarea } from '@rqi/ui'
import {
  decideScorecardApprovalAction,
  setClientApprovalPermissionAction,
  submitScorecardForApprovalAction,
} from '@/lib/scorecards/actions'

export interface ScorecardVersionSummary {
  id: string
  versionNo: number
  status: 'draft' | 'pending_approval' | 'active' | 'superseded'
  approvedBy: string | null
  approvedAt: string | null
  createdAt: string
}

const VERSION_STATUS_BADGE: Record<
  ScorecardVersionSummary['status'],
  'neutral' | 'pending' | 'passed' | 'failed'
> = {
  draft: 'neutral',
  pending_approval: 'pending',
  active: 'passed',
  superseded: 'neutral',
}

/**
 * Submission + approval controls (Build Phase 4 brief §UI: "Scorecard
 * validation", "Approval confirmation", "Version history", "Request-changes
 * workflow"; §CORE RULE: "sourcing cannot begin until an authorized human
 * approves a scorecard version"). Every decision here is a thin client
 * wrapper around lib/scorecards/actions.ts — this component makes no
 * approval decision itself, it only collects the human's input and shows
 * what the server decided.
 */
export function ScorecardApprovalPanel({
  organizationId,
  projectId,
  projectClientId,
  projectClientCanApproveScorecards,
  jobId,
  versions,
  pendingVersionId,
  canSubmit,
  canApprove,
  canManageClientPermission,
  weightsValid,
}: {
  organizationId: string
  projectId: string
  projectClientId: string
  projectClientCanApproveScorecards: boolean
  jobId: string
  versions: ScorecardVersionSummary[]
  pendingVersionId: string | null
  canSubmit: boolean
  canApprove: boolean
  canManageClientPermission: boolean
  weightsValid: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [reason, setReason] = useState('')
  const [clientApprovalEnabled, setClientApprovalEnabled] = useState(
    projectClientCanApproveScorecards,
  )

  function submit() {
    const formData = new FormData()
    formData.set('organizationId', organizationId)
    formData.set('projectId', projectId)
    formData.set('projectClientId', projectClientId)
    formData.set('jobId', jobId)
    setMessage(null)
    startTransition(async () => {
      const result = await submitScorecardForApprovalAction(formData)
      setMessage({ tone: result.success ? 'success' : 'danger', text: result.message ?? '' })
    })
  }

  function decide(decision: 'approved' | 'rejected' | 'changes_requested') {
    if (!pendingVersionId) return
    const formData = new FormData()
    formData.set('organizationId', organizationId)
    formData.set('projectId', projectId)
    formData.set('projectClientId', projectClientId)
    formData.set('projectClientCanApproveScorecards', String(projectClientCanApproveScorecards))
    formData.set('scorecardVersionId', pendingVersionId)
    formData.set('decision', decision)
    formData.set('reason', reason)
    setMessage(null)
    startTransition(async () => {
      const result = await decideScorecardApprovalAction(formData)
      setMessage({ tone: result.success ? 'success' : 'danger', text: result.message ?? '' })
      if (result.success) setReason('')
    })
  }

  function toggleClientApproval(enabled: boolean) {
    setClientApprovalEnabled(enabled)
    const formData = new FormData()
    formData.set('organizationId', organizationId)
    formData.set('projectId', projectId)
    formData.set('enabled', String(enabled))
    startTransition(async () => {
      const result = await setClientApprovalPermissionAction(formData)
      setMessage({ tone: result.success ? 'success' : 'danger', text: result.message ?? '' })
      if (!result.success) setClientApprovalEnabled(!enabled)
    })
  }

  return (
    <div className="flex flex-col gap-4">
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

      {canManageClientPermission && (
        <div className="border-outline-cell rounded-card flex items-center justify-between gap-4 border bg-white p-4">
          <div>
            <p className="text-tertiary text-sm font-semibold">Allow client approval</p>
            <p className="text-muted text-sm">
              When on, this project&apos;s client reviewer may also approve or reject the scorecard,
              not only your agency admins.
            </p>
          </div>
          <Switch
            checked={clientApprovalEnabled}
            onCheckedChange={toggleClientApproval}
            disabled={pending}
          />
        </div>
      )}

      {canSubmit && (
        <div className="flex items-center justify-between gap-4">
          <p className="text-muted text-sm">
            Submitting freezes the current requirements as a version for approval. Sourcing cannot
            begin until it is approved.
          </p>
          <Button type="button" onClick={submit} loading={pending} disabled={!weightsValid}>
            Submit for approval
          </Button>
        </div>
      )}

      {canApprove && pendingVersionId && (
        <div className="border-outline-cell rounded-card flex flex-col gap-3 border bg-white p-4">
          <p className="text-tertiary text-sm font-semibold">Approval decision</p>
          <FormField
            label="Reason (optional for approval, recommended for a rejection or changes request)"
            htmlFor="approval-reason"
          >
            <Textarea
              id="approval-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
            />
          </FormField>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => decide('approved')} loading={pending}>
              Approve
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => decide('changes_requested')}
              loading={pending}
            >
              Request changes
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => decide('rejected')}
              loading={pending}
            >
              Reject
            </Button>
          </div>
        </div>
      )}

      <div>
        <p className="text-tertiary mb-2 text-sm font-semibold">Version history</p>
        {versions.length === 0 ? (
          <p className="text-muted text-sm">
            No versions yet — submit the scorecard for approval to create one.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {versions.map((version) => (
              <li
                key={version.id}
                className="border-outline-cell rounded-card flex flex-wrap items-center justify-between gap-2 border bg-white p-3 text-sm"
              >
                <span className="text-tertiary font-medium">Version {version.versionNo}</span>
                <StatusBadge status={VERSION_STATUS_BADGE[version.status]}>
                  {version.status.replace('_', ' ')}
                </StatusBadge>
                {version.approvedAt && (
                  <span className="text-muted">
                    Approved {new Date(version.approvedAt).toLocaleDateString()}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
