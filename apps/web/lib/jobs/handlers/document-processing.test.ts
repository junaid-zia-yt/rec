import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createFakeSupabase,
  type FakeSupabaseSeed,
} from '@/lib/copilot/orchestration/test-fake-supabase'
import { TestCandidateAIProvider } from '@/lib/ai/candidate-test-adapter'
import { enqueueJob } from '@/lib/jobs/enqueue'
import { executeJob } from '@/lib/jobs/executor'
import { createDocumentProcessingHandler } from './document-processing'
import type { AnyJobHandler, JobExecutionContext, JobHandlerRegistry } from '../types'

const FIXTURES_DIR = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'test',
  'fixtures',
  'candidate-documents',
)

/**
 * `createFakeSupabase` only fakes `.from(...)` — this handler also calls
 * `.auth.getUser()` (same as `executor.test.ts`'s own `withAuth`) AND
 * `.storage.from(bucket).download(path)` (`lib/files/storage.ts`'s
 * `downloadDocumentBytes`), which nothing else in this test suite has
 * needed to fake before. Scoped to this file only, per this repo's "small,
 * purpose-built fake" convention for a capability the shared fake lacks.
 */
function withAuthAndStorage(
  supabase: SupabaseClient,
  userId: string,
  fileBytes: Uint8Array,
): SupabaseClient {
  return {
    ...supabase,
    from: supabase.from.bind(supabase),
    auth: { getUser: async () => ({ data: { user: { id: userId } } }) },
    storage: {
      from: () => ({
        download: async () => ({
          data: { arrayBuffer: async () => fileBytes.buffer },
          error: null,
        }),
      }),
    },
  } as unknown as SupabaseClient
}

async function loadFixture(name: string): Promise<Uint8Array> {
  const buffer = await readFile(path.join(FIXTURES_DIR, name))
  return new Uint8Array(buffer)
}

const ORG_ID = '11111111-1111-1111-1111-111111111111'
const USER_ID = '22222222-2222-2222-2222-222222222222'
const CANDIDATE_ID = '33333333-3333-3333-3333-333333333333'
const CANDIDATE_DOCUMENT_ID = '44444444-4444-4444-4444-444444444444'
const UPLOAD_ID = '55555555-5555-5555-5555-555555555555'

