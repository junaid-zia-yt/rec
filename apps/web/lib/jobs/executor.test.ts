import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createFakeSupabase,
  type FakeSupabaseSeed,
} from '@/lib/copilot/orchestration/test-fake-supabase'
import { executeJob, DEFAULT_JOB_TIMEOUT_MS } from './executor'
import type { JobHandlerRegistry } from './types'

const { captureMonitoringMessageMock } = vi.hoisted(() => ({
  captureMonitoringMessageMock: vi.fn(),
}))
vi.mock('@/lib/monitoring/capture', () => ({
  captureMonitoringMessage: captureMonitoringMessageMock,
}))

/**
 * `createFakeSupabase` (Build Phase 11) only fakes `.from(...)` — `executor.ts`
 * also calls `supabase.auth.getUser()` (to attribute audit events to an
 * actor). Rather than widen the shared fake for every other test file's
 * sake, this local wrapper adds a minimal `.auth.getUser()` on top of it —
 * scoped to this file only, per the same "small, purpose-built fake" the
 * webhook tests already established as this repo's convention for a needed
 * capability the shared fake doesn't have.
 */
function withAuth(supabase: SupabaseClient, userId: string | null): SupabaseClient {
  return {
    ...supabase,
    from: supabase.from.bind(supabase),
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) },
  } as unknown as SupabaseClient
}

