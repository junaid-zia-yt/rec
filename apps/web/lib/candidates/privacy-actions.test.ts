import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createFakeSupabase,
  type FakeSupabaseSeed,
} from '@/lib/copilot/orchestration/test-fake-supabase'
import { InsufficientRoleError, NotAMemberError } from '@/lib/auth/errors'

/**
 * Build Phase 17A Wave 2 — integration tests for erasePersonalDataAction's
 * new Storage-deletion behavior (docs/privacy-review.md §3c, tracked High
 * since Build Phase 14: the erasure action redacted/deleted DB rows but
 * never deleted the underlying CV/document file bytes in Supabase
 * Storage). This is the first '"use server"' action test in this codebase
 * (privacy.ts's own header, and privacy-actions.ts's, both previously
 * noted only the pure logic modules are unit-tested, not the actions
 * themselves) — exercised here because the defect, and the ordering/
 * idempotency/tenant-isolation guarantees fixing it must provide, live
 * entirely in the action's own control flow, not in any pure helper.
 *
 * Approach: `createFakeSupabase` (shared in-memory fake, extended this
 * wave with `.delete()` support) stands in for the database; `next/cache`
 * is mocked to a no-op (revalidatePath has no request scope under
 * Vitest); `@/lib/supabase/server` and `@/lib/env` are mocked so the real
 * `requirePermission`/`requireOrgMembership` authorization logic runs
 * unmodified against the fake's seeded `organization_memberships` table —
 * authorization itself is exercised for real, not stubbed out.
 */

const { revalidatePathMock } = vi.hoisted(() => ({ revalidatePathMock: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }))

vi.mock('@/lib/env', () => ({
  supabaseConfigured: true,
  documentsStorageBucket: 'documents',
}))

let currentSupabase: SupabaseClient

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => currentSupabase,
}))

const ORG_A = '11111111-1111-1111-1111-111111111111'
const ORG_B = '22222222-2222-2222-2222-222222222222'
const CANDIDATE_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const USER_ADMIN = 'admin-1'
const USER_REVIEWER = 'reviewer-1'
const USER_OUTSIDER = 'outsider-1'

interface RemoveCall {
  path: string
}

/** Builds a fake Supabase client seeded with `seed`, plus `.auth.getUser()` and a `.storage.from(bucket).remove()` whose per-call behavior is controlled by `storageBehavior` — everything erasePersonalDataAction actually calls. */
function buildClient(
  seed: FakeSupabaseSeed,
  userId: string | null,
  storageBehavior: (path: string) => { error: { message: string } | null } = () => ({
    error: null,
  }),
): { client: SupabaseClient; removeCalls: RemoveCall[] } {
  const base = createFakeSupabase(seed)
  const removeCalls: RemoveCall[] = []
  const remove = vi.fn(async (paths: string[]) => {
    const path = paths[0]!
    removeCalls.push({ path })
    return storageBehavior(path)
  })
  const client = {
    ...base,
    from: base.from.bind(base),
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) },
    storage: { from: vi.fn().mockReturnValue({ remove }) },
  } as unknown as SupabaseClient
  return { client, removeCalls }
}

function membership(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    user_id: USER_ADMIN,
    organization_id: ORG_A,
    role: 'agency_admin',
    status: 'active',
    is_default: true,
    client_id: null,
    ...overrides,
  }
}

