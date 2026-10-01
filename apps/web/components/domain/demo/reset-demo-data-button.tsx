'use client'

import { useState, useTransition } from 'react'
import { Button } from '@rqi/ui'
import { resetDemoDataAction } from '@/lib/demo/demo-actions'

/**
 * Build Phase 18 brief step 9 / negative test "demo reset restores the
 * original scenario". Renders only where a page chooses to include it
 * (project detail, shortlists hub) — always in demo mode only, since the
 * action itself is guarded by demoGuard() server-side regardless.
 */
export function ResetDemoDataButton() {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  function handleReset() {
    if (
      !window.confirm(
        'Reset the private demo? This discards every change made in this session (candidates added, evaluations run, shortlists built, outreach drafted) and restores the original two-project scenario.',
      )
    ) {
      return
    }
    setMessage(null)
    startTransition(async () => {
      const result = await resetDemoDataAction()
      setMessage(result.message ?? null)
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="secondary" size="sm" onClick={handleReset} loading={pending}>
        Reset demo data
      </Button>
      {message && (
        <p role="status" className="text-muted text-xs">
          {message}
        </p>
      )}
    </div>
  )
}
