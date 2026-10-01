'use client'

import { useState, useTransition } from 'react'
import { Button, Card, CardBody, FormField, Input } from '@rqi/ui'
import { updatePasswordAction } from '@/lib/auth/actions'

export function ResetPasswordForm() {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage(null)
    setFieldErrors({})
    const formData = new FormData(event.currentTarget)
    startTransition(async () => {
      const result = await updatePasswordAction(formData)
      // On success, updatePasswordAction redirects internally.
      if (result && !result.success) {
        setMessage(result.message ?? null)
        setFieldErrors(result.fieldErrors ?? {})
      }
    })
  }

  return (
    <Card>
      <CardBody className="flex flex-col gap-5">
        <div>
          <h1 className="text-tertiary text-lg font-semibold">Set a new password</h1>
          <p className="text-muted mt-1 text-sm">Choose a new password for your account.</p>
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
          <FormField
            label="New password"
            htmlFor="password"
            required
            hint="At least 12 characters."
            error={fieldErrors.password}
          >
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
            />
          </FormField>
          <FormField
            label="Confirm new password"
            htmlFor="confirmPassword"
            required
            error={fieldErrors.confirmPassword}
          >
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
            />
          </FormField>
          <Button type="submit" loading={pending} className="w-full">
            Update password
          </Button>
        </form>
      </CardBody>
    </Card>
  )
}
