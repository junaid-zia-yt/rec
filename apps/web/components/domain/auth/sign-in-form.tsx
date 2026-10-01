'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Button, Card, CardBody, FormField, Input } from '@rqi/ui'
import { signInAction } from '@/lib/auth/actions'

export function SignInForm({ next }: { next?: string }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const formData = new FormData(event.currentTarget)
    startTransition(async () => {
      const result = await signInAction(formData)
      // signInAction redirects on success (throwing internally), so a
      // returned result here always means it did not succeed.
      if (result && !result.success) {
        setError(result.message ?? 'Something went wrong. Try again.')
      }
    })
  }

  return (
    <Card>
      <CardBody className="flex flex-col gap-5">
        <div>
          <h1 className="text-tertiary text-lg font-semibold">Sign in</h1>
          <p className="text-muted mt-1 text-sm">Sign in to your recruitment workspace.</p>
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-card bg-danger-bg text-danger px-3 py-2 text-sm font-medium"
          >
            {error}
          </p>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          {next && <input type="hidden" name="next" value={next} />}
          <FormField label="Email" htmlFor="email" required>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              aria-invalid={Boolean(error)}
            />
          </FormField>
          <FormField label="Password" htmlFor="password" required>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              aria-invalid={Boolean(error)}
            />
          </FormField>
          <div className="flex justify-end">
            <Link
              href="/forgot-password"
              className="text-secondary text-sm font-medium hover:underline"
            >
              Forgot password?
            </Link>
          </div>
          <Button type="submit" loading={pending} className="w-full">
            Sign in
          </Button>
        </form>
      </CardBody>
    </Card>
  )
}