/**
 * Build Phase 12, Wave 6 — adversarial coverage for `executeJob`'s retry vs.
 * dead-letter decision, its optimistic claim under simulated concurrency,
 * its wall-clock timeout, and its "no handler registered" path. None of
 * this had a dedicated test file before this wave — `enqueue.test.ts` and
 * `backoff.test.ts` cover their own modules, but the engine's actual
 * claim/execute/retry core (`executor.ts`) was previously exercised only
 * indirectly, if at all.
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111'

function seed(overrides: FakeSupabaseSeed = {}): FakeSupabaseSeed {
  return { background_jobs: [], audit_events: [], ...overrides }
}

function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    organization_id: ORG_ID,
    job_type: 'notification_dispatch',
    payload: {},
    correlation_id: 'corr-1',
    attempt_count: 0,
    max_attempts: 3,
    status: 'queued',
    ...overrides,
  }
}

describe('executeJob — retry vs. dead-letter boundary (off-by-one)', () => {
  it('a failure that leaves attempt_count BELOW max_attempts retries (requeues), never dead-letters', async () => {
    // max_attempts = 3, starting attempt_count = 1 -> after this failure,
    // newAttemptCount = 2, which is < 3: must retry, not dead-letter.
    const tables = seed({ background_jobs: [jobRow({ attempt_count: 1, max_attempts: 3 })] })
    const supabase = withAuth(createFakeSupabase(tables), 'actor-1')
    const handlers: JobHandlerRegistry = {
      notification_dispatch: async () => {
        throw new Error('transient failure')
      },
    }

    const outcome = await executeJob({ jobId: 'job-1', supabase, handlers })

    expect(outcome.kind).toBe('failed_will_retry')
    if (outcome.kind === 'failed_will_retry') {
      expect(outcome.attemptCount).toBe(2)
    }
    expect(tables.background_jobs![0]!.status).toBe('queued')
    expect(tables.background_jobs![0]!.attempt_count).toBe(2)
  })

  it('the EXACT attempt that exhausts the budget (newAttemptCount === max_attempts) dead-letters, not retries', async () => {
    // max_attempts = 3, starting attempt_count = 2 -> after this failure,
    // newAttemptCount = 3, which is >= 3: must dead-letter on this exact
    // boundary attempt, not one attempt later or earlier.
    const tables = seed({ background_jobs: [jobRow({ attempt_count: 2, max_attempts: 3 })] })
    const supabase = withAuth(createFakeSupabase(tables), 'actor-1')
    const handlers: JobHandlerRegistry = {
      notification_dispatch: async () => {
        throw new Error('still failing')
      },
    }

    const outcome = await executeJob({ jobId: 'job-1', supabase, handlers })

    expect(outcome.kind).toBe('dead_lettered')
    expect(tables.background_jobs![0]!.status).toBe('dead_lettered')
    expect(tables.background_jobs![0]!.attempt_count).toBe(3)
    expect(tables.background_jobs![0]!.next_attempt_at).toBeNull()
  })

  it('Build Phase 15 Wave 3 — a dead-lettered job is reported to monitoring (category: background_job)', async () => {
    captureMonitoringMessageMock.mockClear()
    const tables = seed({ background_jobs: [jobRow({ attempt_count: 2, max_attempts: 3 })] })
    const supabase = withAuth(createFakeSupabase(tables), 'actor-1')
    const handlers: JobHandlerRegistry = {
      notification_dispatch: async () => {
        throw new Error('still failing')
      },
    }

    await executeJob({ jobId: 'job-1', supabase, handlers })

    expect(captureMonitoringMessageMock).toHaveBeenCalledWith(
      expect.stringContaining('dead-lettered'),
      'error',
      expect.objectContaining({ category: 'background_job', organizationId: ORG_ID }),
    )
  })

  it('a job that requeues for retry (not exhausted) does NOT report to monitoring as dead-lettered', async () => {
    captureMonitoringMessageMock.mockClear()
    const tables = seed({ background_jobs: [jobRow({ attempt_count: 0, max_attempts: 3 })] })
    const supabase = withAuth(createFakeSupabase(tables), 'actor-1')
    const handlers: JobHandlerRegistry = {
      notification_dispatch: async () => {
        throw new Error('transient')
      },
    }

    const outcome = await executeJob({ jobId: 'job-1', supabase, handlers })

    expect(outcome.kind).toBe('failed_will_retry')
    expect(captureMonitoringMessageMock).not.toHaveBeenCalled()
  })

  it('a failure one attempt BEFORE the boundary (max_attempts - 2) still retries', async () => {
    const tables = seed({ background_jobs: [jobRow({ attempt_count: 0, max_attempts: 3 })] })
    const supabase = withAuth(createFakeSupabase(tables), 'actor-1')
    const handlers: JobHandlerRegistry = {
      notification_dispatch: async () => {
        throw new Error('fail')
      },
    }

    const outcome = await executeJob({ jobId: 'job-1', supabase, handlers })
    expect(outcome.kind).toBe('failed_will_retry')
    expect(tables.background_jobs![0]!.attempt_count).toBe(1)
  })

  it('max_attempts = 1 (no retry budget at all) dead-letters on the very first failure', async () => {
    const tables = seed({ background_jobs: [jobRow({ attempt_count: 0, max_attempts: 1 })] })
    const supabase = withAuth(createFakeSupabase(tables), 'actor-1')
    const handlers: JobHandlerRegistry = {
      notification_dispatch: async () => {
        throw new Error('fail immediately')
      },
    }

    const outcome = await executeJob({ jobId: 'job-1', supabase, handlers })
    expect(outcome.kind).toBe('dead_lettered')
    expect(tables.background_jobs![0]!.attempt_count).toBe(1)
  })

  it('a succeeding handler marks the job succeeded regardless of attempt_count/max_attempts', async () => {
    const tables = seed({ background_jobs: [jobRow({ attempt_count: 2, max_attempts: 3 })] })
    const supabase = withAuth(createFakeSupabase(tables), 'actor-1')
    const handlers: JobHandlerRegistry = { notification_dispatch: async () => 'ok' }

    const outcome = await executeJob({ jobId: 'job-1', supabase, handlers })
    expect(outcome.kind).toBe('succeeded')
    expect(tables.background_jobs![0]!.status).toBe('succeeded')
  })
})

describe('executeJob — the optimistic claim under simulated concurrency', () => {
  it('two concurrent claim attempts on the SAME queued row: only one succeeds, the other reports not_claimed and never double-processes the handler', async () => {
    const tables = seed({ background_jobs: [jobRow({ attempt_count: 0, max_attempts: 3 })] })
    const supabase = withAuth(createFakeSupabase(tables), 'actor-1')

    let handlerInvocations = 0
    const handlers: JobHandlerRegistry = {
      notification_dispatch: async () => {
        handlerInvocations += 1
        return 'ok'
      },
    }

    // The fake query builder's `.update().eq().eq()` mutates in place
    // synchronously, so racing two `executeJob` calls with Promise.all still
    // exercises the real guard: the claim UPDATE's WHERE clause (status =
    // 'queued') only matches the row while it is still queued, exactly
    // mirroring the real UPDATE...WHERE semantics this code depends on.
    const [first, second] = await Promise.all([
      executeJob({ jobId: 'job-1', supabase, handlers }),
      executeJob({ jobId: 'job-1', supabase, handlers }),
    ])

    const outcomes = [first.kind, second.kind].sort()
    expect(outcomes).toEqual(['not_claimed', 'succeeded'])
    expect(handlerInvocations).toBe(1)
  })

  it('a job that is no longer queued (already running/succeeded) reports not_claimed without attempting the handler', async () => {
    const tables = seed({ background_jobs: [jobRow({ status: 'running' })] })
    const supabase = withAuth(createFakeSupabase(tables), 'actor-1')
    let invoked = false
    const handlers: JobHandlerRegistry = {
      notification_dispatch: async () => {
        invoked = true
      },
    }

    const outcome = await executeJob({ jobId: 'job-1', supabase, handlers })
    expect(outcome).toEqual({ kind: 'not_claimed', jobId: 'job-1' })
    expect(invoked).toBe(false)
  })
})

describe('executeJob — wall-clock timeout', () => {
  it('a handler that never resolves within timeoutMs is treated as a failure (retry/dead-letter path), never hangs the caller', async () => {
    const tables = seed({ background_jobs: [jobRow({ attempt_count: 0, max_attempts: 3 })] })
    const supabase = withAuth(createFakeSupabase(tables), 'actor-1')
    const handlers: JobHandlerRegistry = {
      notification_dispatch: () => new Promise(() => {}), // never resolves
    }

    const outcome = await executeJob({ jobId: 'job-1', supabase, handlers, timeoutMs: 20 })

    expect(outcome.kind).toBe('failed_will_retry')
    if (outcome.kind === 'failed_will_retry') {
      expect(outcome.errorMessage).toContain('20ms wall-clock timeout')
    }
  })

  it('default timeout constant is exported and positive (sanity check against accidental 0/negative regression)', () => {
    expect(DEFAULT_JOB_TIMEOUT_MS).toBeGreaterThan(0)
  })
})

describe('executeJob — no handler registered', () => {
  it('reports kind: no_handler and still runs the normal retry bookkeeping (does not crash or strand the row running)', async () => {
    const tables = seed({
      background_jobs: [
        jobRow({ job_type: 'integration_sync', attempt_count: 0, max_attempts: 2 }),
      ],
    })
    const supabase = withAuth(createFakeSupabase(tables), 'actor-1')
    const handlers: JobHandlerRegistry = {} // nothing registered for integration_sync

    const outcome = await executeJob({ jobId: 'job-1', supabase, handlers })

    expect(outcome.kind).toBe('no_handler')
    // Still went through the same failed -> queued/dead_lettered bookkeeping.
    expect(['queued', 'dead_lettered']).toContain(tables.background_jobs![0]!.status)
  })
})

describe('executeJob — never throws for a handler error, and never logs the raw payload', () => {
  it('a handler that throws a non-Error value is still caught and turned into a typed outcome', async () => {
    const tables = seed({ background_jobs: [jobRow({ attempt_count: 0, max_attempts: 3 })] })
    const supabase = withAuth(createFakeSupabase(tables), 'actor-1')
    const handlers: JobHandlerRegistry = {
      notification_dispatch: async () => {
        throw 'a plain string rejection'
      },
    }

    const outcome = await executeJob({ jobId: 'job-1', supabase, handlers })
    expect(outcome.kind).toBe('failed_will_retry')
  })

  it('the console never receives the job payload on failure', async () => {
    const sensitivePayload = { secretField: 'do-not-log-me-12345' }
    const tables = seed({
      background_jobs: [jobRow({ payload: sensitivePayload, attempt_count: 0, max_attempts: 3 })],
    })
    const supabase = withAuth(createFakeSupabase(tables), 'actor-1')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const handlers: JobHandlerRegistry = {
      notification_dispatch: async () => {
        throw new Error('boom')
      },
    }

    await executeJob({ jobId: 'job-1', supabase, handlers })

    const allLoggedText = [...logSpy.mock.calls, ...errorSpy.mock.calls]
      .flat()
      .map((v) => JSON.stringify(v))
      .join(' ')
    expect(allLoggedText).not.toContain('do-not-log-me-12345')

    logSpy.mockRestore()
    errorSpy.mockRestore()
  })
})
