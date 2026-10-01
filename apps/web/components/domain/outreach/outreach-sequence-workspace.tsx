'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Alert,
  Button,
  Card,
  CardBody,
  FormField,
  Select,
  SectionHeader,
  StatusBadge,
  Textarea,
  Input,
} from '@rqi/ui'
import { demoModeEnabled } from '@/lib/env'
import type {
  CandidateResponseClassification,
  CommunicationChannel,
  CommunicationPreferenceStatus,
  OutreachMessageStatus,
} from '@rqi/types'
import type {
  OutreachSequenceDetail,
  OutreachMessageEntry,
  OutreachTemplateOption,
} from '@/lib/outreach/load-detail'
import {
  cancelOutreachMessageAction,
  cancelOutreachSequenceAction,
  confirmCandidateResponseClassificationAction,
  editOutreachDraftAction,
  generateOutreachDraftAction,
  recordCandidateResponseAction,
  recordManualChannelSendAction,
  recordOutreachApprovalAction,
  retryFailedOutreachMessageAction,
  sendOutreachMessageAction,
  submitOutreachDraftForApprovalAction,
  updateCommunicationPreferenceAction,
  verifyContactPointAction,
} from '@/lib/outreach/outreach-actions'

/**
 * Outreach sequence workspace (Build Phase 9 Wave 3 Task C). Mirrors the
 * useTransition + FormData-built action calls pattern from
 * apps/web/components/domain/shortlists/shortlist-workspace-panel.tsx and
 * review-queue-panel.tsx. One big client component covering: message
 * composer, AI draft review (evidence used / wroteGenerically indicator),
 * approval actions, sequence timeline, communication history, candidate
 * response review (untrusted plain text — never markdown/HTML), failed-
 * delivery retry, and contact-point / communication-preference controls.
 */

type Tone = 'success' | 'danger'

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

const CLASSIFICATION_OPTIONS: { value: CandidateResponseClassification; label: string }[] = [
  { value: 'interested', label: 'Interested' },
  { value: 'not_interested', label: 'Not interested' },
  { value: 'needs_more_info', label: 'Needs more info' },
  { value: 'follow_up_later', label: 'Follow up later' },
  { value: 'opt_out', label: 'Opt out' },
  { value: 'ambiguous', label: 'Ambiguous' },
]

export function OutreachSequenceWorkspace({
  organizationId,
  detail,
  templates,
  canManage,
}: {
  organizationId: string
  detail: OutreachSequenceDetail
  templates: OutreachTemplateOption[]
  canManage: boolean
}) {
  const router = useRouter()
  const [message, setMessage] = useState<{ tone: Tone; text: string } | null>(null)

  function refreshWith(outcome: { success: boolean; message?: string }) {
    setMessage(
      outcome.message
        ? { tone: outcome.success ? 'success' : 'danger', text: outcome.message }
        : null,
    )
    if (outcome.success) router.refresh()
  }

  const latest = detail.messages[0] ?? null
  const canStartNewMessage =
    canManage &&
    detail.status === 'active' &&
    (!latest || ['sent', 'delivered', 'responded', 'cancelled'].includes(latest.status))

  return (
    <div className="flex flex-col gap-6">
      {message && (
        <Alert tone={message.tone === 'success' ? 'success' : 'danger'} title={message.text} />
      )}

      <SequenceHeader
        organizationId={organizationId}
        detail={detail}
        canManage={canManage}
        onDone={refreshWith}
      />

      <ContactAndPreferencesPanel
        organizationId={organizationId}
        detail={detail}
        canManage={canManage}
        onDone={refreshWith}
      />

      {canStartNewMessage && (
        <DraftComposer
          organizationId={organizationId}
          sequenceId={detail.id}
          templates={templates}
          onDone={refreshWith}
        />
      )}

      {detail.messages.length === 0 && !canStartNewMessage && (
        <Card>
          <CardBody>
            <p className="text-muted text-sm">No draft has been generated for this sequence yet.</p>
          </CardBody>
        </Card>
      )}

      {detail.messages.map((msg, index) => (
        <OutreachMessageCard
          key={msg.id}
          organizationId={organizationId}
          candidateId={detail.candidateId}
          candidateName={detail.candidateName}
          recruitmentProjectId={detail.recruitmentProjectId}
          message={msg}
          isLatest={index === 0}
          canManage={canManage}
          contactPoints={detail.contactPoints}
          communicationPreferences={detail.communicationPreferences}
          onDone={refreshWith}
        />
      ))}
    </div>
  )
}

