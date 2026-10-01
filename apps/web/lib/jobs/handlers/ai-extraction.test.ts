import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createFakeSupabase,
  type FakeSupabaseSeed,
} from '@/lib/copilot/orchestration/test-fake-supabase'
import { TestAIProvider } from '@/lib/ai/test-adapter'
import { enqueueJob } from '@/lib/jobs/enqueue'
import { executeJob } from '@/lib/jobs/executor'
import { createAiExtractionHandler } from './ai-extraction'
import type { AnyJobHandler, JobExecutionContext, JobHandlerRegistry } from '../types'

/**
 * Build Phase 14, Wave 4b — `ai_extraction` job handler tests. Same
 * `withAuth` local wrapper convention `executor.test.ts` already
 * established for adding `.auth.getUser()` on top of the shared fake.
 */
function withAuth(supabase: SupabaseClient, userId: string): SupabaseClient {
  return {
    ...supabase,
    from: supabase.from.bind(supabase),
    auth: { getUser: async () => ({ data: { user: { id: userId } } }) },
  } as unknown as SupabaseClient
}

const ORG_ID = '11111111-1111-1111-1111-111111111111'
const USER_ID = '22222222-2222-2222-2222-222222222222'
const JOB_ID = '33333333-3333-3333-3333-333333333333'
const JOB_DESCRIPTION_ID = '44444444-4444-4444-4444-444444444444'

function seed(overrides: FakeSupabaseSeed = {}): FakeSupabaseSeed {
  return {
    jobs: [
      {
        id: JOB_ID,
        title: 'Shift Supervisor',
        department: 'Operations',
        industry: 'Retail',
        employment_type: 'full_time',
        workplace_arrangement: 'on_site',
        location: 'Columbus, OH',
      },
    ],
    job_descriptions: [
      {
        id: JOB_DESCRIPTION_ID,
        raw_text:
          'MUST: 2 years retail supervisory experience\nPREFERRED(60): Bilingual English/Spanish',
      },
    ],
    ai_runs: [],
    job_requirements: [],
    requirement_extraction_results: [],
    audit_events: [],
    ...overrides,
  }
}

function makeContext(supabase: SupabaseClient): JobExecutionContext {
  return {
    organizationId: ORG_ID,
    correlationId: 'corr-1',
    jobId: 'job-1',
    attemptCount: 1,
    signal: new AbortController().signal,
    supabase,
  }
}

describe('aiExtractionHandler (called directly)', () => {
  it('success path: writes ai_runs, job_requirements, and a completed requirement_extraction_results row', async () => {
    const tables = seed()
    const supabase = withAuth(createFakeSupabase(tables), USER_ID)
    const handler = createAiExtractionHandler({ provider: new TestAIProvider() })

    const result = await handler(
      { targetType: 'job_description', targetId: JOB_DESCRIPTION_ID, jobId: JOB_ID },
      makeContext(supabase),
    )

    expect(result.status).toBe('success')
    expect(result.requirementCount).toBeGreaterThan(0)
    expect(tables.ai_runs).toHaveLength(1)
    expect(tables.ai_runs![0]!.status).toBe('success')
    expect(tables.job_requirements!.length).toBe(result.requirementCount)
    expect(tables.requirement_extraction_results).toHaveLength(1)
    expect(tables.requirement_extraction_results![0]!.status).toBe('completed')
    expect(tables.audit_events!.some((row) => row.action === 'requirement.extracted')).toBe(true)
  })

  it('not_configured: writes no ai_runs row at all (no AI call was made)', async () => {
    const tables = seed()
    const supabase = withAuth(createFakeSupabase(tables), USER_ID)
    // No provider override — anthropicConfigured is false in this environment.
    const handler = createAiExtractionHandler()

    const result = await handler(
      { targetType: 'job_description', targetId: JOB_DESCRIPTION_ID, jobId: JOB_ID },
      makeContext(supabase),
    )

    expect(result.status).toBe('not_configured')
    expect(tables.ai_runs).toHaveLength(0)
    expect(tables.requirement_extraction_results).toHaveLength(0)
  })

  it('a simulated provider failure (invalid output twice) is recorded as a complete, auditable ai_runs + requirement_extraction_results row, without crashing', async () => {
    const tables = seed()
    const supabase = withAuth(createFakeSupabase(tables), USER_ID)
    const handler = createAiExtractionHandler({
      provider: new TestAIProvider({ mode: 'invalid_output' }),
    })

    const result = await handler(
      { targetType: 'job_description', targetId: JOB_DESCRIPTION_ID, jobId: JOB_ID },
      makeContext(supabase),
    )

    expect(result.status).toBe('rejected_by_validation')
    expect(tables.ai_runs).toHaveLength(1)
    expect(tables.requirement_extraction_results![0]!.status).toBe('failed_validation')
    expect(tables.job_requirements).toHaveLength(0)
  })

  it('throws for the unimplemented candidate_document branch, rather than silently doing nothing', async () => {
    const tables = seed()
    const supabase = withAuth(createFakeSupabase(tables), USER_ID)
    const handler = createAiExtractionHandler({ provider: new TestAIProvider() })

    await expect(
      handler(
        { targetType: 'candidate_document', targetId: JOB_DESCRIPTION_ID },
        makeContext(supabase),
      ),
    ).rejects.toThrow(/no handler implementation/i)
  })
})

describe('ai_extraction end-to-end through enqueueJob + executeJob (idempotent double-enqueue)', () => {
  it('a second enqueue with the same idempotency key reuses the existing background_jobs row — no duplicate job, no duplicate ai_runs row', async () => {
    const tables = seed({ background_jobs: [] })
    const supabase = withAuth(createFakeSupabase(tables), USER_ID)
    const handlers: JobHandlerRegistry = {
      ai_extraction: createAiExtractionHandler({ provider: new TestAIProvider() }) as AnyJobHandler,
    }

    const first = await enqueueJob({
      organizationId: ORG_ID,
      jobType: 'ai_extraction',
      payload: { targetType: 'job_description', targetId: JOB_DESCRIPTION_ID, jobId: JOB_ID },
      idempotencyKey: `${JOB_DESCRIPTION_ID}:1`,
      supabase,
      userId: USER_ID,
    })
    const outcome1 = await executeJob({ jobId: first.job.id, supabase, handlers })
    expect(outcome1.kind).toBe('succeeded')

    const second = await enqueueJob({
      organizationId: ORG_ID,
      jobType: 'ai_extraction',
      payload: {
        targetType: 'job_description',
        targetId: JOB_DESCRIPTION_ID,
        jobId: JOB_ID,
        recruitmentProjectId: undefined,
      },
      idempotencyKey: `${JOB_DESCRIPTION_ID}:1`,
      supabase,
      userId: USER_ID,
    })

    expect(second.wasExisting).toBe(true)
    expect(second.job.id).toBe(first.job.id)
    expect(tables.background_jobs).toHaveLength(1)
    // The already-succeeded job is not re-claimed (its status is no longer
    // 'queued'), so re-running executeJob on it is a harmless no-op.
    const outcome2 = await executeJob({ jobId: second.job.id, supabase, handlers })
    expect(outcome2.kind).toBe('not_claimed')
    expect(tables.ai_runs).toHaveLength(1)
  })
})
