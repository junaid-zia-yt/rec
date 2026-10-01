import { describe, expect, it } from 'vitest'
import {
  createFakeSupabase,
  type FakeSupabaseSeed,
} from '@/lib/copilot/orchestration/test-fake-supabase'
import { notificationDispatchWithEmailHandler } from './notification-dispatch-handler'
import type { JobExecutionContext } from '@/lib/jobs/types'

const ORG = '00000000-0000-0000-0000-00000000000a'
const RECIPIENT = '00000000-0000-0000-0000-000000000001'

function makeContext(supabase: ReturnType<typeof createFakeSupabase>): JobExecutionContext {
  return {
    organizationId: ORG,
    correlationId: 'corr-1',
    jobId: 'job-1',
    attemptCount: 1,
    signal: new AbortController().signal,
    supabase,
  }
}

function seed(overrides: FakeSupabaseSeed = {}): FakeSupabaseSeed {
  return {
    notifications: [],
    notification_preferences: [],
    background_jobs: [],
    audit_events: [],
    ...overrides,
  }
}

describe('notificationDispatchWithEmailHandler', () => {
  it('writes the in-app row (Wave 2 behavior, unchanged) and does NOT enqueue an email_delivery job when email_enabled is off (the 0032 default)', async () => {
    const tables = seed()
    const supabase = createFakeSupabase(tables)

    const result = await notificationDispatchWithEmailHandler(
      {
        recipientUserId: RECIPIENT,
        eventType: 'candidate_awaiting_review',
        title: 'Review needed',
      },
      makeContext(supabase),
    )

    expect(result.dispatched).toBe(true)
    expect(result.emailEnqueued).toBe(false)
    expect(tables.notifications).toHaveLength(1)
    expect(tables.background_jobs).toHaveLength(0)
  })

  it('enqueues a follow-on email_delivery job when the recipient has email_enabled=true for this event type', async () => {
    const tables = seed({
      notification_preferences: [
        {
          user_id: RECIPIENT,
          event_type: 'candidate_awaiting_review',
          in_app_enabled: true,
          email_enabled: true,
        },
      ],
    })
    const supabase = createFakeSupabase(tables)

    const result = await notificationDispatchWithEmailHandler(
      {
        recipientUserId: RECIPIENT,
        eventType: 'candidate_awaiting_review',
        title: 'Review needed',
      },
      makeContext(supabase),
    )

    expect(result.dispatched).toBe(true)
    expect(result.emailEnqueued).toBe(true)
    expect(tables.background_jobs).toHaveLength(1)
    const emailJob = tables.background_jobs![0]!
    expect(emailJob.job_type).toBe('email_delivery')
    expect((emailJob.payload as Record<string, unknown>).notificationId).toBe(result.notificationId)
    expect((emailJob.payload as Record<string, unknown>).recipientUserId).toBe(RECIPIENT)
  })

  it('never enqueues an email_delivery job when no notification row was written (in_app_enabled off)', async () => {
    const tables = seed({
      notification_preferences: [
        {
          user_id: RECIPIENT,
          event_type: 'candidate_awaiting_review',
          in_app_enabled: false,
          email_enabled: true,
        },
      ],
    })
    const supabase = createFakeSupabase(tables)

    const result = await notificationDispatchWithEmailHandler(
      {
        recipientUserId: RECIPIENT,
        eventType: 'candidate_awaiting_review',
        title: 'Review needed',
      },
      makeContext(supabase),
    )

    expect(result.dispatched).toBe(false)
    expect(result.notificationId).toBeNull()
    expect(result.emailEnqueued).toBe(false)
    expect(tables.background_jobs).toHaveLength(0)
  })

  it('the email_delivery enqueue for one notification is idempotent: calling enqueueJob a second time with the SAME notificationId-derived key returns the existing job, never a duplicate', async () => {
    // Exercises the exact idempotencyKey this handler builds
    // (`notification-email:<notificationId>:1`) directly against
    // enqueueJob, mirroring how a retried execution against an
    // ALREADY-CREATED notification row would behave — the handler-level
    // integration above already covers the normal single-call path.
    const { enqueueJob } = await import('@/lib/jobs/enqueue')
    const tables = seed()
    const supabase = createFakeSupabase(tables)
    const notificationId = '00000000-0000-0000-0000-0000000000f1'

    const payload = {
      notificationId,
      recipientUserId: RECIPIENT,
      eventType: 'candidate_awaiting_review' as const,
      attemptNumber: 1,
    }
    const first = await enqueueJob({
      organizationId: ORG,
      jobType: 'email_delivery',
      payload,
      idempotencyKey: `notification-email:${notificationId}:1`,
      supabase,
      userId: RECIPIENT,
    })
    const second = await enqueueJob({
      organizationId: ORG,
      jobType: 'email_delivery',
      payload,
      idempotencyKey: `notification-email:${notificationId}:1`,
      supabase,
      userId: RECIPIENT,
    })

    expect(second.wasExisting).toBe(true)
    expect(second.job.id).toBe(first.job.id)
    expect(tables.background_jobs).toHaveLength(1)
  })
})
