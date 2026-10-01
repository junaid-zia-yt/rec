'use client'

import { ErrorState } from '@rqi/ui'

export default function DashboardError({ reset }: { error: Error; reset: () => void }) {
  return (
    <ErrorState
      title="Dashboard failed to load"
      description="Something went wrong loading your workspace summary."
      onRetry={reset}
    />
  )
}
