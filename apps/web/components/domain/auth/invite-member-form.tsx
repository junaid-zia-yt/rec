'use client'

import { useState, useTransition } from 'react'
import { Button, Card, CardBody, FormField, Input, Select } from '@rqi/ui'
import { createInvitationAction } from '@/lib/auth/actions'

const ROLE_OPTIONS = [
  { value: 'agency_admin', label: 'Agency admin' },
  { value: 'recruiter', label: 'Recruiter' },
  { value: 'client_decision_maker', label: 'Client decision maker' },
  { value: 'read_only_reviewer', label: 'Read-only reviewer' },
] as const

export function InviteMemberForm({ organizationId }: { organizationId: string }) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [role, setRole] = useState<string>('recruiter')

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage(null)
    const formData = new FormData(event.currentTarget)
    formData.set('role', role)
    startTransition(async () => {
      const result = await createInvitationAction(formData)
      setMessage({
        tone: result.success ? 'success' : 'danger',
        text: result.message ?? (result.success ? 'Invitation created.' : 'Something went wrong.'),
      })
    })
  }

  return (
    <Card>
      <CardBody className="flex flex-col gap-4">
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
        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          <input type="hidden" name="organizationId" value={organizationId} />
          <FormField label="Email" htmlFor="invite-email" required>
            <Input id="invite-email" name="email" type="email" required autoComplete="off" />
          </FormField>
          <FormField label="Role" htmlFor="invite-role" required>
            <Select
              name="role"
              options={ROLE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              value={role}
              onValueChange={setRole}
            />
          </FormField>
          <Button type="submit" loading={pending} className="w-full">
            Send invitation
          </Button>
        </form>
      </CardBody>
    </Card>
  )
}
