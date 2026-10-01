'use client'

import { useState, useTransition } from 'react'
import { Button, FormField, Input, Select, Textarea } from '@rqi/ui'
import type { CandidateProfile, CandidateRecord } from '@rqi/types'
import { updateCandidateAction } from '@/lib/candidates/actions'

const WORKPLACE_OPTIONS = [
  { value: '', label: 'Not specified' },
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'onsite', label: 'On-site' },
  { value: 'flexible', label: 'Flexible' },
]

const COMPENSATION_PERIOD_OPTIONS = [
  { value: '', label: 'Not specified' },
  { value: 'annual', label: 'Annual' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'monthly', label: 'Monthly' },
]

/**
 * Candidate profile editor — Build Phase 5 brief §"Candidate profile": every
 * field listed there in one form. Recruiter notes and client-visible notes
 * are two distinct fields (never the same textarea), matching the
 * candidate_profiles.recruiter_notes / client_visible_notes column split —
 * §PRIVACY: "Separate recruiter notes from client-visible notes."
 */
export function CandidateProfileEditor({
  organizationId,
  candidate,
  profile,
  canEditRecruiterNotes,
}: {
  organizationId: string
  candidate: CandidateRecord
  profile: CandidateProfile
  canEditRecruiterNotes: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage(null)
    const formData = new FormData(event.currentTarget)
    formData.set('organizationId', organizationId)
    formData.set('candidateId', candidate.id)

    startTransition(async () => {
      const result = await updateCandidateAction(formData)
      setMessage({
        tone: result.success ? 'success' : 'danger',
        text: result.message ?? 'Something went wrong.',
      })
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

      <FormField label="Full name" htmlFor="pe-full-name" required>
        <Input
          id="pe-full-name"
          name="fullName"
          defaultValue={candidate.fullName}
          required
          maxLength={200}
        />
      </FormField>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Email" htmlFor="pe-email">
          <Input
            id="pe-email"
            name="primaryEmail"
            type="email"
            defaultValue={candidate.primaryEmail ?? ''}
          />
        </FormField>
        <FormField label="Phone" htmlFor="pe-phone">
          <Input
            id="pe-phone"
            name="primaryPhone"
            type="tel"
            defaultValue={candidate.primaryPhone ?? ''}
          />
        </FormField>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Current title" htmlFor="pe-title">
          <Input id="pe-title" name="currentTitle" defaultValue={profile.currentTitle ?? ''} />
        </FormField>
        <FormField label="Current company" htmlFor="pe-company">
          <Input
            id="pe-company"
            name="currentCompany"
            defaultValue={profile.currentCompany ?? ''}
          />
        </FormField>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Location" htmlFor="pe-location">
          <Input id="pe-location" name="location" defaultValue={profile.location ?? ''} />
        </FormField>
        <FormField
          label="Work authorization"
          htmlFor="pe-work-auth"
          hint="Left unverified unless confirmed."
        >
          <Input
            id="pe-work-auth"
            name="workAuthorization"
            defaultValue={profile.workAuthorization ?? ''}
          />
        </FormField>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FormField label="Compensation min" htmlFor="pe-comp-min">
          <Input
            id="pe-comp-min"
            name="compensationMin"
            type="number"
            min={0}
            defaultValue={profile.compensationMin ?? ''}
          />
        </FormField>
        <FormField label="Compensation max" htmlFor="pe-comp-max">
          <Input
            id="pe-comp-max"
            name="compensationMax"
            type="number"
            min={0}
            defaultValue={profile.compensationMax ?? ''}
          />
        </FormField>
        <FormField label="Period" htmlFor="pe-comp-period">
          <Select
            name="compensationPeriod"
            defaultValue={profile.compensationPeriod ?? ''}
            options={COMPENSATION_PERIOD_OPTIONS}
          />
        </FormField>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FormField label="Currency" htmlFor="pe-currency">
          <Input
            id="pe-currency"
            name="compensationCurrency"
            maxLength={3}
            defaultValue={profile.compensationCurrency || 'USD'}
          />
        </FormField>
        <FormField label="Availability date" htmlFor="pe-availability">
          <Input
            id="pe-availability"
            name="availabilityDate"
            type="date"
            defaultValue={profile.availabilityDate ?? ''}
          />
        </FormField>
        <FormField label="Notice period (days)" htmlFor="pe-notice">
          <Input
            id="pe-notice"
            name="noticePeriodDays"
            type="number"
            min={0}
            defaultValue={profile.noticePeriodDays ?? ''}
          />
        </FormField>
      </div>

      <FormField label="Workplace preference" htmlFor="pe-workplace">
        <Select
          name="workplacePreference"
          defaultValue={profile.workplacePreference ?? ''}
          options={WORKPLACE_OPTIONS}
        />
      </FormField>

      <FormField
        label="Client-visible notes"
        htmlFor="pe-client-notes"
        hint="Visible to client reviewers once this candidate is shared."
      >
        <Textarea
          id="pe-client-notes"
          name="clientVisibleNotes"
          rows={2}
          defaultValue={profile.clientVisibleNotes ?? ''}
        />
      </FormField>

      {canEditRecruiterNotes && (
        <FormField
          label="Recruiter notes"
          htmlFor="pe-recruiter-notes"
          hint="Internal only — never shown to a client reviewer."
        >
          <Textarea
            id="pe-recruiter-notes"
            name="recruiterNotes"
            rows={2}
            defaultValue={profile.recruiterNotes ?? ''}
          />
        </FormField>
      )}

      <div className="flex justify-end">
        <Button type="submit" loading={pending}>
          Save changes
        </Button>
      </div>
    </form>
  )
}
