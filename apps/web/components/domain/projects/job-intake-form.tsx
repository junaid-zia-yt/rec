'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Checkbox, FormField, Input, Select, Textarea } from '@rqi/ui'
import { createJobAction, updateJobAction } from '@/lib/jobs/actions'
import type { Job } from '@rqi/types'

/** Job intake wizard — Build Phase 3 brief §"Job intake". A single-page form (not a multi-step click-through) covering every listed field; "wizard" here means the guided, all-fields-in-one-place intake screen for a role within a project. */
export function JobIntakeForm({
  organizationId,
  projectId,
  projectClientId,
  job,
}: {
  organizationId: string
  projectId: string
  projectClientId: string
  job?: Job
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [sponsorship, setSponsorship] = useState(job?.sponsorshipAvailable ?? false)

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage(null)
    const formData = new FormData(event.currentTarget)
    formData.set('organizationId', organizationId)
    formData.set('projectId', projectId)
    formData.set('projectClientId', projectClientId)
    formData.set('sponsorshipAvailable', String(sponsorship))
    if (job) formData.set('jobId', job.id)

    startTransition(async () => {
      const result = job ? await updateJobAction(formData) : await createJobAction(formData)
      setMessage({
        tone: result.success ? 'success' : 'danger',
        text: result.message ?? (result.success ? 'Saved.' : 'Something went wrong.'),
      })
      if (result.success) router.push(`/projects/${projectId}`)
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

      <FormField label="Role title" htmlFor="job-title" required>
        <Input id="job-title" name="title" required defaultValue={job?.title} />
      </FormField>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Department" htmlFor="job-department">
          <Input id="job-department" name="department" defaultValue={job?.department ?? ''} />
        </FormField>
        <FormField label="Industry" htmlFor="job-industry">
          <Input id="job-industry" name="industry" defaultValue={job?.industry ?? ''} />
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Employment type" htmlFor="job-employment-type" required>
          <Select
            name="employmentType"
            defaultValue={job?.employmentType ?? 'full_time'}
            options={[
              { value: 'full_time', label: 'Full-time' },
              { value: 'part_time', label: 'Part-time' },
              { value: 'contract', label: 'Contract' },
              { value: 'temporary', label: 'Temporary' },
              { value: 'seasonal', label: 'Seasonal' },
            ]}
          />
        </FormField>
        <FormField label="Workplace arrangement" htmlFor="job-workplace" required>
          <Select
            name="workplaceArrangement"
            defaultValue={job?.workplaceArrangement ?? 'on_site'}
            options={[
              { value: 'on_site', label: 'On-site' },
              { value: 'hybrid', label: 'Hybrid' },
              { value: 'remote', label: 'Remote' },
            ]}
          />
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Location" htmlFor="job-location">
          <Input
            id="job-location"
            name="location"
            defaultValue={job?.location ?? ''}
            placeholder="City, State"
          />
        </FormField>
        <FormField label="Commuting radius (miles)" htmlFor="job-commuting-radius">
          <Input
            id="job-commuting-radius"
            name="commutingRadiusMiles"
            type="number"
            min={0}
            defaultValue={job?.commutingRadiusMiles ?? undefined}
          />
        </FormField>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <FormField label="Salary minimum" htmlFor="job-salary-min">
          <Input
            id="job-salary-min"
            name="salaryMin"
            type="number"
            min={0}
            defaultValue={job?.salaryMin ?? undefined}
          />
        </FormField>
        <FormField label="Salary maximum" htmlFor="job-salary-max">
          <Input
            id="job-salary-max"
            name="salaryMax"
            type="number"
            min={0}
            defaultValue={job?.salaryMax ?? undefined}
          />
        </FormField>
        <FormField label="Currency" htmlFor="job-currency">
          <Input
            id="job-currency"
            name="currency"
            maxLength={3}
            defaultValue={job?.currency ?? 'USD'}
          />
        </FormField>
      </div>

      <FormField label="Work authorization required" htmlFor="job-work-auth">
        <Input
          id="job-work-auth"
          name="workAuthorizationRequired"
          defaultValue={job?.workAuthorizationRequired ?? ''}
          placeholder="e.g. US work authorization required"
        />
      </FormField>

      <label className="flex items-center gap-2">
        <Checkbox checked={sponsorship} onCheckedChange={(v) => setSponsorship(v === true)} />
        <span className="text-tertiary text-sm">Visa sponsorship available</span>
      </label>

      <FormField label="Target start date" htmlFor="job-start-date">
        <Input
          id="job-start-date"
          name="targetStartDate"
          type="date"
          defaultValue={job?.targetStartDate ?? ''}
        />
      </FormField>

      <FormField
        label="Hiring-manager notes"
        htmlFor="job-notes"
        hint="Internal context for the recruiting team."
      >
        <Textarea
          id="job-notes"
          name="hiringManagerNotes"
          rows={4}
          defaultValue={job?.hiringManagerNotes ?? ''}
        />
      </FormField>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Maximum shortlist size" htmlFor="job-max-shortlist">
          <Select
            name="maxShortlistSize"
            defaultValue={String(job?.maxShortlistSize ?? 3)}
            options={[
              { value: '1', label: '1' },
              { value: '2', label: '2' },
              { value: '3', label: '3' },
            ]}
          />
        </FormField>
        <FormField label="Minimum match threshold (%)" htmlFor="job-min-threshold">
          <Input
            id="job-min-threshold"
            name="minMatchThreshold"
            type="number"
            min={0}
            max={100}
            defaultValue={job?.minMatchThreshold ?? 70}
          />
        </FormField>
      </div>

      <div className="flex justify-end">
        <Button type="submit" loading={pending}>
          {job ? 'Save job' : 'Create job'}
        </Button>
      </div>
    </form>
  )
}
