'use client'

import { useState, useTransition } from 'react'
import { Button, Card, FormField, IconButton, Input, Select, Textarea } from '@rqi/ui'
import { Trash2 } from 'lucide-react'
import type {
  CandidateCertification,
  CandidateEducation,
  CandidateExperience,
  CandidateSkill,
} from '@rqi/types'
import {
  addCandidateCertificationAction,
  addCandidateEducationAction,
  addCandidateExperienceAction,
  addCandidateSkillAction,
  deleteCandidateCertificationAction,
  deleteCandidateEducationAction,
  deleteCandidateExperienceAction,
  deleteCandidateSkillAction,
} from '@/lib/candidates/detail-actions'

type ActionFn = (formData: FormData) => Promise<{ success: boolean; message?: string }>

/** Shared add-row / delete-row shell for the four candidate detail lists — Build Phase 5 brief §"Candidate profile": employment history, education, certifications, skills. Create + delete only; correcting an entry is delete-and-re-add (see lib/candidates/detail-actions.ts header comment). */
function DetailListSection({
  organizationId,
  candidateId,
  canEdit,
  addAction,
  deleteAction,
  items,
  renderItem,
  renderForm,
  emptyLabel,
}: {
  organizationId: string
  candidateId: string
  canEdit: boolean
  addAction: ActionFn
  deleteAction: ActionFn
  items: { id: string }[]
  renderItem: (item: { id: string }) => React.ReactNode
  renderForm: () => React.ReactNode
  emptyLabel: string
}) {
  const [pending, startTransition] = useTransition()
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [showForm, setShowForm] = useState(false)

  function handleAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage(null)
    const formData = new FormData(event.currentTarget)
    formData.set('organizationId', organizationId)
    formData.set('candidateId', candidateId)
    startTransition(async () => {
      const result = await addAction(formData)
      setMessage({
        tone: result.success ? 'success' : 'danger',
        text: result.message ?? 'Something went wrong.',
      })
      if (result.success) {
        event.currentTarget.reset()
        setShowForm(false)
      }
    })
  }

  function handleDelete(rowId: string) {
    setDeletingId(rowId)
    const formData = new FormData()
    formData.set('organizationId', organizationId)
    formData.set('candidateId', candidateId)
    formData.set('rowId', rowId)
    startTransition(async () => {
      const result = await deleteAction(formData)
      if (!result.success)
        setMessage({ tone: 'danger', text: result.message ?? 'Could not remove this entry.' })
      setDeletingId(null)
    })
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

      {items.length === 0 ? (
        <p className="text-muted text-sm">{emptyLabel}</p>
      ) : (
        <Card>
          <ul className="divide-outline-cell divide-y">
            {items.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-2 px-4 py-3">
                <div className="min-w-0 flex-1">{renderItem(item)}</div>
                {canEdit && (
                  <IconButton
                    label="Remove"
                    onClick={() => handleDelete(item.id)}
                    disabled={pending && deletingId === item.id}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </IconButton>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {canEdit && (
        <>
          {showForm ? (
            <form
              onSubmit={handleAdd}
              className="border-outline-cell flex flex-col gap-3 rounded-lg border p-3"
              noValidate
            >
              {renderForm()}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
                <Button type="submit" loading={pending}>
                  Add
                </Button>
              </div>
            </form>
          ) : (
            <Button type="button" variant="secondary" onClick={() => setShowForm(true)}>
              Add
            </Button>
          )}
        </>
      )}
    </div>
  )
}

export function CandidateExperienceList({
  organizationId,
  candidateId,
  canEdit,
  items,
}: {
  organizationId: string
  candidateId: string
  canEdit: boolean
  items: CandidateExperience[]
}) {
  return (
    <DetailListSection
      organizationId={organizationId}
      candidateId={candidateId}
      canEdit={canEdit}
      addAction={addCandidateExperienceAction}
      deleteAction={deleteCandidateExperienceAction}
      items={items}
      emptyLabel="No employment history recorded yet."
      renderItem={(item) => {
        const exp = item as CandidateExperience
        return (
          <>
            <p className="text-tertiary text-sm font-medium">
              {exp.title} · {exp.company}
            </p>
            <p className="text-muted text-xs">
              {exp.location ?? 'Location unverified'} · {exp.startDate ?? '—'} –{' '}
              {exp.isCurrent ? 'Present' : (exp.endDate ?? '—')}
            </p>
            {exp.description && <p className="text-muted mt-1 text-xs">{exp.description}</p>}
          </>
        )
      }}
      renderForm={() => (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Title" htmlFor="exp-title" required>
              <Input id="exp-title" name="title" required />
            </FormField>
            <FormField label="Company" htmlFor="exp-company" required>
              <Input id="exp-company" name="company" required />
            </FormField>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Start date" htmlFor="exp-start">
              <Input id="exp-start" name="startDate" type="date" />
            </FormField>
            <FormField label="End date" htmlFor="exp-end" hint="Leave blank if current.">
              <Input id="exp-end" name="endDate" type="date" />
            </FormField>
          </div>
          <FormField label="Location" htmlFor="exp-location">
            <Input id="exp-location" name="location" />
          </FormField>
          <FormField label="Description" htmlFor="exp-description">
            <Textarea id="exp-description" name="description" rows={2} />
          </FormField>
        </>
      )}
    />
  )
}

export function CandidateEducationList({
  organizationId,
  candidateId,
  canEdit,
  items,
}: {
  organizationId: string
  candidateId: string
  canEdit: boolean
  items: CandidateEducation[]
}) {
  return (
    <DetailListSection
      organizationId={organizationId}
      candidateId={candidateId}
      canEdit={canEdit}
      addAction={addCandidateEducationAction}
      deleteAction={deleteCandidateEducationAction}
      items={items}
      emptyLabel="No education recorded yet."
      renderItem={(item) => {
        const edu = item as CandidateEducation
        return (
          <>
            <p className="text-tertiary text-sm font-medium">{edu.institution}</p>
            <p className="text-muted text-xs">
              {[edu.degree, edu.fieldOfStudy].filter(Boolean).join(', ') || 'Degree unverified'}
              {edu.endDate ? ` · ${edu.endDate}` : ''}
            </p>
          </>
        )
      }}
      renderForm={() => (
        <>
          <FormField label="Institution" htmlFor="edu-institution" required>
            <Input id="edu-institution" name="institution" required />
          </FormField>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Degree" htmlFor="edu-degree">
              <Input id="edu-degree" name="degree" />
            </FormField>
            <FormField label="Field of study" htmlFor="edu-field">
              <Input id="edu-field" name="fieldOfStudy" />
            </FormField>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Start date" htmlFor="edu-start">
              <Input id="edu-start" name="startDate" type="date" />
            </FormField>
            <FormField label="End date" htmlFor="edu-end">
              <Input id="edu-end" name="endDate" type="date" />
            </FormField>
          </div>
        </>
      )}
    />
  )
}

export function CandidateCertificationList({
  organizationId,
  candidateId,
  canEdit,
  items,
}: {
  organizationId: string
  candidateId: string
  canEdit: boolean
  items: CandidateCertification[]
}) {
  return (
    <DetailListSection
      organizationId={organizationId}
      candidateId={candidateId}
      canEdit={canEdit}
      addAction={addCandidateCertificationAction}
      deleteAction={deleteCandidateCertificationAction}
      items={items}
      emptyLabel="No certifications recorded yet."
      renderItem={(item) => {
        const cert = item as CandidateCertification
        return (
          <>
            <p className="text-tertiary text-sm font-medium">{cert.name}</p>
            <p className="text-muted text-xs">
              {cert.issuingBody ?? 'Issuing body unverified'}
              {cert.expiresDate ? ` · Expires ${cert.expiresDate}` : ''}
            </p>
          </>
        )
      }}
      renderForm={() => (
        <>
          <FormField label="Certification name" htmlFor="cert-name" required>
            <Input id="cert-name" name="name" required />
          </FormField>
          <FormField label="Issuing body" htmlFor="cert-issuer">
            <Input id="cert-issuer" name="issuingBody" />
          </FormField>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Issued date" htmlFor="cert-issued">
              <Input id="cert-issued" name="issuedDate" type="date" />
            </FormField>
            <FormField label="Expires" htmlFor="cert-expires">
              <Input id="cert-expires" name="expiresDate" type="date" />
            </FormField>
          </div>
        </>
      )}
    />
  )
}

const PROFICIENCY_OPTIONS = [
  { value: '', label: 'Not specified' },
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
  { value: 'expert', label: 'Expert' },
]

export function CandidateSkillList({
  organizationId,
  candidateId,
  canEdit,
  items,
}: {
  organizationId: string
  candidateId: string
  canEdit: boolean
  items: CandidateSkill[]
}) {
  return (
    <DetailListSection
      organizationId={organizationId}
      candidateId={candidateId}
      canEdit={canEdit}
      addAction={addCandidateSkillAction}
      deleteAction={deleteCandidateSkillAction}
      items={items}
      emptyLabel="No skills recorded yet."
      renderItem={(item) => {
        const skill = item as CandidateSkill
        return (
          <p className="text-tertiary text-sm">
            {skill.skillName}
            {skill.proficiency ? ` · ${skill.proficiency}` : ''}
            {skill.yearsExperience ? ` · ${skill.yearsExperience} yrs` : ''}
          </p>
        )
      }}
      renderForm={() => (
        <>
          <FormField label="Skill" htmlFor="skill-name" required>
            <Input id="skill-name" name="skillName" required />
          </FormField>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Proficiency" htmlFor="skill-proficiency">
              <Select name="proficiency" defaultValue="" options={PROFICIENCY_OPTIONS} />
            </FormField>
            <FormField label="Years" htmlFor="skill-years">
              <Input id="skill-years" name="yearsExperience" type="number" min={0} />
            </FormField>
          </div>
        </>
      )}
    />
  )
}