function baseSeed(): FakeSupabaseSeed {
  return {
    organization_memberships: [
      membership(),
      membership({ user_id: USER_REVIEWER, role: 'read_only_reviewer' }),
    ],
    candidates: [
      {
        id: CANDIDATE_A,
        organization_id: ORG_A,
        full_name: 'Jamie Rivera',
        primary_email: 'jamie@example.com',
        primary_phone: '+15551234567',
        deleted_at: null,
      },
    ],
    candidate_consents: [
      {
        id: 'consent-1',
        candidate_id: CANDIDATE_A,
        organization_id: ORG_A,
        deletion_requested: true,
      },
    ],
    candidate_profiles: [
      { id: 'profile-1', candidate_id: CANDIDATE_A, organization_id: ORG_A, summary: 'CV summary' },
    ],
    candidate_documents: [
      {
        id: 'doc-1',
        candidate_id: CANDIDATE_A,
        organization_id: ORG_A,
        document_upload_id: 'upload-1',
        status: 'active',
      },
      {
        id: 'doc-2',
        candidate_id: CANDIDATE_A,
        organization_id: ORG_A,
        document_upload_id: 'upload-2',
        status: 'active',
      },
    ],
    document_uploads: [
      {
        id: 'upload-1',
        organization_id: ORG_A,
        storage_path: `${ORG_A}/candidate_document/${CANDIDATE_A}/a-jamie-cv.pdf`,
      },
      {
        id: 'upload-2',
        organization_id: ORG_A,
        storage_path: `${ORG_A}/candidate_document/${CANDIDATE_A}/b-jamie-reference.pdf`,
      },
    ],
    candidate_extracted_fields: [],
    candidate_document_processing_jobs: [],
    audit_events: [],
  }
}

