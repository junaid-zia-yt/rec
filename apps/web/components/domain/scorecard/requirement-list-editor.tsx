'use client'

import { useMemo, useState, useTransition } from 'react'
import { Alert, Button, FormField, Input, Select, StatusBadge, Textarea } from '@rqi/ui'
import type { JobRequirement, RequirementType } from '@rqi/types'
import { validateRequirementWeights } from '@/lib/scoring/validate-weights'
import {
  createRequirementAction,
  deleteRequirementAction,
  updateRequirementAction,
} from '@/lib/requirements/actions'

const TYPE_OPTIONS: { value: RequirementType; label: string }[] = [
  { value: 'mandatory', label: 'Mandatory' },
  { value: 'preferred', label: 'Preferred' },
  { value: 'informational', label: 'Informational' },
  { value: 'disqualifying', label: 'Disqualifying' },
  { value: 'requires_clarification', label: 'Requires clarification' },
]

const TYPE_BADGE_STATUS: Record<RequirementType, 'failed' | 'passed' | 'neutral' | 'pending'> = {
  mandatory: 'failed',
  preferred: 'passed',
  informational: 'neutral',
  disqualifying: 'failed',
  requires_clarification: 'pending',
}

const EMPTY_DRAFT = {
  name: '',
  description: '',
  category: '',
  type: 'mandatory' as RequirementType,
  weight: '',
  evidenceExpected: '',
}

/**
 * The job scorecard editor's requirement list (Build Phase 4 brief §UI:
 * "Job scorecard editor", "Requirement classification controls", "Weight
 * editor", "Source evidence viewer", "Scorecard validation"). Every write
 * goes through the same server actions whether the row originated from AI
 * extraction or a manual add — this component never distinguishes them for
 * permission purposes, only for the "AI proposed" badge shown per row.
 */
