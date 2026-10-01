'use client'

import { useState, useTransition } from 'react'
import {
  Alert,
  Button,
  Card,
  CardBody,
  EmptyState,
  FormField,
  ProgressIndicator,
  Select,
  StatusBadge,
  Textarea,
} from '@rqi/ui'
import {
  acceptAllVerifiedFieldsAction,
  editExtractedFieldAction,
  rejectExtractedFieldAction,
  reprocessCandidateDocumentAction,
  startCandidateDocumentProcessingAction,
  verifyExtractedFieldAction,
} from '@/lib/candidates/document-processing-actions'

/**
 * AI candidate-document processing UI (Build Phase 6 brief §UI): processing
 * queue/progress states, parsed-profile review, an original-document
 * evidence viewer (the source excerpt next to each proposed field),
 * field-by-field verification, accept-all-verified, reject/edit, reprocess
 * with reason, and the OCR-required / parsing-failed states. Deliberately
 * one responsive component rather than a separate desktop/mobile pair —
 * the same stacked-card layout (list controls above, one card per document)
 * reflows to a single column at mobile widths, satisfying "Mobile
 * verification workflow" without a second implementation to keep in sync.
 */

export interface ProcessingJobSummary {
  id: string
  candidateDocumentId: string
  status:
    | 'queued'
    | 'extracting_text'
    | 'needs_ocr'
    | 'parsing'
    | 'awaiting_review'
    | 'completed'
    | 'failed'
  errorKind: string | null
  errorMessage: string | null
  attemptNo: number
  reprocessReason: string | null
  model: string | null
  promptVersion: string | null
  createdAt: string
  completedAt: string | null
}

export interface ExtractedFieldSummary {
  id: string
  processingJobId: string
  fieldGroup: string
  fieldKey: string
  itemIndex: number | null
  extractedValue: unknown
  hasEvidence: boolean
  sourceLocation: string | null
  sourceExcerpt: string | null
  confidence: number | null
  verificationStatus: 'pending' | 'verified' | 'rejected' | 'edited'
  editedValue: unknown
  appliedAt: string | null
}

interface DocumentOption {
  id: string
  label: string
}

const STATUS_TO_BADGE: Record<
  ProcessingJobSummary['status'],
  'passed' | 'failed' | 'pending' | 'neutral'
> = {
  queued: 'pending',
  extracting_text: 'pending',
  parsing: 'pending',
  needs_ocr: 'neutral',
  awaiting_review: 'neutral',
  completed: 'passed',
  failed: 'failed',
}

const STATUS_LABEL: Record<ProcessingJobSummary['status'], string> = {
  queued: 'Queued',
  extracting_text: 'Extracting text',
  parsing: 'AI parsing in progress',
  needs_ocr: 'OCR required',
  awaiting_review: 'Awaiting review',
  completed: 'Completed',
  failed: 'Processing failed',
}

const STATUS_PROGRESS: Record<ProcessingJobSummary['status'], number> = {
  queued: 10,
  extracting_text: 35,
  parsing: 65,
  needs_ocr: 100,
  awaiting_review: 100,
  completed: 100,
  failed: 100,
}

function formatFieldLabel(fieldGroup: string, fieldKey: string): string {
  const words = fieldKey.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
  return `${fieldGroup}: ${words}`
}

function renderExtractedValue(value: unknown): string {
  if (value == null) return '—'
  if (typeof value === 'object' && 'value' in (value as Record<string, unknown>)) {
    return String((value as { value: unknown }).value ?? '—')
  }
  return JSON.stringify(value)
}

