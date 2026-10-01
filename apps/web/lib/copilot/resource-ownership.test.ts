import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  assertResourceOwnership,
  isResourceOwnershipValidated,
  ResourceOwnershipError,
} from './resource-ownership'

/**
 * A minimal in-memory fake of the subset of the Supabase query builder this
 * module actually calls (`.from().select().eq()... .maybeSingle()` /
 * `.in()`), so resource-ownership.ts's branching logic can be exercised
 * without a live database — this repo has no live Supabase project
 * connected in this environment (see other modules' test-file comments),
 * so every DB-touching module's tests here use this same style of fake.
 */
function createFakeSupabase(tables: Record<string, Record<string, unknown>[]>): SupabaseClient {
  function builder(table: string) {
    let rows = [...(tables[table] ?? [])]
    const api = {
      select() {
        return api
      },
      eq(column: string, value: unknown) {
        rows = rows.filter((row) => row[column] === value)
        return api
      },
      in(column: string, values: unknown[]) {
        rows = rows.filter((row) => values.includes(row[column]))
        return api
      },
      async maybeSingle() {
        return { data: rows[0] ?? null, error: null }
      },
      then(resolve: (value: { data: Record<string, unknown>[]; error: null }) => unknown) {
        return Promise.resolve({ data: rows, error: null }).then(resolve)
      },
    }
    return api
  }

  return { from: (table: string) => builder(table) } as unknown as SupabaseClient
}

const ORG = 'org-1'
const OTHER_ORG = 'org-2'
const USER = 'user-1'

describe('assertResourceOwnership — recruitment_project', () => {
  it('allows an org-wide role (agency_admin) for a project in its own org', async () => {
    const supabase = createFakeSupabase({
      recruitment_projects: [{ id: 'proj-1', organization_id: ORG, client_id: 'client-1' }],
    })
    const token = await assertResourceOwnership(supabase, {
      organizationId: ORG,
      userId: USER,
      role: 'agency_admin',
      resourceType: 'recruitment_project',
      resourceId: 'proj-1',
    })
    expect(isResourceOwnershipValidated(token)).toBe(true)
  })

  it('denies a project belonging to a different organization, even for agency_admin (cross-tenant isolation)', async () => {
    const supabase = createFakeSupabase({
      recruitment_projects: [{ id: 'proj-1', organization_id: OTHER_ORG, client_id: 'client-1' }],
    })
    await expect(
      assertResourceOwnership(supabase, {
        organizationId: ORG,
        userId: USER,
        role: 'agency_admin',
        resourceType: 'recruitment_project',
        resourceId: 'proj-1',
      }),
    ).rejects.toBeInstanceOf(ResourceOwnershipError)
  })

  it('denies a recruiter with no project_assignments row for that project', async () => {
    const supabase = createFakeSupabase({
      recruitment_projects: [{ id: 'proj-1', organization_id: ORG, client_id: 'client-1' }],
      project_assignments: [],
    })
    await expect(
      assertResourceOwnership(supabase, {
        organizationId: ORG,
        userId: USER,
        role: 'recruiter',
        resourceType: 'recruitment_project',
        resourceId: 'proj-1',
      }),
    ).rejects.toBeInstanceOf(ResourceOwnershipError)
  })

  it('allows a recruiter WITH a project_assignments row for that project', async () => {
    const supabase = createFakeSupabase({
      recruitment_projects: [{ id: 'proj-1', organization_id: ORG, client_id: 'client-1' }],
      project_assignments: [{ id: 'pa-1', user_id: USER, recruitment_project_id: 'proj-1' }],
    })
    const token = await assertResourceOwnership(supabase, {
      organizationId: ORG,
      userId: USER,
      role: 'recruiter',
      resourceType: 'recruitment_project',
      resourceId: 'proj-1',
    })
    expect(token.resourceId).toBe('proj-1')
  })

  it("denies a client_decision_maker whose represented client does not match the project's client", async () => {
    const supabase = createFakeSupabase({
      recruitment_projects: [{ id: 'proj-1', organization_id: ORG, client_id: 'client-1' }],
      organization_memberships: [
        {
          user_id: USER,
          organization_id: ORG,
          role: 'client_decision_maker',
          status: 'active',
          client_id: 'client-OTHER',
        },
      ],
    })
    await expect(
      assertResourceOwnership(supabase, {
        organizationId: ORG,
        userId: USER,
        role: 'client_decision_maker',
        resourceType: 'recruitment_project',
        resourceId: 'proj-1',
      }),
    ).rejects.toBeInstanceOf(ResourceOwnershipError)
  })

  it("allows a client_decision_maker whose represented client matches the project's client", async () => {
    const supabase = createFakeSupabase({
      recruitment_projects: [{ id: 'proj-1', organization_id: ORG, client_id: 'client-1' }],
      organization_memberships: [
        {
          user_id: USER,
          organization_id: ORG,
          role: 'client_decision_maker',
          status: 'active',
          client_id: 'client-1',
        },
      ],
    })
    const token = await assertResourceOwnership(supabase, {
      organizationId: ORG,
      userId: USER,
      role: 'client_decision_maker',
      resourceType: 'recruitment_project',
      resourceId: 'proj-1',
    })
    expect(isResourceOwnershipValidated(token)).toBe(true)
  })

  it('denies a nonexistent resource id', async () => {
    const supabase = createFakeSupabase({ recruitment_projects: [] })
    await expect(
      assertResourceOwnership(supabase, {
        organizationId: ORG,
        userId: USER,
        role: 'agency_admin',
        resourceType: 'recruitment_project',
        resourceId: 'does-not-exist',
      }),
    ).rejects.toBeInstanceOf(ResourceOwnershipError)
  })
})

