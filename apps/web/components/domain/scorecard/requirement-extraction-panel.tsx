'use client'

import { useState, useTransition } from 'react'
import { Alert, Button } from '@rqi/ui'
import { runRequirementExtractionAction } from '@/lib/requirements/actions'

/**
 * AI requirement-extraction trigger (Build Phase 4 brief §UI: "AI processing
 * state", "Extraction failure state"). Deliberately a single button with no
 * hidden auto-run — extraction is always a human-initiated action, never
 * something that fires on page load, so a recruiter always knows when an AI
 * call is about to happen.
 */
export function RequirementExtractionPanel({
  organizationId,
  projectId,
  projectClientId,
  jobId,
  jobDescriptionId,
  hasJobDescription,
  aiAvailable,
}: {
  organizationId: string
  projectId: string
  projectClientId: string
  jobId: string
  jobDescriptionId: string | null
  hasJobDescription: boolean
  /** False whenever no ANTHROPIC_API_KEY is configured (lib/env.ts's anthropicConfigured) — this environment always has this false. */
  aiAvailable: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)

  function runExtraction() {
    if (!jobDescriptionId) return
    setResult(null)
    const formData = new FormData()
    formData.set('organizationId', organizationId)
    formData.set('projectId', projectId)
    formData.set('projectClientId', projectClientId)
    formData.set('jobId', jobId)
    formData.set('jobDescriptionId', jobDescriptionId)

    startTransition(async () => {
      const outcome = await runRequirementExtractionAction(formData)
      setResult({
        tone: outcome.success ? 'success' : 'danger',
        text: outcome.message ?? (outcome.success ? 'Extraction complete.' : 'Extraction failed.'),
      })
    })
  }

  if (!hasJobDescription) {
    return (
      <Alert tone="info" title="Add a job description first">
        AI requirement extraction reads the job description saved on this job. Paste or upload one
        before running extraction.
      </Alert>
    )
  }

  if (!aiAvailable) {
    return (
      <Alert tone="warning" title="AI extraction is not available in this environment">
        No Anthropic API key is configured here, so requirements cannot be extracted automatically.
        You can still add, classify, and weight requirements manually below.
      </Alert>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-tertiary text-sm font-semibold">AI requirement extraction</p>
          <p className="text-muted text-sm">
            Reads the job description and proposes requirements for your review. Nothing is added to
            the scorecard until you review, edit, and approve it.
          </p>
        </div>
        <Button type="button" onClick={runExtraction} loading={pending}>
          {pending ? 'Extracting…' : 'Extract requirements'}
        </Button>
      </div>

      {pending && (
        <div role="status" className="rounded-card bg-canvas flex items-center gap-3 px-4 py-3">
          <span
            className="border-secondary h-4 w-4 animate-spin rounded-full border-2 border-t-transparent"
            aria-hidden="true"
          />
          <p className="text-muted text-sm">
            Reading the job description and extracting requirements — this can take a moment.
          </p>
        </div>
      )}

      {!pending && result && (
        <Alert
          tone={result.tone === 'success' ? 'success' : 'danger'}
          title={result.tone === 'success' ? 'Extraction complete' : 'Extraction failed'}
        >
          {result.text}
        </Alert>
      )}
    </div>
  )
}
