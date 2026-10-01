import { describe, expect, it } from 'vitest'
import {
  createFakeSupabase,
  type FakeSupabaseSeed,
} from '@/lib/copilot/orchestration/test-fake-supabase'
import { enqueueJob } from './enqueue'

const ORG_ID = '11111111-1111-1111-1111-111111111111'
const USER_ID = '22222222-2222-2222-2222-222222222222'
const RECIPIENT_ID = '33333333-3333-3333-3333-333333333333'

function notificationPayload(overrides: Record<string, unknown> = {}) {
  return {
    recipientUserId: RECIPIENT_ID,
    eventType: 'candidate_awaiting_review',
    title: 'A candidate needs your review',
    ...overrides,
  }
}

function seed(): FakeSupabaseSeed {
  return { background_jobs: [], audit_events: [] }
}

describe('enqueueJob', () => {
  it('inserts a queued background_jobs row with a validated payload', async () => {
    const tables = seed()
    const supabase = createFakeSupabase(tables)

    const { job, wasExisting } = await enqueueJob({
      organizationId: ORG_ID,
      jobType: 'notification_dispatch',
      payload: notificationPayload(),
      idempotencyKey: 'notif-1',
      supabase,
      userId: USER_ID,
    })

    expect(wasExisting).toBe(false)
    expect(job.status).toBe('queued')
    expect(job.organizationId).toBe(ORG_ID)
    expect(job.jobType).toBe('notification_dispatch')
    expect(job.attemptCount).toBe(0)
    expect(job.maxAttempts).toBe(5)
    expect(tables.background_jobs).toHaveLength(1)
  })

  it('generates a correlationId when none is supplied, and reuses it for the job.enqueued audit row via entity_id (not the job id)', async () => {
    const tables = seed()
    const supabase = createFakeSupabase(tables)

    const { job } = await enqueueJob({
      organizationId: ORG_ID,
      jobType: 'notification_dispatch',
      payload: notificationPayload(),
      idempotencyKey: 'notif-2',
      supabase,
      userId: USER_ID,
    })

    expect(typeof job.correlationId).toBe('string')
    expect(job.correlationId.length).toBeGreaterThan(0)

    const auditRow = tables.audit_events?.find((row) => row.action === 'job.enqueued')
    expect(auditRow).toBeDefined()
    expect(auditRow?.entity_id).toBe(job.correlationId)
    expect(auditRow?.entity_id).not.toBe(job.id)
    expect((auditRow?.metadata as Record<string, unknown> | undefined)?.jobId).toBe(job.id)
  })

  it('is idempotent: a second enqueue with the same (organizationId, jobType, idempotencyKey) returns the existing job, never inserting a second row or a second audit event', async () => {
    const tables = seed()
    const supabase = createFakeSupabase(tables)

    const first = await enqueueJob({
      organizationId: ORG_ID,
      jobType: 'notification_dispatch',
      payload: notificationPayload(),
      idempotencyKey: 'notif-dup',
      supabase,
      userId: USER_ID,
    })
    const second = await enqueueJob({
      organizationId: ORG_ID,
      jobType: 'notification_dispatch',
      payload: notificationPayload({ title: 'A different title — should be ignored' }),
      idempotencyKey: 'notif-dup',
      supabase,
      userId: USER_ID,
    })

    expect(second.wasExisting).toBe(true)
    expect(second.job.id).toBe(first.job.id)
    expect(second.job.payload.title).toBe('A candidate needs your review') // the FIRST enqueue's payload wins
    expect(tables.background_jobs).toHaveLength(1)
    expect(tables.audit_events?.filter((row) => row.action === 'job.enqueued')).toHaveLength(1)
  })

  it('a duplicate idempotencyKey under a DIFFERENT jobType is NOT treated as a duplicate (the unique constraint is per (organizationId, jobType, idempotencyKey))', async () => {
    const tables = seed()
    const supabase = createFakeSupabase(tables)

    await enqueueJob({
      organizationId: ORG_ID,
      jobType: 'notification_dispatch',
      payload: notificationPayload(),
      idempotencyKey: 'shared-key',
      supabase,
      userId: USER_ID,
    })
    const second = await enqueueJob({
      organizationId: ORG_ID,
      jobType: 'email_delivery',
      payload: { outreachMessageId: RECIPIENT_ID, attemptNumber: 1 },
      idempotencyKey: 'shared-key',
      supabase,
      userId: USER_ID,
    })

    expect(second.wasExisting).toBe(false)
    expect(tables.background_jobs).toHaveLength(2)
  })

  it('a duplicate idempotencyKey under a DIFFERENT organizationId is NOT treated as a duplicate', async () => {
    const tables = seed()
    const supabase = createFakeSupabase(tables)
    const otherOrgId = '44444444-4444-4444-4444-444444444444'

    await enqueueJob({
      organizationId: ORG_ID,
      jobType: 'notification_dispatch',
      payload: notificationPayload(),
      idempotencyKey: 'shared-key',
      supabase,
      userId: USER_ID,
    })
    const second = await enqueueJob({
      organizationId: otherOrgId,
      jobType: 'notification_dispatch',
      payload: notificationPayload(),
      idempotencyKey: 'shared-key',
      supabase,
      userId: USER_ID,
    })

    expect(second.wasExisting).toBe(false)
    expect(tables.background_jobs).toHaveLength(2)
  })

  it('with no idempotencyKey supplied, every enqueue inserts a new row (no dedup is attempted)', async () => {
    const tables = seed()
    const supabase = createFakeSupabase(tables)

    await enqueueJob({
      organizationId: ORG_ID,
      jobType: 'notification_dispatch',
      payload: notificationPayload(),
      supabase,
      userId: USER_ID,
    })
    await enqueueJob({
      organizationId: ORG_ID,
      jobType: 'notification_dispatch',
      payload: notificationPayload(),
      supabase,
      userId: USER_ID,
    })

    expect(tables.background_jobs).toHaveLength(2)
  })

  it('rejects an invalid payload before writing anything (no insert, no audit row)', async () => {
    const tables = seed()
    const supabase = createFakeSupabase(tables)

    await expect(
      enqueueJob({
        organizationId: ORG_ID,
        jobType: 'notification_dispatch',
        payload: {
          recipientUserId: 'not-a-uuid',
          eventType: 'candidate_awaiting_review',
          title: 'x',
        },
        supabase,
        userId: USER_ID,
      }),
    ).rejects.toThrow()

    expect(tables.background_jobs).toHaveLength(0)
    expect(tables.audit_events).toHaveLength(0)
  })

  it('rejects an unknown extra field on the payload (schemas are .strict())', async () => {
    const tables = seed()
    const supabase = createFakeSupabase(tables)

    await expect(
      enqueueJob({
        organizationId: ORG_ID,
        jobType: 'notification_dispatch',
        payload: { ...notificationPayload(), unexpectedField: 'nope' },
        supabase,
        userId: USER_ID,
      }),
    ).rejects.toThrow()
  })

  it('respects an explicitly supplied maxAttempts and correlationId rather than the defaults', async () => {
    const tables = seed()
    const supabase = createFakeSupabase(tables)
    const correlationId = '55555555-5555-5555-5555-555555555555'

    const { job } = await enqueueJob({
      organizationId: ORG_ID,
      jobType: 'notification_dispatch',
      payload: notificationPayload(),
      maxAttempts: 2,
      correlationId,
      supabase,
      userId: USER_ID,
    })

    expect(job.maxAttempts).toBe(2)
    expect(job.correlationId).toBe(correlationId)
  })
})