function seed(overrides: FakeSupabaseSeed = {}): FakeSupabaseSeed {
  return {
    candidate_documents: [{ id: CANDIDATE_DOCUMENT_ID, document_upload_id: UPLOAD_ID }],
    document_uploads: [
      {
        id: UPLOAD_ID,
        storage_path: 'orgs/1/candidates/1/standard-cv.pdf',
        mime_type: 'application/pdf',
      },
    ],
    candidate_document_processing_jobs: [],
    candidate_extracted_fields: [],
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

describe('documentProcessingHandler (called directly)', () => {
  it('success path: walks queued -> extracting_text -> parsing -> awaiting_review and writes candidate_extracted_fields', async () => {
    const bytes = await loadFixture('standard-cv.pdf')
    const tables = seed()
    const supabase = withAuthAndStorage(createFakeSupabase(tables), USER_ID, bytes)
    const handler = createDocumentProcessingHandler({ aiProvider: new TestCandidateAIProvider() })

    const result = await handler(
      { candidateId: CANDIDATE_ID, candidateDocumentId: CANDIDATE_DOCUMENT_ID, attemptNo: 1 },
      makeContext(supabase),
    )

    expect(result.jobStatus).toBe('awaiting_review')
    expect(tables.candidate_document_processing_jobs).toHaveLength(1)
    expect(tables.candidate_document_processing_jobs![0]!.status).toBe('awaiting_review')
    expect(tables.candidate_document_processing_jobs![0]!.idempotency_key).toBe(
      `${CANDIDATE_DOCUMENT_ID}:1`,
    )
    expect(tables.candidate_extracted_fields!.length).toBeGreaterThan(0)
    expect(
      tables.audit_events!.some((row) => row.action === 'candidate.document_processing_completed'),
    ).toBe(true)
  })

  it('a simulated provider failure (timeout, a retryable kind) is recorded as an honest failed row AND propagates as a thrown error for the job engine to retry', async () => {
    const bytes = await loadFixture('standard-cv.pdf')
    const tables = seed()
    const supabase = withAuthAndStorage(createFakeSupabase(tables), USER_ID, bytes)
    const handler = createDocumentProcessingHandler({
      aiProvider: new TestCandidateAIProvider({ mode: 'timeout' }),
    })

    await expect(
      handler(
        { candidateId: CANDIDATE_ID, candidateDocumentId: CANDIDATE_DOCUMENT_ID, attemptNo: 1 },
        makeContext(supabase),
      ),
    ).rejects.toThrow()

    expect(tables.candidate_document_processing_jobs).toHaveLength(1)
    expect(tables.candidate_document_processing_jobs![0]!.status).toBe('failed')
    expect(tables.candidate_document_processing_jobs![0]!.error_kind).toBe('timeout')
  })

  it('a non-retryable failure (no AI configured / invalid output) is returned as a value, never thrown', async () => {
    const bytes = await loadFixture('standard-cv.pdf')
    const tables = seed()
    const supabase = withAuthAndStorage(createFakeSupabase(tables), USER_ID, bytes)
    const handler = createDocumentProcessingHandler({
      aiProvider: new TestCandidateAIProvider({ mode: 'invalid_output' }),
    })

    const result = await handler(
      { candidateId: CANDIDATE_ID, candidateDocumentId: CANDIDATE_DOCUMENT_ID, attemptNo: 1 },
      makeContext(supabase),
    )

    expect(result.jobStatus).toBe('failed')
    expect(tables.candidate_document_processing_jobs![0]!.status).toBe('failed')
  })

  it('a retry (same attemptNo) reuses the existing job row instead of inserting a duplicate', async () => {
    const bytes = await loadFixture('standard-cv.pdf')
    const tables = seed()
    const supabase = withAuthAndStorage(createFakeSupabase(tables), USER_ID, bytes)
    const handler = createDocumentProcessingHandler({ aiProvider: new TestCandidateAIProvider() })

    const first = await handler(
      { candidateId: CANDIDATE_ID, candidateDocumentId: CANDIDATE_DOCUMENT_ID, attemptNo: 1 },
      makeContext(supabase),
    )
    const second = await handler(
      { candidateId: CANDIDATE_ID, candidateDocumentId: CANDIDATE_DOCUMENT_ID, attemptNo: 1 },
      makeContext(supabase),
    )

    expect(second.processingJobId).toBe(first.processingJobId)
    expect(tables.candidate_document_processing_jobs).toHaveLength(1)
  })
})

describe('document_processing end-to-end through enqueueJob + executeJob (idempotent double-enqueue)', () => {
  it('a second enqueue with the same idempotency key reuses the existing background_jobs row — no duplicate job, no duplicate processing-job row', async () => {
    const bytes = await loadFixture('standard-cv.pdf')
    const tables = seed({ background_jobs: [] })
    const supabase = withAuthAndStorage(createFakeSupabase(tables), USER_ID, bytes)
    const handlers: JobHandlerRegistry = {
      document_processing: createDocumentProcessingHandler({
        aiProvider: new TestCandidateAIProvider(),
      }) as AnyJobHandler,
    }

    const first = await enqueueJob({
      organizationId: ORG_ID,
      jobType: 'document_processing',
      payload: {
        candidateId: CANDIDATE_ID,
        candidateDocumentId: CANDIDATE_DOCUMENT_ID,
        attemptNo: 1,
      },
      idempotencyKey: `${CANDIDATE_DOCUMENT_ID}:1`,
      supabase,
      userId: USER_ID,
    })
    const outcome1 = await executeJob({ jobId: first.job.id, supabase, handlers })
    expect(outcome1.kind).toBe('succeeded')

    const second = await enqueueJob({
      organizationId: ORG_ID,
      jobType: 'document_processing',
      payload: {
        candidateId: CANDIDATE_ID,
        candidateDocumentId: CANDIDATE_DOCUMENT_ID,
        attemptNo: 1,
      },
      idempotencyKey: `${CANDIDATE_DOCUMENT_ID}:1`,
      supabase,
      userId: USER_ID,
    })

    expect(second.wasExisting).toBe(true)
    expect(second.job.id).toBe(first.job.id)
    expect(tables.background_jobs).toHaveLength(1)
    expect(tables.candidate_document_processing_jobs).toHaveLength(1)
  })
})