function formFor(organizationId: string, candidateId: string): FormData {
  const fd = new FormData()
  fd.set('organizationId', organizationId)
  fd.set('candidateId', candidateId)
  return fd
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('erasePersonalDataAction — Storage deletion', () => {
  it('deletes every Storage object, marks documents rejected, redacts the DB rows, and audits a count without paths — full success', async () => {
    const seed = baseSeed()
    const { client, removeCalls } = buildClient(seed, USER_ADMIN)
    currentSupabase = client

    const { erasePersonalDataAction } = await import('./privacy-actions')
    const result = await erasePersonalDataAction(formFor(ORG_A, CANDIDATE_A))

    expect(result.success).toBe(true)

    // Both Storage objects were actually deleted (physical deletion, not
    // just asserted).
    expect(removeCalls.map((c) => c.path).sort()).toEqual(
      [
        `${ORG_A}/candidate_document/${CANDIDATE_A}/a-jamie-cv.pdf`,
        `${ORG_A}/candidate_document/${CANDIDATE_A}/b-jamie-reference.pdf`,
      ].sort(),
    )

    // Metadata deletion also happened.
    const candidate = seed.candidates![0]!
    expect(candidate.full_name).toBe('[erased]')
    expect(candidate.primary_email).toBeNull()
    expect(candidate.deleted_at).not.toBeNull()

    const docs = seed.candidate_documents!
    expect(docs.every((d) => d.status === 'rejected')).toBe(true)

    // Audit event records a count, never a storage path (which embeds the
    // original file name).
    const auditRow = seed.audit_events!.find((e) => e.action === 'candidate.pii_erased')
    expect(auditRow).toBeDefined()
    expect((auditRow!.metadata as Record<string, unknown>).storageFilesDeleted).toBe(2)
    expect(JSON.stringify(auditRow)).not.toContain('jamie-cv.pdf')
  })

  it('blocks DB anonymization when Storage deletion fails, and reports the failure — does not swallow it', async () => {
    const seed = baseSeed()
    const { client, removeCalls } = buildClient(seed, USER_ADMIN, (path) =>
      path.endsWith('a-jamie-cv.pdf') ? { error: { message: 'network error' } } : { error: null },
    )
    currentSupabase = client

    const { erasePersonalDataAction } = await import('./privacy-actions')
    const result = await erasePersonalDataAction(formFor(ORG_A, CANDIDATE_A))

    expect(result.success).toBe(false)
    expect(result.message).toContain('1 of 2')

    // No DB row was touched — the candidate record survives for a retry.
    const candidate = seed.candidates![0]!
    expect(candidate.full_name).toBe('Jamie Rivera')
    expect(candidate.deleted_at).toBeNull()
    expect(seed.candidate_documents!.every((d) => d.status === 'active')).toBe(true)

    // No audit event was written for a blocked, non-destructive attempt.
    expect(seed.audit_events!.length).toBe(0)

    expect(removeCalls.length).toBe(2)
  })

  it('idempotent retry: re-running after a partial failure only needs the still-failing path to succeed, and completes cleanly', async () => {
    const seed = baseSeed()
    let bFails = true
    const { client } = buildClient(seed, USER_ADMIN, (path) => {
      if (path.endsWith('b-jamie-reference.pdf') && bFails) return { error: { message: 'timeout' } }
      // Real Supabase Storage semantics: deleting an already-absent object
      // (the 'a' path, removed by the first attempt) is not an error.
      return { error: null }
    })
    currentSupabase = client

    const { erasePersonalDataAction } = await import('./privacy-actions')

    const first = await erasePersonalDataAction(formFor(ORG_A, CANDIDATE_A))
    expect(first.success).toBe(false)
    expect(seed.candidates![0]!.full_name).toBe('Jamie Rivera') // untouched

    bFails = false // storage issue clears
    const second = await erasePersonalDataAction(formFor(ORG_A, CANDIDATE_A))
    expect(second.success).toBe(true)
    expect(seed.candidates![0]!.full_name).toBe('[erased]')
  })

  it('rejects a cross-tenant erasure attempt — candidate in a different org is never touched', async () => {
    const seed = baseSeed()
    // The candidate/consent/documents all live under ORG_A (seeded above);
    // the caller is a member of ORG_B attempting to erase it there.
    seed.organization_memberships!.push(membership({ organization_id: ORG_B }))
    const { client, removeCalls } = buildClient(seed, USER_ADMIN)
    currentSupabase = client

    const { erasePersonalDataAction } = await import('./privacy-actions')
    const result = await erasePersonalDataAction(formFor(ORG_B, CANDIDATE_A))

    expect(result.success).toBe(false)
    // Explicit organization-scoped lookups find nothing under ORG_B, so
    // the consent gate itself reports "not found" rather than proceeding.
    expect(result.message).toContain('No recorded deletion request')
    expect(removeCalls.length).toBe(0)
    expect(seed.candidates![0]!.full_name).toBe('Jamie Rivera')
    expect(seed.candidate_documents!.every((d) => d.status === 'active')).toBe(true)
  })

  it('denies an unauthorized role (read_only_reviewer) — candidate_records:delete requires agency_admin/recruiter', async () => {
    const seed = baseSeed()
    const { client, removeCalls } = buildClient(seed, USER_REVIEWER)
    currentSupabase = client

    const { erasePersonalDataAction } = await import('./privacy-actions')

    await expect(erasePersonalDataAction(formFor(ORG_A, CANDIDATE_A))).rejects.toThrow(
      InsufficientRoleError,
    )
    expect(removeCalls.length).toBe(0)
    expect(seed.candidates![0]!.full_name).toBe('Jamie Rivera')
  })

  it('denies a non-member entirely', async () => {
    const seed = baseSeed()
    const { client, removeCalls } = buildClient(seed, USER_OUTSIDER)
    currentSupabase = client

    const { erasePersonalDataAction } = await import('./privacy-actions')

    await expect(erasePersonalDataAction(formFor(ORG_A, CANDIDATE_A))).rejects.toThrow(
      NotAMemberError,
    )
    expect(removeCalls.length).toBe(0)
  })

  it('is a no-op success with zero Storage calls when the candidate has no documents', async () => {
    const seed = baseSeed()
    seed.candidate_documents = []
    const { client, removeCalls } = buildClient(seed, USER_ADMIN)
    currentSupabase = client

    const { erasePersonalDataAction } = await import('./privacy-actions')
    const result = await erasePersonalDataAction(formFor(ORG_A, CANDIDATE_A))

    expect(result.success).toBe(true)
    expect(removeCalls.length).toBe(0)
    const auditRow = seed.audit_events!.find((e) => e.action === 'candidate.pii_erased')
    expect((auditRow!.metadata as Record<string, unknown>).storageFilesDeleted).toBe(0)
  })
})
