'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@rqi/ui'
import { captureError } from '@/lib/monitoring/capture'

/**
 * App Router error boundary (Build Phase 15 Wave 3, "Application errors"
 * surface, docs/monitoring-runbook.md). Catches any rendering/runtime error
 * thrown inside `app/`'s route tree below the root layout — Next.js renders
 * this component in place of the failed segment and gives it the thrown
 * `error`. This file did not exist before this wave; nothing else in this
 * codebase previously reported a client-side render error anywhere.
 *
 * Reports via `captureError` (a no-op when Sentry is not configured — see
 * that file's header note) rather than calling `Sentry.captureException`
 * directly, for the same consistent-tagging/no-sensitive-payload reasons
 * every other wired surface uses it. `error.digest` (Next.js's own opaque
 * server-side error id, never the error's full message/stack) is the only
 * extra field passed — never anything from component props/state that
 * could carry candidate data.
 */
export default function GlobalErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const router = useRouter()

  useEffect(() => {
    captureError(error, {
      category: 'application',
      extra: error.digest ? { digest: error.digest } : undefined,
    })
  }, [error])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-foreground text-xl font-semibold">Something went wrong</h1>
      <p className="text-muted-foreground max-w-md text-sm">
        An unexpected error occurred. The team has been notified. You can try again, or go back to
        the dashboard.
      </p>
      <div className="flex gap-3">
        <Button onClick={reset}>Try again</Button>
        <Button variant="secondary" onClick={() => router.push('/dashboard')}>
          Go to dashboard
        </Button>
      </div>
    </div>
  )
}
