'use client'

import { useState, useTransition } from 'react'
import { Button, Card, CardBody, FormField, Input } from '@rqi/ui'
import { acceptInvitationAction } from '@/lib/auth/actions'

export function AcceptInvitationForm({ token }: { token: string }) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage(null)
    const formData = new FormData(event.currentTarget)
    startTransition(async () => {
      const result = await acceptInvitationAction(formData)
      if (result && !result.success) setMessage(result.message ?? 'Something went wrong.')
    })
  }

  return (
    <Card>
      <CardBody className="flex flex-col gap-5">
        <div>
          <h1 className="text-tertiary text-lg font-semibold">Set up your account</h1>
          <p className="text-muted mt-1 text-sm">Create a password to finish joining your team.</p>
        </div>

        {message && (
          <p
            role="alert"
            className="rounded-card bg-danger-bg text-danger px-3 py-2 text-sm font-medium"
          >
            {message}
          </p>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          <input type="hidden" name="token" value={token} />
          <FormField label="Full name" htmlFor="fullName" required>
            <Input id="fullName" name="fullName" type="text" autoComplete="name" required />
          </FormField>
          <FormField label="Password" htmlFor="password" required hint="At least 12 characters.">
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
            />
          </FormField>
          <Button type="submit" loading={pending} className="w-full">
            Create account
          </Button>
        </form>
      </CardBody>
    </Card>
  )
}