function SequenceHeader({
  organizationId,
  detail,
  canManage,
  onDone,
}: {
  organizationId: string
  detail: OutreachSequenceDetail
  canManage: boolean
  onDone: (outcome: { success: boolean; message?: string }) => void
}) {
  const [pending, startTransition] = useTransition()
  const [reason, setReason] = useState('')
  const [showCancel, setShowCancel] = useState(false)

  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionHeader title="Sequence status" />
          <StatusBadge
            status={
              detail.status === 'active'
                ? 'pending'
                : detail.status === 'completed'
                  ? 'passed'
                  : 'neutral'
            }
          >
            {detail.status}
          </StatusBadge>
        </div>
        {detail.status === 'cancelled' && detail.cancelReason && (
          <p className="text-muted text-xs">Cancelled: {detail.cancelReason}</p>
        )}

        {canManage && detail.status === 'active' && (
          <div className="flex flex-col gap-2">
            {!showCancel ? (
              <Button
                variant="secondary"
                size="sm"
                className="self-start"
                onClick={() => setShowCancel(true)}
              >
                Cancel sequence
              </Button>
            ) : (
              <div className="flex flex-col gap-2">
                <FormField label="Reason for cancelling" htmlFor="cancel-sequence-reason" required>
                  <Textarea
                    id="cancel-sequence-reason"
                    rows={2}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </FormField>
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={pending || reason.trim().length === 0}
                    onClick={() =>
                      startTransition(async () => {
                        const fd = new FormData()
                        fd.set('organizationId', organizationId)
                        fd.set('outreachSequenceId', detail.id)
                        fd.set('reason', reason)
                        const outcome = await cancelOutreachSequenceAction(fd)
                        onDone(outcome)
                        if (outcome.success) setShowCancel(false)
                      })
                    }
                  >
                    Confirm cancel
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setShowCancel(false)}>
                    Back
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  )
}

function ContactAndPreferencesPanel({
  organizationId,
  detail,
  canManage,
  onDone,
}: {
  organizationId: string
  detail: OutreachSequenceDetail
  canManage: boolean
  onDone: (outcome: { success: boolean; message?: string }) => void
}) {
  const [pending, startTransition] = useTransition()

  function run(action: () => Promise<{ success: boolean; message?: string }>) {
    startTransition(async () => onDone(await action()))
  }

  const channels: CommunicationChannel[] = ['email', 'phone', 'linkedin', 'sms']

  return (
    <Card>
      <CardBody className="flex flex-col gap-4">
        <SectionHeader title="Contact points & communication preferences" />

        <div className="flex flex-col gap-2">
          {detail.contactPoints.length === 0 && (
            <p className="text-muted text-xs">No contact points recorded for this candidate.</p>
          )}
          {detail.contactPoints.map((cp) => (
            <div
              key={cp.id}
              className="border-outline-cell flex items-center justify-between gap-3 border-b py-2 last:border-0"
            >
              <div>
                <p className="text-tertiary text-sm font-medium">
                  {cp.type} {cp.isPrimary && <span className="text-muted text-xs">(primary)</span>}
                </p>
                <p className="text-muted text-xs">{cp.value}</p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={cp.verified ? 'passed' : 'pending'}>
                  {cp.verified ? 'Verified' : 'Unverified'}
                </StatusBadge>
                {canManage && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      run(() => {
                        const fd = new FormData()
                        fd.set('organizationId', organizationId)
                        fd.set('contactPointId', cp.id)
                        fd.set('verified', String(!cp.verified))
                        return verifyContactPointAction(fd)
                      })
                    }
                  >
                    {cp.verified ? 'Mark unverified' : 'Mark verified'}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {channels.map((channel) => {
            const status: CommunicationPreferenceStatus =
              detail.communicationPreferences[channel] ?? 'unknown'
            return (
              <div key={channel} className="flex flex-col gap-1">
                <p className="text-muted text-[10px] font-semibold uppercase tracking-wide">
                  {channel}
                </p>
                <StatusBadge
                  status={
                    status === 'opted_out' ? 'failed' : status === 'opted_in' ? 'passed' : 'neutral'
                  }
                >
                  {status.replace('_', ' ')}
                </StatusBadge>
              </div>
            )
          })}
        </div>

        {canManage && (
          <OptOutForm
            organizationId={organizationId}
            candidateId={detail.candidateId}
            pending={pending}
            run={run}
          />
        )}
      </CardBody>
    </Card>
  )
}

function OptOutForm({
  organizationId,
  candidateId,
  pending,
  run,
}: {
  organizationId: string
  candidateId: string
  pending: boolean
  run: (action: () => Promise<{ success: boolean; message?: string }>) => void
}) {
  const [channel, setChannel] = useState<CommunicationChannel>('email')
  const [status, setStatus] = useState<CommunicationPreferenceStatus>('opted_out')
  const [reason, setReason] = useState('')

  return (
    <div className="border-outline-cell flex flex-col gap-2 border-t pt-3">
      <p className="text-tertiary text-xs font-semibold">Record a direct preference change</p>
      <div className="flex flex-wrap gap-2">
        <Select
          options={[
            { value: 'email', label: 'Email' },
            { value: 'phone', label: 'Phone' },
            { value: 'linkedin', label: 'LinkedIn' },
            { value: 'sms', label: 'SMS' },
          ]}
          value={channel}
          onValueChange={(v) => setChannel(v as CommunicationChannel)}
        />
        <Select
          options={[
            { value: 'opted_in', label: 'Opted in' },
            { value: 'opted_out', label: 'Opted out' },
            { value: 'unknown', label: 'Unknown' },
          ]}
          value={status}
          onValueChange={(v) => setStatus(v as CommunicationPreferenceStatus)}
        />
      </div>
      {status === 'opted_out' && (
        <FormField label="Reason" htmlFor="opt-out-reason" required>
          <Textarea
            id="opt-out-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </FormField>
      )}
      <Button
        variant="secondary"
        size="sm"
        className="self-start"
        disabled={pending || (status === 'opted_out' && reason.trim().length === 0)}
        onClick={() =>
          run(() => {
            const fd = new FormData()
            fd.set('organizationId', organizationId)
            fd.set('candidateId', candidateId)
            fd.set('channel', channel)
            fd.set('status', status)
            if (reason) fd.set('reason', reason)
            return updateCommunicationPreferenceAction(fd)
          })
        }
      >
        Save preference
      </Button>
    </div>
  )
}

function DraftComposer({
  organizationId,
  sequenceId,
  templates,
  onDone,
}: {
  organizationId: string
  sequenceId: string
  templates: OutreachTemplateOption[]
  onDone: (outcome: { success: boolean; message?: string }) => void
}) {
  const [pending, startTransition] = useTransition()
  const [channel, setChannel] = useState<CommunicationChannel>('email')
  const [templateId, setTemplateId] = useState<string>('')
  const [tone, setTone] = useState('')

  const channelTemplates = templates.filter((t) => t.channel === channel)

  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <SectionHeader title="Generate an AI outreach draft" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Channel" htmlFor="draft-channel">
            <Select
              options={[
                { value: 'email', label: 'Email' },
                { value: 'phone', label: 'Phone (manual)' },
                { value: 'linkedin', label: 'LinkedIn (manual)' },
                { value: 'sms', label: 'SMS (manual)' },
              ]}
              value={channel}
              onValueChange={(v) => {
                setChannel(v as CommunicationChannel)
                setTemplateId('')
              }}
            />
          </FormField>
          <FormField label="Template (optional)" htmlFor="draft-template">
            <Select
              options={[
                { value: '', label: 'No template' },
                ...channelTemplates.map((t) => ({ value: t.id, label: t.name })),
              ]}
              value={templateId}
              onValueChange={setTemplateId}
            />
          </FormField>
        </div>
        <FormField
          label="Tone / instructions (optional)"
          htmlFor="draft-tone"
          hint="e.g. 'Keep it under 120 words, mention flexible hours.'"
        >
          <Textarea
            id="draft-tone"
            rows={2}
            value={tone}
            onChange={(e) => setTone(e.target.value)}
          />
        </FormField>
        <Button
          variant="primary"
          className="self-start"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const fd = new FormData()
              fd.set('organizationId', organizationId)
              fd.set('outreachSequenceId', sequenceId)
              fd.set('channel', channel)
              if (templateId) fd.set('templateId', templateId)
              if (tone) fd.set('toneInstructions', tone)
              onDone(await generateOutreachDraftAction(fd))
            })
          }
        >
          {pending ? 'Generating…' : 'Generate draft'}
        </Button>
      </CardBody>
    </Card>
  )
}

function OutreachMessageCard({
  organizationId,
  candidateId,
  candidateName,
  recruitmentProjectId,
  message,
  isLatest,
  canManage,
  contactPoints,
  communicationPreferences,
  onDone,
}: {
  organizationId: string
  candidateId: string
  candidateName: string
  recruitmentProjectId: string
  message: OutreachMessageEntry
  isLatest: boolean
  canManage: boolean
  contactPoints: OutreachSequenceDetail['contactPoints']
  communicationPreferences: OutreachSequenceDetail['communicationPreferences']
  onDone: (outcome: { success: boolean; message?: string }) => void
}) {
  const [pending, startTransition] = useTransition()
  const [subject, setSubject] = useState(message.subject ?? '')
  const [body, setBody] = useState(message.draftBody)
  const [editing, setEditing] = useState(false)

  const editable =
    canManage &&
    isLatest &&
    (message.status === 'drafted' || message.status === 'awaiting_approval')
  const matchingContact =
    contactPoints.find((cp) => cp.type === message.channel) ??
    contactPoints.find((cp) => cp.isPrimary)

  function run(action: () => Promise<{ success: boolean; message?: string }>) {
    startTransition(async () => onDone(await action()))
  }

  return (
    <Card>
      <CardBody className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionHeader title={`${message.channel} message`} />
          <div className="flex items-center gap-2">
            {message.generatedBy === 'ai' && (
              <StatusBadge status="neutral">
                AI-drafted{message.editedByHuman ? ' · edited' : ''}
              </StatusBadge>
            )}
            {message.generatedBy === 'recruiter' && (
              <StatusBadge status="neutral">Recruiter-written</StatusBadge>
            )}
            <StatusBadge status={MESSAGE_STATUS_BADGE[message.status]}>
              {message.status.replace(/_/g, ' ')}
            </StatusBadge>
          </div>
        </div>

        {demoModeEnabled && message.status !== 'sent' && message.status !== 'delivered' && (
          <Alert
            tone="info"
            title="Preview only — outreach sending is disabled in this demo. This message will never be sent."
          />
        )}

        {/* Draft content */}
        {editing && editable ? (
          <div className="flex flex-col gap-2">
            <FormField label="Subject (optional)" htmlFor={`subject-${message.id}`}>
              <Input
                id={`subject-${message.id}`}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </FormField>
            <FormField label="Message body" htmlFor={`body-${message.id}`} required>
              <Textarea
                id={`body-${message.id}`}
                rows={8}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </FormField>
            <div className="flex gap-2">
              <Button
                variant="primary"
                size="sm"
                disabled={pending || body.trim().length === 0}
                onClick={() =>
                  run(async () => {
                    const fd = new FormData()
                    fd.set('organizationId', organizationId)
                    fd.set('outreachMessageId', message.id)
                    if (subject) fd.set('subject', subject)
                    fd.set('draftBody', body)
                    const outcome = await editOutreachDraftAction(fd)
                    if (outcome.success) setEditing(false)
                    return outcome
                  })
                }
              >
                Save edits
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {message.subject && (
              <p className="text-tertiary text-sm font-semibold">Subject: {message.subject}</p>
            )}
            {/* Plain text only — this is recruiter/AI-authored outbound content, still rendered as text, never HTML/markdown. */}
            <p className="text-tertiary whitespace-pre-wrap text-sm">{message.draftBody}</p>
            {editable && (
              <Button
                variant="secondary"
                size="sm"
                className="self-start"
                onClick={() => setEditing(true)}
              >
                Edit draft
              </Button>
            )}
          </div>
        )}

        {/* Evidence used */}
        <div className="border-outline-cell border-t pt-3">
          <p className="text-tertiary text-xs font-semibold">Evidence used for personalization</p>
          {message.personalizationEvidence.length === 0 ? (
            <p className="text-muted mt-1 text-xs italic">
              No verified candidate evidence was cited — this draft is generic, or its self-reported
              evidence failed verification and was removed. Review carefully before sending.
            </p>
          ) : (
            <ul className="mt-1 flex flex-col gap-1.5">
              {message.personalizationEvidence.map((item, i) => (
                <li key={i} className="text-muted text-xs">
                  <span className="text-tertiary font-medium">{item.claimText}</span> — evidence (
                  {item.sourceKind}): &ldquo;{item.evidenceExcerpt}&rdquo;
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Action controls */}
        {canManage && isLatest && (
          <MessageActions
            organizationId={organizationId}
            message={message}
            pending={pending}
            run={run}
            matchingContactValue={matchingContact?.value ?? ''}
            communicationPreferences={communicationPreferences}
          />
        )}

        {/* Approval history */}
        {message.approvals.length > 0 && (
          <div className="border-outline-cell border-t pt-3">
            <p className="text-tertiary text-xs font-semibold">Approval history</p>
            <ul className="mt-1 flex flex-col gap-1">
              {message.approvals.map((a) => (
                <li key={a.id} className="text-muted text-xs">
                  {a.decision.replace(/_/g, ' ')} · {new Date(a.createdAt).toLocaleString()}
                  {a.reason && <> — {a.reason}</>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Communication events timeline */}
        {message.events.length > 0 && (
          <div className="border-outline-cell border-t pt-3">
            <p className="text-tertiary text-xs font-semibold">Communication timeline</p>
            <ul className="mt-1 flex flex-col gap-1">
              {message.events.map((e) => (
                <li key={e.id} className="text-muted text-xs">
                  {e.direction} · {e.eventType.replace(/_/g, ' ')}{' '}
                  {e.provider ? `(${e.provider})` : ''} — {new Date(e.occurredAt).toLocaleString()}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Candidate responses */}
        <ResponsesSection
          organizationId={organizationId}
          candidateId={candidateId}
          candidateName={candidateName}
          recruitmentProjectId={recruitmentProjectId}
          message={message}
          canManage={canManage}
          onDone={onDone}
        />
      </CardBody>
    </Card>
  )
}

function MessageActions({
  organizationId,
  message,
  pending,
  run,
  matchingContactValue,
  communicationPreferences,
}: {
  organizationId: string
  message: OutreachMessageEntry
  pending: boolean
  run: (action: () => Promise<{ success: boolean; message?: string }>) => void
  matchingContactValue: string
  communicationPreferences: OutreachSequenceDetail['communicationPreferences']
}) {
  const [reason, setReason] = useState('')
  const [showDecision, setShowDecision] = useState<'rejected' | 'changes_requested' | null>(null)
  const [senderIdentifier, setSenderIdentifier] = useState('')
  const [recipientAddress, setRecipientAddress] = useState(matchingContactValue)
  const [cancelReason, setCancelReason] = useState('')
  const [showCancel, setShowCancel] = useState(false)

  const optedOut = communicationPreferences[message.channel] === 'opted_out'

  return (
    <div className="border-outline-cell flex flex-col gap-3 border-t pt-3">
      {optedOut && (
        <Alert
          tone="warning"
          title={`This candidate has opted out of ${message.channel}. Sending is blocked.`}
        />
      )}

      {message.status === 'drafted' && (
        <Button
          variant="primary"
          size="sm"
          className="self-start"
          disabled={pending}
          onClick={() =>
            run(() => {
              const fd = new FormData()
              fd.set('organizationId', organizationId)
              fd.set('outreachMessageId', message.id)
              return submitOutreachDraftForApprovalAction(fd)
            })
          }
        >
          Submit for approval
        </Button>
      )}

      {message.status === 'awaiting_approval' && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={pending || optedOut}
              onClick={() =>
                run(() => {
                  const fd = new FormData()
                  fd.set('organizationId', organizationId)
                  fd.set('outreachMessageId', message.id)
                  fd.set('decision', 'approved')
                  return recordOutreachApprovalAction(fd)
                })
              }
            >
              Approve
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() => setShowDecision('changes_requested')}
            >
              Request changes
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={pending}
              onClick={() => setShowDecision('rejected')}
            >
              Reject
            </Button>
          </div>
          {showDecision && (
            <div className="flex flex-col gap-2">
              <FormField label="Reason" htmlFor={`decision-reason-${message.id}`} required>
                <Textarea
                  id={`decision-reason-${message.id}`}
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </FormField>
              <Button
                variant="primary"
                size="sm"
                className="self-start"
                disabled={pending || reason.trim().length === 0}
                onClick={() =>
                  run(() => {
                    const fd = new FormData()
                    fd.set('organizationId', organizationId)
                    fd.set('outreachMessageId', message.id)
                    fd.set('decision', showDecision)
                    fd.set('reason', reason)
                    const p = recordOutreachApprovalAction(fd)
                    setShowDecision(null)
                    setReason('')
                    return p
                  })
                }
              >
                Confirm {showDecision === 'rejected' ? 'reject' : 'request changes'}
              </Button>
            </div>
          )}
        </div>
      )}

      {message.status === 'approved' && message.channel === 'email' && (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <FormField label="Sender mailbox (from)" htmlFor={`sender-${message.id}`} required>
              <Input
                id={`sender-${message.id}`}
                value={senderIdentifier}
                onChange={(e) => setSenderIdentifier(e.target.value)}
                placeholder="you@agency.com"
              />
            </FormField>
            <FormField label="Recipient email" htmlFor={`recipient-${message.id}`} required>
              <Input
                id={`recipient-${message.id}`}
                value={recipientAddress}
                onChange={(e) => setRecipientAddress(e.target.value)}
              />
            </FormField>
          </div>
          <Button
            variant="primary"
            size="sm"
            className="self-start"
            disabled={
              pending ||
              optedOut ||
              senderIdentifier.trim().length === 0 ||
              recipientAddress.trim().length === 0
            }
            onClick={() =>
              run(() => {
                const fd = new FormData()
                fd.set('organizationId', organizationId)
                fd.set('outreachMessageId', message.id)
                fd.set('senderAccountIdentifier', senderIdentifier)
                fd.set('recipientAddress', recipientAddress)
                return sendOutreachMessageAction(fd)
              })
            }
          >
            Send email
          </Button>
        </div>
      )}

      {message.status === 'approved' && message.channel !== 'email' && (
        <div className="flex flex-col gap-2">
          <p className="text-muted text-xs">
            {message.channel} is a manual channel — copy the message text above and send it
            yourself, then log the send below.
          </p>
          <Button
            variant="primary"
            size="sm"
            className="self-start"
            disabled={pending || optedOut}
            onClick={() =>
              run(() => {
                const fd = new FormData()
                fd.set('organizationId', organizationId)
                fd.set('outreachMessageId', message.id)
                return recordManualChannelSendAction(fd)
              })
            }
          >
            Log manual send
          </Button>
        </div>
      )}

      {message.status === 'failed' && (
        <div className="flex flex-col gap-2">
          {message.failureReason && (
            <p className="text-danger text-xs">Failure: {message.failureReason}</p>
          )}
          <Button
            variant="primary"
            size="sm"
            className="self-start"
            disabled={pending}
            onClick={() =>
              run(() => {
                const fd = new FormData()
                fd.set('organizationId', organizationId)
                fd.set('outreachMessageId', message.id)
                return retryFailedOutreachMessageAction(fd)
              })
            }
          >
            Retry (back to awaiting approval)
          </Button>
        </div>
      )}

      {['drafted', 'awaiting_approval', 'approved', 'scheduled'].includes(message.status) && (
        <div className="flex flex-col gap-2">
          {!showCancel ? (
            <Button
              variant="secondary"
              size="sm"
              className="self-start"
              onClick={() => setShowCancel(true)}
            >
              Cancel this message
            </Button>
          ) : (
            <div className="flex flex-col gap-2">
              <FormField label="Reason" htmlFor={`cancel-msg-reason-${message.id}`} required>
                <Textarea
                  id={`cancel-msg-reason-${message.id}`}
                  rows={2}
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                />
              </FormField>
              <Button
                variant="destructive"
                size="sm"
                className="self-start"
                disabled={pending || cancelReason.trim().length === 0}
                onClick={() =>
                  run(() => {
                    const fd = new FormData()
                    fd.set('organizationId', organizationId)
                    fd.set('outreachMessageId', message.id)
                    fd.set('reason', cancelReason)
                    setShowCancel(false)
                    return cancelOutreachMessageAction(fd)
                  })
                }
              >
                Confirm cancel
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ResponsesSection({
  organizationId,
  candidateId,
  candidateName,
  recruitmentProjectId,
  message,
  canManage,
  onDone,
}: {
  organizationId: string
  candidateId: string
  candidateName: string
  recruitmentProjectId: string
  message: OutreachMessageEntry
  canManage: boolean
  onDone: (outcome: { success: boolean; message?: string }) => void
}) {
  const [pending, startTransition] = useTransition()
  const [showLogForm, setShowLogForm] = useState(false)
  const [responseText, setResponseText] = useState('')
  const [runClassification, setRunClassification] = useState(true)

  function run(action: () => Promise<{ success: boolean; message?: string }>) {
    startTransition(async () => onDone(await action()))
  }

  return (
    <div className="border-outline-cell border-t pt-3">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-tertiary text-xs font-semibold">Candidate responses</p>
        {canManage && (
          <Button variant="secondary" size="sm" onClick={() => setShowLogForm((v) => !v)}>
            {showLogForm ? 'Close' : 'Log a response'}
          </Button>
        )}
      </div>

      {showLogForm && (
        <div className="mb-3 flex flex-col gap-2">
          <FormField
            label={`${candidateName}'s reply (verbatim)`}
            htmlFor={`response-text-${message.id}`}
            required
          >
            <Textarea
              id={`response-text-${message.id}`}
              rows={4}
              value={responseText}
              onChange={(e) => setResponseText(e.target.value)}
            />
          </FormField>
          <label className="text-muted flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={runClassification}
              onChange={(e) => setRunClassification(e.target.checked)}
              className="border-outline-perimeter h-4 w-4 rounded-sm"
            />
            Ask the AI to suggest a classification (advisory only — a human still confirms it)
          </label>
          <Button
            variant="primary"
            size="sm"
            className="self-start"
            disabled={pending || responseText.trim().length === 0}
            onClick={() =>
              run(async () => {
                const fd = new FormData()
                fd.set('organizationId', organizationId)
                fd.set('candidateId', candidateId)
                fd.set('recruitmentProjectId', recruitmentProjectId)
                fd.set('channel', message.channel)
                fd.set('outreachMessageId', message.id)
                fd.set('rawResponseText', responseText)
                if (runClassification) fd.set('runClassification', 'true')
                const outcome = await recordCandidateResponseAction(fd)
                if (outcome.success) {
                  setResponseText('')
                  setShowLogForm(false)
                }
                return outcome
              })
            }
          >
            {pending ? 'Saving…' : 'Save response'}
          </Button>
        </div>
      )}

      {message.responses.length === 0 ? (
        <p className="text-muted text-xs">No responses logged for this message yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {message.responses.map((r) => (
            <ResponseRow
              key={r.id}
              organizationId={organizationId}
              response={r}
              canManage={canManage}
              onDone={onDone}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ResponseRow({
  organizationId,
  response,
  canManage,
  onDone,
}: {
  organizationId: string
  response: OutreachMessageEntry['responses'][number]
  canManage: boolean
  onDone: (outcome: { success: boolean; message?: string }) => void
}) {
  const [pending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState(false)
  const [classification, setClassification] = useState<CandidateResponseClassification>(
    response.aiSuggestedClassification ?? 'ambiguous',
  )
  const [note, setNote] = useState('')

  return (
    <div className="rounded-card border-outline-cell border p-3">
      {/* Untrusted candidate-authored text: rendered as plain text only, never markdown/HTML. */}
      <p className="text-tertiary whitespace-pre-wrap text-sm">{response.rawResponseText}</p>
      <p className="text-muted mt-1 text-xs">
        {new Date(response.receivedAt).toLocaleString()} · {response.channel}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {response.aiSuggestedClassification && (
          <StatusBadge status="neutral">
            AI suggests: {response.aiSuggestedClassification.replace(/_/g, ' ')}
          </StatusBadge>
        )}
        {response.confirmedClassification ? (
          <StatusBadge
            status={response.confirmedClassification === 'opt_out' ? 'failed' : 'passed'}
          >
            Confirmed: {response.confirmedClassification.replace(/_/g, ' ')}
          </StatusBadge>
        ) : (
          <StatusBadge status="pending">Awaiting human classification</StatusBadge>
        )}
      </div>

      {canManage && !response.confirmedClassification && (
        <div className="mt-2">
          {!confirming ? (
            <Button variant="secondary" size="sm" onClick={() => setConfirming(true)}>
              Confirm classification
            </Button>
          ) : (
            <div className="flex flex-col gap-2">
              <Select
                options={CLASSIFICATION_OPTIONS}
                value={classification}
                onValueChange={(v) => setClassification(v as CandidateResponseClassification)}
              />
              <FormField label="Note (optional)" htmlFor={`review-note-${response.id}`}>
                <Textarea
                  id={`review-note-${response.id}`}
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </FormField>
              <Button
                variant="primary"
                size="sm"
                className="self-start"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const fd = new FormData()
                    fd.set('organizationId', organizationId)
                    fd.set('candidateResponseId', response.id)
                    fd.set('confirmedClassification', classification)
                    if (note) fd.set('reviewNote', note)
                    const outcome = await confirmCandidateResponseClassificationAction(fd)
                    onDone(outcome)
                    if (outcome.success) setConfirming(false)
                  })
                }
              >
                Save classification
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
