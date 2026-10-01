'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Button, Card, CardBody, FormField, Input } from '@rqi/ui'
import { requestPasswordResetAction } from '@/lib/auth/actions'

export function ForgotPasswordForm() {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    startTransition(async () => {
      const result = await requestPasswordResetAction(formData)
      setMessage(result.message ?? null)
      setSubmitted(true)
    })
  }

  return (
    <Card>
      <CardBody className="flex flex-col gap-5">
        <div>
          <h1 className="text-tertiary text-lg font-semibold">Forgot password</h1>
          <p className="text-muted mt-1 text-sm">
            Enter your email and we&apos;ll send you a link to reset your password.
          </p>
        </div>

        {message && (
          <p
            role="status"
            className="rounded-card bg-primary-container text-primary px-3 py-2 text-sm font-medium"
          >
            {message}
          </p>
        )}

        {!submitted && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
            <FormField label="Email" htmlFor="email" required>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </FormField>
            <Button type="submit" loading={pending} className="w-full">
              Send reset link
            </Button>
          </form>
        )}

        <Link
          href="/sign-in"
          className="text-secondary text-center text-sm font-medium hover:underline"
        >
          Back to sign in
        </Link>
      </CardBody>
    </Card>
  )
}
