'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button, FormField, Input, Select, Textarea } from '@rqi/ui'
import { createCandidateAction } from '@/lib/candidates/actions'

const WORKPLACE_OPTIONS = [
  { value: '', label: 'Not specified' },
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'onsite', label: 'On-site' },
  { value: 'flexible', label: 'Flexible' },
]

const SOURCE_OPTIONS = [
  { value: 'manual', label: 'Manual entry' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'referral', label: 'Referral' },
  { value: 'apollo', label: 'Apollo' },
  { value: 'job_board', label: 'Job board' },
  { value: 'other', label: 'Other' },
]

/** Manual candidate creation — Build Phase 5 brief §"Candidate creation": "Manual entry", "Project assignment", "Source tracking". Only full name is required; every other field is honestly left unset rather than guessed. */
export function CandidateCreateForm({
  organizationId,
  projects,
  requireProject = false,
}: {
  organizationId: string
  projects: { id: string; name: string; clientId: string }[]
  /**
   * Build Phase 18: the private demo's in-memory engine models every
   * candidate as belonging to exactly one project (lib/demo/engine.ts's
   * `DemoCandidateState.projectId` is non-nullable) — unlike the live
   * Supabase schema, it has no concept of an unassigned candidate pool.
   * Rather than silently failing after submit with "Choose a project to
   * add this candidate to.", the form is honest about the requirement up
   * front when running against the demo engine: a project is pre-selected
   * and the field is marked required instead of "(optional)".
   */
  requireProject?: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [projectId, setProjectId] = useState(requireProject ? (projects[0]?.id ?? '') : '')

  const selectedProject = projects.find((p) => p.id === projectId)

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage(null)
    const formData = new FormData(event.currentTarget)
    formData.set('organizationId', organizationId)
    if (selectedProject) {
      formData.set('projectId', selectedProject.id)
      formData.set('projectClientId', selectedProject.clientId)
    }

    startTransition(async () => {
      const result = await createCandidateAction(formData)
      setMessage({
        tone: result.success ? 'success' : 'danger',
        text: result.message ?? 'Something went wrong.',
      })
      if (result.success) router.push('/candidates')
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
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

      <FormField label="Full name" htmlFor="c-full-name" required>
        <Input id="c-full-name" name="fullName" required maxLength={200} />
      </FormField>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Email" htmlFor="c-email" hint="Left unverified until confirmed.">
          <Input id="c-email" name="primaryEmail" type="email" />
        </FormField>
        <FormField label="Phone" htmlFor="c-phone">
          <Input id="c-phone" name="primaryPhone" type="tel" />
        </FormField>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Current title" htmlFor="c-title">
          <Input id="c-title" name="currentTitle" />
        </FormField>
        <FormField label="Current company" htmlFor="c-company">
          <Input id="c-company" name="currentCompany" />
        </FormField>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Location" htmlFor="c-location">
          <Input id="c-location" name="location" />
        </FormField>
        <FormField label="Workplace preference" htmlFor="c-workplace">
          <Select name="workplacePreference" defaultValue="" options={WORKPLACE_OPTIONS} />
        </FormField>
      </div>

      <FormField
        label="Recruiter notes"
        htmlFor="c-recruiter-notes"
        hint="Internal only — never shown to a client reviewer."
      >
        <Textarea id="c-recruiter-notes" name="recruiterNotes" rows={2} />
      </FormField>

      <div className="border-outline-cell flex flex-col gap-3 rounded-lg border p-3">
        <FormField
          label={requireProject ? 'Assign to a project' : 'Assign to a project now (optional)'}
          htmlFor="c-project"
          required={requireProject}
          hint={
            requireProject
              ? 'This demo workspace tracks candidates within a project.'
              : undefined
          }
        >
          <Select
            value={projectId}
            onValueChange={setProjectId}
            options={
              requireProject
                ? projects.map((p) => ({ value: p.id, label: p.name }))
                : [
                    { value: '', label: 'Not assigned yet' },
                    ...projects.map((p) => ({ value: p.id, label: p.name })),
                  ]
            }
          />
        </FormField>
        {projectId && (
          <FormField label="How was this candidate sourced?" htmlFor="c-source">
            <Select name="sourceChannel" defaultValue="manual" options={SOURCE_OPTIONS} />
          </FormField>
        )}
      </div>

      <div className="flex justify-end">
        <Button type="submit" loading={pending}>
          Create candidate
        </Button>
      </div>
    </form>
  )
}
