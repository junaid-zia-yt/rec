import { describe, expect, it } from 'vitest'
import {
  createFakeSupabase,
  type FakeSupabaseSeed,
} from '@/lib/copilot/orchestration/test-fake-supabase'
import { manuallyRetryJob } from './manual-retry'

/**
 * Build Phase 12, Wave 6 — `manuallyRetryJob` had no dedicated test file
 * before this wave. Covers: the direct role-gate (agency_admin/
 * platform_admin only — every other role denied, including recruiter,
 * client_decision_maker and read_only_reviewer, per the brief's explicit
 * "authorization" requirement), the attempt-count-reset behavior this
 * module's own header note documents as a deliberate judgment call, and the
 * not_found/not_retryable outcomes.
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111'
const ADMIN_USER = '22222222-2222-2222-2222-222222222222'
const RECRUITER_USER = '33333333-3333-3333-3333-333333333333'
const CLIENT_USER = '44444444-4444-4444-4444-444444444444'
const READ_ONLY_USER = '55555555-5555-5555-5555-555555555555'
const PLATFORM_USER = '66666666-6666-6666-6666-666666666666'

function seed(overrides: FakeSupabaseSeed = {}): FakeSupabaseSeed {
  return { background_jobs: [], audit_events: [], organization_memberships: [], ...overrides }
}

function memberships(): Record<string, unknown>[] {
  return [
    { user_id: ADMIN_USER, organization_id: ORG_ID, role: 'agency_admin', status: 'active' },
    { user_id: PLATFORM_USER, organization_id: ORG_ID, role: 'platform_admin', status: 'active' },
    { user_id: RECRUITER_USER, organization_id: ORG_ID, role: 'recruiter', status: 'active' },
    {
      user_id: CLIENT_USER,
      organization_id: ORG_ID,
      role: 'client_decision_maker',
      status: 'active',
    },
    {
      user_id: READ_ONLY_USER,
      organization_id: ORG_ID,
      role: 'read_only_reviewer',
      status: 'active',
    },
  ]
}

function deadLetteredJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    organization_id: ORG_ID,
    status: 'dead_lettered',
    correlation_id: 'corr-1',
    job_type: 'notification_dispatch',
    attempt_count: 5,
    max_attempts: 5,
    next_attempt_at: null,
    ...overrides,
  }
}

describe('manuallyRetryJob — authorization', () => {
  it('allows agency_admin to retry', async () => {
    const tables = seed({
      background_jobs: [deadLetteredJob()],
      organization_memberships: memberships(),
    })
    const supabase = createFakeSupabase(tables)
    const result = await manuallyRetryJob({ jobId: 'job-1', userId: ADMIN_USER, supabase })
    expect(result).toEqual({ status: 'retried', jobId: 'job-1' })
  })

  it('allows platform_admin to retry', async () => {
    const tables = seed({
      background_jobs: [deadLetteredJob()],
      organization_memberships: memberships(),
    })
    const supabase = createFakeSupabase(tables)
    const result = await manuallyRetryJob({ jobId: 'job-1', userId: PLATFORM_USER, supabase })
    expect(result).toEqual({ status: 'retried', jobId: 'job-1' })
  })

  it('denies recruiter', async () => {
    const tables = seed({
      background_jobs: [deadLetteredJob()],
      organization_memberships: memberships(),
    })
    const supabase = createFakeSupabase(tables)
    const result = await manuallyRetryJob({ jobId: 'job-1', userId: RECRUITER_USER, supabase })
    expect(result).toEqual({ status: 'forbidden' })
    // The row must be left completely untouched by a denied attempt.
    expect(tables.background_jobs![0]).toMatchObject({ status: 'dead_lettered', attempt_count: 5 })
  })

  it('denies client_decision_maker', async () => {
    const tables = seed({
      background_jobs: [deadLetteredJob()],
      organization_memberships: memberships(),
    })
    const supabase = createFakeSupabase(tables)
    const result = await manuallyRetryJob({ jobId: 'job-1', userId: CLIENT_USER, supabase })
    expect(result).toEqual({ status: 'forbidden' })
  })

  it('denies read_only_reviewer', async () => {
    const tables = seed({
      background_jobs: [deadLetteredJob()],
      organization_memberships: memberships(),
    })
    const supabase = createFakeSupabase(tables)
    const result = await manuallyRetryJob({ jobId: 'job-1', userId: READ_ONLY_USER, supabase })
    expect(result).toEqual({ status: 'forbidden' })
  })

  it("denies a user with no active membership in the job's organization at all", async () => {
    const tables = seed({
      background_jobs: [deadLetteredJob()],
      organization_memberships: memberships(),
    })
    const supabase = createFakeSupabase(tables)
    const result = await manuallyRetryJob({ jobId: 'job-1', userId: 'stranger-user-id', supabase })
    expect(result).toEqual({ status: 'forbidden' })
  })

  it("denies an agency_admin whose membership in THIS job's org is inactive (status != active), even though the role would otherwise qualify", async () => {
    const tables = seed({
      background_jobs: [deadLetteredJob()],
      organization_memberships: [
        { user_id: ADMIN_USER, organization_id: ORG_ID, role: 'agency_admin', status: 'disabled' },
      ],
    })
    const supabase = createFakeSupabase(tables)
    const result = await manuallyRetryJob({ jobId: 'job-1', userId: ADMIN_USER, supabase })
    expect(result).toEqual({ status: 'forbidden' })
  })

  it('the not_retryable check runs BEFORE the role check would even matter for a wrong-status job, but forbidden still wins for a disallowed role on a retryable job (role gate is not bypassable via job state)', async () => {
    // succeeded is terminal -> not_retryable regardless of caller.
    const tables = seed({
      background_jobs: [deadLetteredJob({ status: 'succeeded' })],
      organization_memberships: memberships(),
    })
    const supabase = createFakeSupabase(tables)
    const result = await manuallyRetryJob({ jobId: 'job-1', userId: RECRUITER_USER, supabase })
    expect(result.status).toBe('not_retryable')
  })
})

describe('manuallyRetryJob — attempt-count reset (documented judgment call)', () => {
  it('resets attempt_count to 0 on a successful manual retry, giving a fresh budget against the SAME max_attempts', async () => {
    const tables = seed({
      background_jobs: [deadLetteredJob({ attempt_count: 5, max_attempts: 5 })],
      organization_memberships: memberships(),
    })
    const supabase = createFakeSupabase(tables)
    await manuallyRetryJob({ jobId: 'job-1', userId: ADMIN_USER, supabase })

    const row = tables.background_jobs![0]!
    expect(row.status).toBe('queued')
    expect(row.attempt_count).toBe(0)
    expect(row.max_attempts).toBe(5) // budget itself is untouched, only the counter
    expect(row.next_attempt_at).toBeNull()
  })

  it('records manually_retried_by/_at on the row and writes a job.manually_retried audit event', async () => {
    const tables = seed({
      background_jobs: [deadLetteredJob()],
      organization_memberships: memberships(),
    })
    const supabase = createFakeSupabase(tables)
    await manuallyRetryJob({ jobId: 'job-1', userId: ADMIN_USER, supabase })

    const row = tables.background_jobs![0]!
    expect(row.manually_retried_by).toBe(ADMIN_USER)
    expect(typeof row.manually_retried_at).toBe('string')

    const auditRow = tables.audit_events!.find((r) => r.action === 'job.manually_retried')
    expect(auditRow).toBeDefined()
    expect(auditRow?.actor_id).toBe(ADMIN_USER)
  })

  it('a job still failed (not yet dead-lettered) can also be manually retried, resetting its attempt_count too', async () => {
    const tables = seed({
      background_jobs: [deadLetteredJob({ status: 'failed', attempt_count: 2, max_attempts: 5 })],
      organization_memberships: memberships(),
    })
    const supabase = createFakeSupabase(tables)
    const result = await manuallyRetryJob({ jobId: 'job-1', userId: ADMIN_USER, supabase })
    expect(result.status).toBe('retried')
    expect(tables.background_jobs![0]!.attempt_count).toBe(0)
  })
})

describe('manuallyRetryJob — not_found / not_retryable', () => {
  it('reports not_found for a job id that does not exist', async () => {
    const tables = seed({ organization_memberships: memberships() })
    const supabase = createFakeSupabase(tables)
    const result = await manuallyRetryJob({
      jobId: 'nonexistent-job',
      userId: ADMIN_USER,
      supabase,
    })
    expect(result).toEqual({ status: 'not_found' })
  })

  it('reports not_retryable for a queued job (nothing to retry yet)', async () => {
    const tables = seed({
      background_jobs: [deadLetteredJob({ status: 'queued' })],
      organization_memberships: memberships(),
    })
    const supabase = createFakeSupabase(tables)
    const result = await manuallyRetryJob({ jobId: 'job-1', userId: ADMIN_USER, supabase })
    expect(result).toEqual({ status: 'not_retryable', currentStatus: 'queued' })
  })

  it('reports not_retryable for a running job (cannot manually retry something in flight)', async () => {
    const tables = seed({
      background_jobs: [deadLetteredJob({ status: 'running' })],
      organization_memberships: memberships(),
    })
    const supabase = createFakeSupabase(tables)
    const result = await manuallyRetryJob({ jobId: 'job-1', userId: ADMIN_USER, supabase })
    expect(result).toEqual({ status: 'not_retryable', currentStatus: 'running' })
  })

  it('reports not_retryable for a cancelled job (terminal, no manual way back)', async () => {
    const tables = seed({
      background_jobs: [deadLetteredJob({ status: 'cancelled' })],
      organization_memberships: memberships(),
    })
    const supabase = createFakeSupabase(tables)
    const result = await manuallyRetryJob({ jobId: 'job-1', userId: ADMIN_USER, supabase })
    expect(result).toEqual({ status: 'not_retryable', currentStatus: 'cancelled' })
  })
})