export function RequirementListEditor({
  organizationId,
  projectId,
  projectClientId,
  jobId,
  requirements,
  canEdit,
}: {
  organizationId: string
  projectId: string
  projectClientId: string
  jobId: string
  requirements: JobRequirement[]
  canEdit: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const weightCheck = useMemo(
    () =>
      validateRequirementWeights(
        requirements.map((r) => ({ id: r.id, type: r.type, weight: r.weight })),
      ),
    [requirements],
  )

  function runAction(
    formData: FormData,
    action: (formData: FormData) => Promise<{ success: boolean; message?: string }>,
  ) {
    formData.set('organizationId', organizationId)
    formData.set('projectId', projectId)
    formData.set('projectClientId', projectClientId)
    setMessage(null)
    startTransition(async () => {
      const result = await action(formData)
      setMessage({
        tone: result.success ? 'success' : 'danger',
        text: result.message ?? 'Something went wrong.',
      })
      if (result.success) {
        setEditingId(null)
        setAdding(false)
        setDraft(EMPTY_DRAFT)
        setConfirmDeleteId(null)
      }
    })
  }

  function submitAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    formData.set('jobId', jobId)
    runAction(formData, createRequirementAction)
  }

  function submitEdit(event: React.FormEvent<HTMLFormElement>, requirementId: string) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    formData.set('requirementId', requirementId)
    runAction(formData, updateRequirementAction)
  }

  function confirmDelete(requirementId: string) {
    const formData = new FormData()
    formData.set('requirementId', requirementId)
    runAction(formData, deleteRequirementAction)
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

      {requirements.length === 0 ? (
        <p className="text-muted text-sm">
          No requirements yet. Run AI extraction above, or add one manually.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {requirements.map((requirement) => (
            <div
              key={requirement.id}
              className="border-outline-cell rounded-card border bg-white p-4"
            >
              {editingId === requirement.id ? (
                <form
                  onSubmit={(e) => submitEdit(e, requirement.id)}
                  className="flex flex-col gap-3"
                >
                  <RequirementFields defaultValues={requirement} />
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="secondary" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                    <Button type="submit" loading={pending}>
                      Save
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-tertiary text-sm font-semibold">{requirement.name}</p>
                      <StatusBadge status={TYPE_BADGE_STATUS[requirement.type]}>
                        {TYPE_OPTIONS.find((t) => t.value === requirement.type)?.label}
                      </StatusBadge>
                      {requirement.type === 'preferred' && requirement.weight != null && (
                        <StatusBadge status="neutral">{requirement.weight}%</StatusBadge>
                      )}
                      {requirement.aiGenerated && (
                        <StatusBadge
                          status={requirement.status === 'proposed' ? 'pending' : 'neutral'}
                        >
                          {requirement.status === 'proposed'
                            ? 'AI proposed — unreviewed'
                            : 'AI proposed — reviewed'}
                        </StatusBadge>
                      )}
                      <StatusBadge
                        status={
                          requirement.verificationStatus === 'verified' ? 'passed' : 'neutral'
                        }
                      >
                        {requirement.verificationStatus}
                      </StatusBadge>
                    </div>
                    {canEdit && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="text-secondary text-xs font-medium"
                          onClick={() => setEditingId(requirement.id)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="text-danger text-xs font-medium"
                          onClick={() => setConfirmDeleteId(requirement.id)}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                  {requirement.description && (
                    <p className="text-muted text-sm">{requirement.description}</p>
                  )}

                  <button
                    type="button"
                    className="text-secondary w-fit text-xs font-medium"
                    onClick={() =>
                      setExpandedId(expandedId === requirement.id ? null : requirement.id)
                    }
                  >
                    {expandedId === requirement.id
                      ? 'Hide source evidence'
                      : 'View source evidence'}
                  </button>
                  {expandedId === requirement.id && (
                    <div className="bg-canvas rounded-card flex flex-col gap-1 p-3 text-sm">
                      <p className="text-muted">
                        <span className="text-tertiary font-medium">Source text: </span>
                        {requirement.sourceText
                          ? `"${requirement.sourceText}"`
                          : 'Not recorded (manually added).'}
                      </p>
                      {requirement.sourceLocation && (
                        <p className="text-muted">
                          <span className="text-tertiary font-medium">Location: </span>
                          {requirement.sourceLocation}
                        </p>
                      )}
                      <p className="text-muted">
                        <span className="text-tertiary font-medium">Evidence expected: </span>
                        {requirement.evidenceExpected || 'Not specified.'}
                      </p>
                      <p className="text-muted">
                        <span className="text-tertiary font-medium">AI confidence: </span>
                        {requirement.confidence != null
                          ? `${Math.round(requirement.confidence * 100)}%`
                          : 'n/a'}
                      </p>
                      {requirement.reviewerNotes && (
                        <p className="text-muted">
                          <span className="text-tertiary font-medium">Reviewer notes: </span>
                          {requirement.reviewerNotes}
                        </p>
                      )}
                    </div>
                  )}

                  {confirmDeleteId === requirement.id && (
                    <div className="border-danger-border bg-danger-bg rounded-card flex items-center justify-between gap-3 border p-3">
                      <p className="text-danger text-sm">
                        Delete &ldquo;{requirement.name}&rdquo;? This cannot be undone.
                      </p>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          loading={pending}
                          onClick={() => confirmDelete(requirement.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!weightCheck.valid && requirements.length > 0 && (
        <Alert tone="warning" title="Scorecard weights are not yet valid">
          <ul className="list-disc pl-4">
            {weightCheck.errors.map((error, index) => (
              <li key={index}>{error}</li>
            ))}
          </ul>
        </Alert>
      )}
      {weightCheck.valid && weightCheck.preferredWeightTotal !== null && (
        <Alert tone="success" title="Preferred weights total 100%">
          This scorecard&apos;s weighting is valid and ready for submission.
        </Alert>
      )}

      {canEdit && (
        <div>
          {adding ? (
            <form
              onSubmit={submitAdd}
              className="border-outline-cell rounded-card flex flex-col gap-3 border bg-white p-4"
            >
              <RequirementFields defaultValues={null} />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setAdding(false)}>
                  Cancel
                </Button>
                <Button type="submit" loading={pending}>
                  Add requirement
                </Button>
              </div>
            </form>
          ) : (
            <Button type="button" variant="secondary" onClick={() => setAdding(true)}>
              Add requirement manually
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

/** Shared name/description/category/type/weight/evidence fields for both the add form and an in-place row edit. */
function RequirementFields({ defaultValues }: { defaultValues: JobRequirement | null }) {
  const [type, setType] = useState<RequirementType>(defaultValues?.type ?? 'mandatory')

  return (
    <>
      <FormField label="Name" htmlFor="req-name" required>
        <Input
          id="req-name"
          name="name"
          required
          defaultValue={defaultValues?.name}
          maxLength={200}
        />
      </FormField>
      <FormField label="Description" htmlFor="req-description">
        <Textarea
          id="req-description"
          name="description"
          rows={2}
          defaultValue={defaultValues?.description}
        />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Category" htmlFor="req-category">
          <Input id="req-category" name="category" defaultValue={defaultValues?.category} />
        </FormField>
        <FormField label="Requirement type" htmlFor="req-type" required>
          <Select
            name="type"
            defaultValue={defaultValues?.type ?? 'mandatory'}
            onValueChange={(value) => setType(value as RequirementType)}
            options={TYPE_OPTIONS}
          />
        </FormField>
      </div>
      {type === 'preferred' && (
        <FormField
          label="Weight (%)"
          htmlFor="req-weight"
          required
          hint="Preferred requirement weights across the scorecard must total 100%."
        >
          <Input
            id="req-weight"
            name="weight"
            type="number"
            min={0}
            max={100}
            required
            defaultValue={defaultValues?.weight ?? undefined}
          />
        </FormField>
      )}
      <FormField
        label="Evidence expected"
        htmlFor="req-evidence"
        hint="What a recruiter should look for in a candidate's CV/profile to confirm this."
      >
        <Textarea
          id="req-evidence"
          name="evidenceExpected"
          rows={2}
          defaultValue={defaultValues?.evidenceExpected}
        />
      </FormField>
      {defaultValues && (
        <FormField label="Reviewer notes" htmlFor="req-reviewer-notes">
          <Textarea
            id="req-reviewer-notes"
            name="reviewerNotes"
            rows={2}
            defaultValue={defaultValues.reviewerNotes ?? ''}
          />
        </FormField>
      )}
    </>
  )
}
