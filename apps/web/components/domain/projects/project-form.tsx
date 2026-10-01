'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button, Checkbox, FormField, Input, Select } from '@rqi/ui'
import { createProjectAction, updateProjectAction } from '@/lib/projects/actions'
import type { Client, RecruitmentProject } from '@rqi/types'

/** Create/edit recruitment-project form — Build Phase 3 brief §"Recruitment projects". Supports "Save draft" (is_draft: true, no status change) alongside a full create/update. */
export function ProjectForm({
  organizationId,
  clients,
  project,
}: {
  organizationId: string
  clients: Client[]
  project?: RecruitmentProject
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [clientId, setClientId] = useState(project?.clientId ?? clients[0]?.id ?? '')
  const [isPoc, setIsPoc] = useState(project?.isPoc ?? false)

  function submit(formData: FormData, saveAsDraft: boolean) {
    formData.set('organizationId', organizationId)
    formData.set('clientId', clientId)
    formData.set('isPoc', String(isPoc))
    formData.set('saveAsDraft', String(saveAsDraft))
    if (project) formData.set('projectId', project.id)

    setMessage(null)
    startTransition(async () => {
      const result = project
        ? await updateProjectAction(formData)
        : await createProjectAction(formData)
      setMessage({
        tone: result.success ? 'success' : 'danger',
        text: result.message ?? (result.success ? 'Saved.' : 'Something went wrong.'),
      })
      if (result.success) router.push('/projects')
    })
  }

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        submit(new FormData(e.currentTarget), false)
      }}
    >
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

      <FormField label="Client" htmlFor="project-client" required>
        {clients.length === 0 ? (
          <p className="text-muted text-sm">
            No clients yet —{' '}
            <Link href="/clients/new" className="text-secondary hover:underline">
              add one first
            </Link>
            .
          </p>
        ) : (
          <Select
            value={clientId}
            onValueChange={setClientId}
            options={clients.map((c) => ({ value: c.id, label: c.name }))}
            placeholder="Select a client"
          />
        )}
      </FormField>

      <FormField label="Role title" htmlFor="project-role-title" required>
        <Input
          id="project-role-title"
          name="roleTitle"
          required
          defaultValue={project?.roleTitle}
          placeholder="e.g. Regional Operations Manager"
        />
      </FormField>

      <FormField label="Vertical" htmlFor="project-vertical">
        <Select
          name="vertical"
          defaultValue={project?.vertical || undefined}
          placeholder="Select a vertical"
          options={[
            { value: 'Retail', label: 'Retail' },
            { value: 'Convenience Store', label: 'Convenience Store' },
            { value: 'Food Service', label: 'Food Service' },
          ]}
        />
      </FormField>

      <div className="grid grid-cols-2 gap-4">
        <FormField
          label="Target shortlist size"
          htmlFor="project-shortlist-size"
          hint="Normally 2–3 candidates"
        >
          <Select
            name="targetShortlistSize"
            defaultValue={String(project?.targetShortlistSize ?? 3)}
            options={[
              { value: '1', label: '1' },
              { value: '2', label: '2' },
              { value: '3', label: '3' },
            ]}
          />
        </FormField>
        <FormField label="Match threshold (%)" htmlFor="project-match-threshold">
          <Input
            id="project-match-threshold"
            name="matchThreshold"
            type="number"
            min={0}
            max={100}
            defaultValue={project?.matchThreshold ?? 70}
          />
        </FormField>
      </div>

      <label className="flex items-center gap-2">
        <Checkbox checked={isPoc} onCheckedChange={(v) => setIsPoc(v === true)} />
        <span className="text-tertiary text-sm">This is a proof-of-concept engagement</span>
      </label>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          loading={pending}
          onClick={(e) => {
            const form = e.currentTarget.closest('form')
            if (form) submit(new FormData(form), true)
          }}
        >
          Save draft
        </Button>
        <Button type="submit" loading={pending} disabled={clients.length === 0}>
          {project ? 'Save changes' : 'Create project'}
        </Button>
      </div>
    </form>
  )
}