function FieldReviewCard({
  organizationId,
  candidateId,
  field,
  canReview,
}: {
  organizationId: string
  candidateId: string
  field: ExtractedFieldSummary
  canReview: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(() => renderExtractedValue(field.extractedValue))
  const [message, setMessage] = useState<string | null>(null)

  function runDecision(
    action: (formData: FormData) => Promise<{ success: boolean; message?: string }>,
    extra?: Record<string, string>,
  ) {
    const formData = new FormData()
    formData.set('organizationId', organizationId)
    formData.set('candidateId', candidateId)
    formData.set('fieldId', field.id)
    for (const [key, value] of Object.entries(extra ?? {})) formData.set(key, value)

    startTransition(async () => {
      const result = await action(formData)
      setMessage(result.message ?? null)
      if (result.success) setEditing(false)
    })
  }

  const disabled = pending || !canReview || field.verificationStatus !== 'pending'

  return (
    <div className="border-outline-cell flex flex-col gap-2 border-b px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-tertiary text-sm font-medium capitalize">
            {formatFieldLabel(field.fieldGroup, field.fieldKey)}
          </p>
          {field.hasEvidence ? (
            <p className="text-primary text-sm">{renderExtractedValue(field.extractedValue)}</p>
          ) : (
            <p className="text-muted text-sm italic">Unverified — not stated in the document</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {field.confidence != null && (
            <span className="text-muted text-xs">
              {Math.round(field.confidence * 100)}% confidence
            </span>
          )}
          <StatusBadge
            status={
              field.verificationStatus === 'verified' || field.verificationStatus === 'edited'
                ? 'passed'
                : field.verificationStatus === 'rejected'
                  ? 'failed'
                  : 'pending'
            }
          >
            {field.verificationStatus}
          </StatusBadge>
        </div>
      </div>

      {field.hasEvidence && field.sourceExcerpt && (
        <blockquote className="bg-surface-alt text-muted rounded-card border-outline-cell border px-3 py-2 text-xs italic">
          “{field.sourceExcerpt}”
          {field.sourceLocation && (
            <span className="text-muted not-italic"> — {field.sourceLocation}</span>
          )}
        </blockquote>
      )}

      {editing && (
        <div className="flex flex-col gap-2">
          <Textarea value={editValue} onChange={(e) => setEditValue(e.target.value)} rows={2} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                runDecision(editExtractedFieldAction, {
                  editedValueJson: JSON.stringify({ value: editValue }),
                })
              }
              loading={pending}
            >
              Save correction
            </Button>
          </div>
        </div>
      )}

      {message && <p className="text-danger text-xs">{message}</p>}

      {!editing && canReview && field.verificationStatus === 'pending' && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="verify"
            onClick={() => runDecision(verifyExtractedFieldAction)}
            loading={pending}
            disabled={disabled}
          >
            Verify
          </Button>
          <Button variant="ghost" onClick={() => setEditing(true)} disabled={pending}>
            Edit
          </Button>
          <Button
            variant="destructive"
            onClick={() => runDecision(rejectExtractedFieldAction)}
            loading={pending}
            disabled={disabled}
          >
            Reject
          </Button>
        </div>
      )}

      {field.appliedAt && <p className="text-muted text-xs">Applied to the candidate record.</p>}
    </div>
  )
}

export function CandidateDocumentProcessingPanel({
  organizationId,
  candidateId,
  documentOptions,
  jobs,
  fields,
  canProcess,
}: {
  organizationId: string
  candidateId: string
  documentOptions: DocumentOption[]
  jobs: ProcessingJobSummary[]
  fields: ExtractedFieldSummary[]
  canProcess: boolean
}) {
  const [selectedDocumentId, setSelectedDocumentId] = useState(documentOptions[0]?.id ?? '')
  const [startPending, startTransitionStart] = useTransition()
  const [reprocessReason, setReprocessReason] = useState('')
  const [reprocessPending, startTransitionReprocess] = useTransition()
  const [acceptPending, startTransitionAccept] = useTransition()
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)

  if (documentOptions.length === 0) {
    return (
      <EmptyState
        title="No CV uploaded yet"
        description="Upload a CV in the Documents tab before running AI processing."
      />
    )
  }

  const jobsForSelected = jobs
    .filter((j) => j.candidateDocumentId === selectedDocumentId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  const latestJob = jobsForSelected[0] ?? null
  const fieldsForLatestJob = latestJob
    ? fields.filter((f) => f.processingJobId === latestJob.id)
    : []
  const pendingCount = fieldsForLatestJob.filter((f) => f.verificationStatus === 'pending').length
  const acceptableCount = fieldsForLatestJob.filter(
    (f) =>
      (f.verificationStatus === 'verified' || f.verificationStatus === 'edited') && !f.appliedAt,
  ).length
  const isInFlight = latestJob
    ? ['queued', 'extracting_text', 'parsing'].includes(latestJob.status)
    : false

  function handleStart() {
    setMessage(null)
    const formData = new FormData()
    formData.set('organizationId', organizationId)
    formData.set('candidateId', candidateId)
    formData.set('candidateDocumentId', selectedDocumentId)
    startTransitionStart(async () => {
      const result = await startCandidateDocumentProcessingAction(formData)
      setMessage({ tone: result.success ? 'success' : 'danger', text: result.message ?? '' })
    })
  }

  function handleReprocess() {
    if (!latestJob || reprocessReason.trim().length === 0) return
    setMessage(null)
    const formData = new FormData()
    formData.set('organizationId', organizationId)
    formData.set('candidateId', candidateId)
    formData.set('candidateDocumentId', selectedDocumentId)
    formData.set('priorJobId', latestJob.id)
    formData.set('reason', reprocessReason)
    startTransitionReprocess(async () => {
      const result = await reprocessCandidateDocumentAction(formData)
      setMessage({ tone: result.success ? 'success' : 'danger', text: result.message ?? '' })
      if (result.success) setReprocessReason('')
    })
  }

  function handleAcceptAll() {
    if (!latestJob) return
    setMessage(null)
    const formData = new FormData()
    formData.set('organizationId', organizationId)
    formData.set('candidateId', candidateId)
    formData.set('processingJobId', latestJob.id)
    startTransitionAccept(async () => {
      const result = await acceptAllVerifiedFieldsAction(formData)
      setMessage({ tone: result.success ? 'success' : 'danger', text: result.message ?? '' })
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <FormField label="Document" htmlFor="processing-doc">
          <Select
            options={documentOptions.map((d) => ({ value: d.id, label: d.label }))}
            value={selectedDocumentId}
            onValueChange={setSelectedDocumentId}
          />
        </FormField>
        {canProcess && (
          <Button onClick={handleStart} loading={startPending} disabled={isInFlight}>
            {latestJob ? 'Reprocess (new attempt)' : 'Start AI processing'}
          </Button>
        )}
      </div>

      {message && (
        <Alert tone={message.tone === 'success' ? 'success' : 'danger'} title={message.text} />
      )}

      {!latestJob && (
        <EmptyState
          title="Not processed yet"
          description="Run AI processing to extract this CV's fields for review."
        />
      )}

      {latestJob && (
        <Card>
          <CardBody className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-tertiary text-sm font-medium">
                  Attempt {latestJob.attemptNo} ·{' '}
                  <StatusBadge status={STATUS_TO_BADGE[latestJob.status]}>
                    {STATUS_LABEL[latestJob.status]}
                  </StatusBadge>
                </p>
                {latestJob.model && (
                  <p className="text-muted text-xs">
                    {latestJob.model} · prompt {latestJob.promptVersion}
                  </p>
                )}
              </div>
              {isInFlight && (
                <ProgressIndicator
                  value={STATUS_PROGRESS[latestJob.status]}
                  label={STATUS_LABEL[latestJob.status]}
                />
              )}
            </div>

            {latestJob.status === 'needs_ocr' && (
              <Alert tone="warning" title="This document needs OCR">
                It has no readable text layer (likely a scanned CV) and OCR is not configured in
                this environment. Upload a text-based PDF/DOCX, or use “Reprocess with reason” once
                OCR is available.
              </Alert>
            )}

            {latestJob.status === 'failed' && (
              <Alert tone="danger" title="Processing failed">
                {latestJob.errorMessage ?? 'Processing failed for an unspecified reason.'}
              </Alert>
            )}

            {canProcess && (latestJob.status === 'needs_ocr' || latestJob.status === 'failed') && (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <FormField label="Reason for reprocessing" htmlFor="reprocess-reason">
                    <Textarea
                      id="reprocess-reason"
                      value={reprocessReason}
                      onChange={(e) => setReprocessReason(e.target.value)}
                      rows={2}
                      placeholder="e.g. re-uploaded a clearer scan"
                    />
                  </FormField>
                </div>
                <Button
                  onClick={handleReprocess}
                  loading={reprocessPending}
                  disabled={reprocessReason.trim().length === 0}
                >
                  Reprocess
                </Button>
              </div>
            )}

            {latestJob.status === 'awaiting_review' && (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-muted text-xs">
                    {pendingCount} field(s) awaiting review · {acceptableCount} ready to apply
                  </p>
                  {canProcess && acceptableCount > 0 && (
                    <Button variant="verify" onClick={handleAcceptAll} loading={acceptPending}>
                      Accept all verified fields
                    </Button>
                  )}
                </div>
                <div className="divide-outline-cell rounded-card border-outline-cell divide-y border">
                  {fieldsForLatestJob.map((field) => (
                    <FieldReviewCard
                      key={field.id}
                      organizationId={organizationId}
                      candidateId={candidateId}
                      field={field}
                      canReview={canProcess}
                    />
                  ))}
                </div>
              </>
            )}
          </CardBody>
        </Card>
      )}

      {jobsForSelected.length > 1 && (
        <Card>
          <CardBody>
            <p className="text-tertiary mb-2 text-sm font-medium">Processing history</p>
            <div className="divide-outline-cell divide-y">
              {jobsForSelected.slice(1).map((job) => (
                <div key={job.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-muted">
                    Attempt {job.attemptNo}
                    {job.reprocessReason ? ` — ${job.reprocessReason}` : ''}
                  </span>
                  <StatusBadge status={STATUS_TO_BADGE[job.status]}>
                    {STATUS_LABEL[job.status]}
                  </StatusBadge>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  )
}
