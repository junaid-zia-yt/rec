'use client'

import { useEffect } from 'react'
import { captureError } from '@/lib/monitoring/capture'

/**
 * Root-layout error boundary (Build Phase 15 Wave 3, "Application errors"
 * surface). Next.js only renders this when the error occurs in the ROOT
 * layout itself (`app/layout.tsx`) — `app/error.tsx` catches everything
 * below it. Per Next.js's own contract, this file must render its own
 * `<html>`/`<body>` (the root layout that would normally provide them is
 * itself what failed), so it cannot reuse the app shell/fonts/banner.
 *
 * Deliberately minimal — no design-system components here, since a failure
 * this high in the tree should not assume anything else in the app is still
 * working.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    captureError(error, {
      category: 'application',
      extra: error.digest ? { digest: error.digest, boundary: 'root' } : { boundary: 'root' },
    })
  }, [error])

  return (
    <html lang="en">
      <body>
        <div
          style={{
            display: 'flex',
            minHeight: '100vh',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '1rem',
            padding: '1.5rem',
            textAlign: 'center',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ maxWidth: '28rem', fontSize: '0.875rem', color: '#6b7280' }}>
            An unexpected error occurred while loading the application. The team has been notified.
          </p>
          <button
            onClick={reset}
            style={{
              borderRadius: '0.375rem',
              padding: '0.5rem 1rem',
              fontSize: '0.875rem',
              backgroundColor: '#111827',
              color: 'white',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
