import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createFakeSupabase,
  type FakeSupabaseSeed,
} from '@/lib/copilot/orchestration/test-fake-supabase'
import { TestMatchingAIProvider } from '@/lib/ai/matching-test-adapter'
import { enqueueJob } from '@/lib/jobs/enqueue'
import { executeJob } from '@/lib/jobs/executor'
import { createCandidateEvaluationHandler } from './candidate-evaluation'
import type { AnyJobHandler, JobExecutionContext, JobHandlerRegistry } from '../types'

/** Same `withAuth` local-wrapper convention `executor.test.ts` established. */
function withAuth(supabase: SupabaseClient, userId: string): SupabaseClient {
  return {
    ...supabase,
    from: supabase.from.bind(supabase),
    auth: { getUser: async () => ({ data: { user: { id: userId } } }) },
  } as unknown as SupabaseClient
}

const ORG_ID = '11111111-1111-1111-1111-111111111111'
const USER_ID = '22222222-2222-2222-2222-222222222222'
const CANDIDATE_ID = '33333333-3333-3333-3333-333333333333'
const JOB_ID = '44444444-4444-4444-4444-444444444444'
const PROJECT_ID = '55555555-5555-5555-5555-555555555555'
const SCORECARD_ID = 'sc-1'
const SCORECARD_VERSION_ID = 'scv-1'

