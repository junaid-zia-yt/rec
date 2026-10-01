'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, Button, Card, CardBody, MetricCard, StatusBadge } from '@rqi/ui'
import type { BackgroundJobStatus } from '@rqi/types'
import type { JobListRow } from '@/lib/jobs/load'
import type { JobStatusCounts } from '@/lib/jobs/load'
import { manuallyRetryJobAction } from '@/lib/jobs/job-actions'

/**
 * Build Phase 12, Wave 5 (Task D) — admin-only Job status view. Never
 * renders a job's raw `payload` — only type/status/attempt count/failure
 * reason/correlation id, per the brief's constraint (this component's own
 * props, `JobListRow`, structurally cannot carry `payload` at all — see
 * `lib/jobs/load.ts`).
 */

const STATUS_BADGE: Record<BackgroundJobStatus, 'passed' | 'pending' | 'failed' | 'neutral'> = {
  queued: 'neutral',
  running: 'pending',
  succeeded: 'passed',
  failed: 'failed',
  dead_lettered: 'failed',
  cancelled: 'neutral',
}

export function JobStatusPanel({ jobs, counts }: { jobs: JobListRow[]; counts: JobStatusCounts }) {
  const router = useRouter()
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  function retry(jobId: string) {
    const formData = new FormData()
    formData.set('jobId', jobId)
    startTransition(async () => {
      const result = await manuallyRetryJobAction(formData)
      setMessage(
        result.message
          ? { tone: result.success ? 'success' : 'danger', text: result.message }
          : null,
      )
      if (result.success) router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MetricCard label="Queued" value={String(counts.queued)} />
        <MetricCard label="Running" value={String(counts.running)} />
        <MetricCard label="Succeeded" value={String(counts.succeeded)} tone="primary" />
        <MetricCard label="Failed" value={String(counts.failed)} tone="danger" />
        <MetricCard label="Dead-lettered" value={String(counts.deadLettered)} tone="danger" />
        <MetricCard label="Cancelled" value={String(counts.cancelled)} />
      </div>

      {message && (
        <Alert tone={message.tone === 'success' ? 'success' : 'danger'} title={message.text} />
      )}

      {jobs.length === 0 ? (
        <Card>
          <CardBody className="text-muted text-sm">No jobs recorded yet.</CardBody>
        </Card>
      ) : (
        <Card>
          <ul className="divide-outline-cell divide-y">
            {jobs.map((job) => (
              <li
                key={job.id}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-tertiary text-sm font-semibold">{job.jobType}</p>
                    <StatusBadge status={STATUS_BADGE[job.status]}>
                      {job.status.replace(/_/g, ' ')}
                    </StatusBadge>
                  </div>
                  <p className="text-muted text-xs">
                    Attempt {job.attemptCount}/{job.maxAttempts} · Correlation{' '}
                    {job.correlationId.slice(0, 8)} · {new Date(job.createdAt).toLocaleString()}
                  </p>
                  {job.failureSummary && (
                    <p className="text-danger mt-1 text-xs">{job.failureSummary}</p>
                  )}
                  {job.manuallyRetriedAt && (
                    <p className="text-muted text-xs">
                      Manually retried {new Date(job.manuallyRetriedAt).toLocaleString()}
                    </p>
                  )}
                </div>
                {(job.status === 'failed' || job.status === 'dead_lettered') && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => retry(job.id)}
                    disabled={pending}
                  >
                    Retry
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