describe('assertResourceOwnership — candidate', () => {
  it('allows a recruiter who self-sourced the candidate (created_by match) with no project entries at all', async () => {
    const supabase = createFakeSupabase({
      candidates: [{ id: 'cand-1', organization_id: ORG, created_by: USER }],
      candidate_project_entries: [],
    })
    const token = await assertResourceOwnership(supabase, {
      organizationId: ORG,
      userId: USER,
      role: 'recruiter',
      resourceType: 'candidate',
      resourceId: 'cand-1',
    })
    expect(isResourceOwnershipValidated(token)).toBe(true)
  })

  it('denies a recruiter who neither sourced the candidate nor is assigned to any of its projects', async () => {
    const supabase = createFakeSupabase({
      candidates: [{ id: 'cand-1', organization_id: ORG, created_by: 'someone-else' }],
      candidate_project_entries: [{ candidate_id: 'cand-1', recruitment_project_id: 'proj-1' }],
      project_assignments: [],
    })
    await expect(
      assertResourceOwnership(supabase, {
        organizationId: ORG,
        userId: USER,
        role: 'recruiter',
        resourceType: 'candidate',
        resourceId: 'cand-1',
      }),
    ).rejects.toBeInstanceOf(ResourceOwnershipError)
  })

  it("denies a client_decision_maker when the candidate is not client_visible on any of their client's projects", async () => {
    const supabase = createFakeSupabase({
      candidates: [{ id: 'cand-1', organization_id: ORG, created_by: 'someone-else' }],
      candidate_project_entries: [
        { candidate_id: 'cand-1', recruitment_project_id: 'proj-1', client_visible: false },
      ],
      organization_memberships: [
        {
          user_id: USER,
          organization_id: ORG,
          role: 'client_decision_maker',
          status: 'active',
          client_id: 'client-1',
        },
      ],
    })
    await expect(
      assertResourceOwnership(supabase, {
        organizationId: ORG,
        userId: USER,
        role: 'client_decision_maker',
        resourceType: 'candidate',
        resourceId: 'cand-1',
      }),
    ).rejects.toBeInstanceOf(ResourceOwnershipError)
  })

  it('allows a client_decision_maker when the candidate is client_visible on a project of their own client', async () => {
    const supabase = createFakeSupabase({
      candidates: [{ id: 'cand-1', organization_id: ORG, created_by: 'someone-else' }],
      candidate_project_entries: [
        { candidate_id: 'cand-1', recruitment_project_id: 'proj-1', client_visible: true },
      ],
      recruitment_projects: [{ id: 'proj-1', client_id: 'client-1' }],
      organization_memberships: [
        {
          user_id: USER,
          organization_id: ORG,
          role: 'client_decision_maker',
          status: 'active',
          client_id: 'client-1',
        },
      ],
    })
    const token = await assertResourceOwnership(supabase, {
      organizationId: ORG,
      userId: USER,
      role: 'client_decision_maker',
      resourceType: 'candidate',
      resourceId: 'cand-1',
    })
    expect(isResourceOwnershipValidated(token)).toBe(true)
  })

  it("allows read_only_reviewer org-wide (mirrors can_access_candidate()'s RLS branch — documented explicitly, not assumed)", async () => {
    const supabase = createFakeSupabase({
      candidates: [{ id: 'cand-1', organization_id: ORG, created_by: 'someone-else' }],
    })
    const token = await assertResourceOwnership(supabase, {
      organizationId: ORG,
      userId: 'a-different-user',
      role: 'read_only_reviewer',
      resourceType: 'candidate',
      resourceId: 'cand-1',
    })
    expect(isResourceOwnershipValidated(token)).toBe(true)
  })
})

describe('assertResourceOwnership — outreach_message never reachable by client_decision_maker', () => {
  it('denies client_decision_maker even when org matches, independent of the tool-registry allowlist (defense in depth)', async () => {
    const supabase = createFakeSupabase({
      outreach_messages: [{ id: 'om-1', organization_id: ORG, recruitment_project_id: 'proj-1' }],
      organization_memberships: [
        {
          user_id: USER,
          organization_id: ORG,
          role: 'client_decision_maker',
          status: 'active',
          client_id: 'client-1',
        },
      ],
    })
    await expect(
      assertResourceOwnership(supabase, {
        organizationId: ORG,
        userId: USER,
        role: 'client_decision_maker',
        resourceType: 'outreach_message',
        resourceId: 'om-1',
      }),
    ).rejects.toBeInstanceOf(ResourceOwnershipError)
  })
})

describe('isResourceOwnershipValidated', () => {
  it('is false for a plain object that merely has the right shape but was never produced by assertResourceOwnership', () => {
    const forged = { resourceType: 'candidate', resourceId: 'cand-1' }
    expect(isResourceOwnershipValidated(forged)).toBe(false)
  })
})