function seed(overrides: FakeSupabaseSeed = {}): FakeSupabaseSeed {
  return {
    jobs: [
      {
        id: JOB_ID,
        title: 'Regional Manager',
        recruitment_project_id: PROJECT_ID,
        organization_id: ORG_ID,
      },
    ],
    scorecards: [{ id: SCORECARD_ID, job_id: JOB_ID }],
    scorecard_versions: [
      {
        id: SCORECARD_VERSION_ID,
        scorecard_id: SCORECARD_ID,
        status: 'active',
        requirement_snapshot: [
          { requirementId: 'gate-1', type: 'mandatory', weight: null },
          { requirementId: 'pref-1', type: 'preferred', weight: 100 },
        ],
      },
    ],
    job_requirements: [
      { id: 'gate-1', name: 'Valid food-safety certification' },
      { id: 'pref-1', name: 'P&L scale' },
    ],
    candidate_profiles: [],
    candidate_experiences: [
      {
        id: 'exp-1',
        candidate_id: CANDIDATE_ID,
        company: 'Acme',
        title: 'GM',
        location: null,
        start_date: null,
        end_date: null,
        is_current: false,
        description: 'P&L scale: $65M managed across 42 units',
      },
    ],
    candidate_education: [],
    candidate_certifications: [
      {
        id: 'cert-1',
        candidate_id: CANDIDATE_ID,
        name: 'Valid food-safety certification, ServSafe',
        issuing_body: null,
        issued_date: null,
        expires_date: null,
      },
    ],
    candidate_skills: [],
    candidate_extracted_fields: [],
    matching_runs: [],
    ai_runs: [],
    candidate_role_matches: [],
    mandatory_gate_results: [],
    requirement_evidence: [],
    scoring_breakdowns: [],
    candidates: [{ id: CANDIDATE_ID, full_name: 'Jordan Rivera' }],
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

describe('candidateEvaluationHandler (called directly)', () => {
  it('success path: writes matching_runs (completed), candidate_role_matches, gate/evidence/scoring rows', async () => {
    const tables = seed()
    const supabase = withAuth(createFakeSupabase(tables), USER_ID)
    const handler = createCandidateEvaluationHandler({ aiProvider: new TestMatchingAIProvider() })

    const result = await handler(
      {
        candidateId: CANDIDATE_ID,
        jobId: JOB_ID,
        attemptNo: 1,
        triggerReason: 'initial_evaluation',
      },
      makeContext(supabase),
    )

    expect(result.status).toBe('completed')
    expect(tables.matching_runs).toHaveLength(1)
    expect(tables.matching_runs![0]!.status).toBe('completed')
    expect(tables.matching_runs![0]!.idempotency_key).toBe(`${CANDIDATE_ID}:${JOB_ID}:1`)
    expect(tables.candidate_role_matches).toHaveLength(1)
    expect(tables.candidate_role_matches![0]!.eligibility).toBe('eligible')
    expect(tables.candidate_role_matches![0]!.overall_score).toBe(90)
    expect(tables.mandatory_gate_results!.length).toBe(1)
    expect(tables.scoring_breakdowns!.length).toBe(1)
    expect(tables.ai_runs).toHaveLength(1)
    expect(
      tables.audit_events!.some((row) => row.action === 'candidate_match.evaluation_completed'),
    ).toBe(true)
  })

  it('a simulated provider failure (timeout, a retryable kind) records an honest failed matching_runs row AND propagates as a thrown error for the job engine to retry', async () => {
    const tables = seed()
    const supabase = withAuth(createFakeSupabase(tables), USER_ID)
    const handler = createCandidateEvaluationHandler({
      aiProvider: new TestMatchingAIProvider({ mode: 'timeout' }),
    })

    await expect(
      handler(
        {
          candidateId: CANDIDATE_ID,
          jobId: JOB_ID,
          attemptNo: 1,
          triggerReason: 'initial_evaluation',
        },
        makeContext(supabase),
      ),
    ).rejects.toThrow()

    expect(tables.matching_runs).toHaveLength(1)
    expect(tables.matching_runs![0]!.status).toBe('failed')
    expect(tables.matching_runs![0]!.error_kind).toBe('timeout')
    expect(tables.candidate_role_matches![0]!.eligibility).toBe('pending_verification')
  })

  it('a non-retryable failure (twice-invalid AI output) is returned as a value, never thrown', async () => {
    const tables = seed()
    const supabase = withAuth(createFakeSupabase(tables), USER_ID)
    const handler = createCandidateEvaluationHandler({
      aiProvider: new TestMatchingAIProvider({ mode: 'invalid_output' }),
    })

    const result = await handler(
      {
        candidateId: CANDIDATE_ID,
        jobId: JOB_ID,
        attemptNo: 1,
        triggerReason: 'initial_evaluation',
      },
      makeContext(supabase),
    )

    expect(result.status).toBe('failed')
    expect(tables.matching_runs![0]!.status).toBe('failed')
    expect(tables.matching_runs![0]!.error_kind).toBe('validation_failed')
  })

  it('a retry (same attemptNo) reuses the existing matching_runs row instead of inserting a duplicate (avoids the unique idempotency_key index)', async () => {
    const tables = seed()
    const supabase = withAuth(createFakeSupabase(tables), USER_ID)
    const handler = createCandidateEvaluationHandler({ aiProvider: new TestMatchingAIProvider() })

    const first = await handler(
      {
        candidateId: CANDIDATE_ID,
        jobId: JOB_ID,
        attemptNo: 1,
        triggerReason: 'initial_evaluation',
      },
      makeContext(supabase),
    )
    const second = await handler(
      {
        candidateId: CANDIDATE_ID,
        jobId: JOB_ID,
        attemptNo: 1,
        triggerReason: 'initial_evaluation',
      },
      makeContext(supabase),
    )

    expect(second.matchingRunId).toBe(first.matchingRunId)
    expect(tables.matching_runs).toHaveLength(1)
  })
})

describe('candidate_evaluation end-to-end through enqueueJob + executeJob (idempotent double-enqueue)', () => {
  it('a second enqueue with the same idempotency key reuses the existing background_jobs row — no duplicate job, no duplicate matching_runs row', async () => {
    const tables = seed({ background_jobs: [] })
    const supabase = withAuth(createFakeSupabase(tables), USER_ID)
    const handlers: JobHandlerRegistry = {
      candidate_evaluation: createCandidateEvaluationHandler({
        aiProvider: new TestMatchingAIProvider(),
      }) as AnyJobHandler,
    }

    const first = await enqueueJob({
      organizationId: ORG_ID,
      jobType: 'candidate_evaluation',
      payload: {
        candidateId: CANDIDATE_ID,
        jobId: JOB_ID,
        attemptNo: 1,
        triggerReason: 'initial_evaluation',
      },
      idempotencyKey: `${CANDIDATE_ID}:${JOB_ID}:1`,
      supabase,
      userId: USER_ID,
    })
    const outcome1 = await executeJob({ jobId: first.job.id, supabase, handlers })
    expect(outcome1.kind).toBe('succeeded')

    const second = await enqueueJob({
      organizationId: ORG_ID,
      jobType: 'candidate_evaluation',
      payload: {
        candidateId: CANDIDATE_ID,
        jobId: JOB_ID,
        attemptNo: 1,
        triggerReason: 'initial_evaluation',
      },
      idempotencyKey: `${CANDIDATE_ID}:${JOB_ID}:1`,
      supabase,
      userId: USER_ID,
    })

    expect(second.wasExisting).toBe(true)
    expect(second.job.id).toBe(first.job.id)
    expect(tables.background_jobs).toHaveLength(1)
    expect(tables.matching_runs).toHaveLength(1)
  })
})
