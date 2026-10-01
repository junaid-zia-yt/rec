import { describe, expect, it } from 'vitest'
import {
  createFakeSupabase,
  type FakeSupabaseSeed,
} from '@/lib/copilot/orchestration/test-fake-supabase'
import { buildPermissionSafeDeepLink } from './resource-link'

const ORG = 'org-1'
const OTHER_ORG = 'org-2'
const USER = 'user-1'

describe('buildPermissionSafeDeepLink', () => {
  it('resolves a shortlist link for an org-wide role (agency_admin)', async () => {
    const tables: FakeSupabaseSeed = {
      shortlists: [
        {
          id: 'sl-1',
          organization_id: ORG,
          client_id: 'client-1',
          recruitment_project_id: 'proj-1',
        },
      ],
    }
    const supabase = createFakeSupabase(tables)

    const result = await buildPermissionSafeDeepLink({
      resourceType: 'shortlist',
      resourceId: 'sl-1',
      viewerUserId: USER,
      viewerRole: 'agency_admin',
      organizationId: ORG,
      supabase,
    })

    expect(result).toEqual({ accessible: true, path: '/shortlists/sl-1' })
  })

  it('refuses a shortlist link for a recruiter not assigned to its project (never a stale/blind URL)', async () => {
    const tables: FakeSupabaseSeed = {
      shortlists: [
        {
          id: 'sl-1',
          organization_id: ORG,
          client_id: 'client-1',
          recruitment_project_id: 'proj-1',
        },
      ],
      project_assignments: [],
    }
    const supabase = createFakeSupabase(tables)

    const result = await buildPermissionSafeDeepLink({
      resourceType: 'shortlist',
      resourceId: 'sl-1',
      viewerUserId: USER,
      viewerRole: 'recruiter',
      organizationId: ORG,
      supabase,
    })

    expect(result).toEqual({ accessible: false, reason: 'not_found_or_no_longer_accessible' })
  })

  it('the THIS-SESSION-vs-ACCESS-REVOKED case: a recruiter who WAS assigned loses access once their project_assignments row is gone, and the link is refused, not stale', async () => {
    const tables: FakeSupabaseSeed = {
      shortlists: [
        {
          id: 'sl-1',
          organization_id: ORG,
          client_id: 'client-1',
          recruitment_project_id: 'proj-1',
        },
      ],
      project_assignments: [{ id: 'pa-1', user_id: USER, recruitment_project_id: 'proj-1' }],
    }
    const supabase = createFakeSupabase(tables)

    const before = await buildPermissionSafeDeepLink({
      resourceType: 'shortlist',
      resourceId: 'sl-1',
      viewerUserId: USER,
      viewerRole: 'recruiter',
      organizationId: ORG,
      supabase,
    })
    expect(before.accessible).toBe(true)

    // Access revoked since the notification was created (the assignment
    // row is removed) — a fresh call, as this function must always be
    // called at render/click time, now correctly refuses the link.
    tables.project_assignments = []

    const after = await buildPermissionSafeDeepLink({
      resourceType: 'shortlist',
      resourceId: 'sl-1',
      viewerUserId: USER,
      viewerRole: 'recruiter',
      organizationId: ORG,
      supabase,
    })
    expect(after).toEqual({ accessible: false, reason: 'not_found_or_no_longer_accessible' })
  })

  it('denies a shortlist belonging to a different organization, even for agency_admin (cross-tenant isolation)', async () => {
    const tables: FakeSupabaseSeed = {
      shortlists: [
        {
          id: 'sl-1',
          organization_id: OTHER_ORG,
          client_id: 'client-1',
          recruitment_project_id: 'proj-1',
        },
      ],
    }
    const supabase = createFakeSupabase(tables)

    const result = await buildPermissionSafeDeepLink({
      resourceType: 'shortlist',
      resourceId: 'sl-1',
      viewerUserId: USER,
      viewerRole: 'agency_admin',
      organizationId: ORG,
      supabase,
    })

    expect(result.accessible).toBe(false)
  })

  it('resolves a poc_benchmark link directly by id', async () => {
    const tables: FakeSupabaseSeed = {
      poc_benchmarks: [{ id: 'poc-1', organization_id: ORG, client_id: 'client-1' }],
    }
    const supabase = createFakeSupabase(tables)

    const result = await buildPermissionSafeDeepLink({
      resourceType: 'poc_benchmark',
      resourceId: 'poc-1',
      viewerUserId: USER,
      viewerRole: 'agency_admin',
      organizationId: ORG,
      supabase,
    })

    expect(result).toEqual({ accessible: true, path: '/poc/poc-1' })
  })

  it('resolves an outreach_message link to its OWNING SEQUENCE, not the message id (the app has no per-message route)', async () => {
    const tables: FakeSupabaseSeed = {
      outreach_messages: [
        {
          id: 'om-1',
          organization_id: ORG,
          recruitment_project_id: 'proj-1',
          outreach_sequence_id: 'seq-1',
        },
      ],
    }
    const supabase = createFakeSupabase(tables)

    const result = await buildPermissionSafeDeepLink({
      resourceType: 'outreach_message',
      resourceId: 'om-1',
      viewerUserId: USER,
      viewerRole: 'agency_admin',
      organizationId: ORG,
      supabase,
    })

    expect(result).toEqual({ accessible: true, path: '/outreach/seq-1' })
  })

  it('resolves a candidate_role_match link to the candidate detail page', async () => {
    const tables: FakeSupabaseSeed = {
      candidate_role_matches: [{ id: 'crm-1', organization_id: ORG, candidate_id: 'cand-1' }],
      candidates: [{ id: 'cand-1', organization_id: ORG, created_by: USER }],
    }
    const supabase = createFakeSupabase(tables)

    const result = await buildPermissionSafeDeepLink({
      resourceType: 'candidate_role_match',
      resourceId: 'crm-1',
      viewerUserId: USER,
      viewerRole: 'recruiter',
      organizationId: ORG,
      supabase,
    })

    expect(result).toEqual({ accessible: true, path: '/candidates/cand-1' })
  })

  it('resolves a scorecard_version link to its owning project scorecard page', async () => {
    const tables: FakeSupabaseSeed = {
      scorecard_versions: [{ id: 'sv-1', organization_id: ORG, scorecard_id: 'sc-1' }],
      scorecards: [{ id: 'sc-1', job_id: 'job-1' }],
      jobs: [{ id: 'job-1', organization_id: ORG, recruitment_project_id: 'proj-1' }],
      recruitment_projects: [{ id: 'proj-1', organization_id: ORG, client_id: 'client-1' }],
      project_assignments: [{ id: 'pa-1', user_id: USER, recruitment_project_id: 'proj-1' }],
    }
    const supabase = createFakeSupabase(tables)

    const result = await buildPermissionSafeDeepLink({
      resourceType: 'scorecard_version',
      resourceId: 'sv-1',
      viewerUserId: USER,
      viewerRole: 'recruiter',
      organizationId: ORG,
      supabase,
    })

    expect(result).toEqual({ accessible: true, path: '/projects/proj-1/scorecard' })
  })

  it('resolves a verification_request link to its candidate, via the same access check as its owning candidate_role_match', async () => {
    const tables: FakeSupabaseSeed = {
      verification_requests: [
        { id: 'vr-1', organization_id: ORG, candidate_role_match_id: 'crm-1' },
      ],
      candidate_role_matches: [{ id: 'crm-1', organization_id: ORG, candidate_id: 'cand-1' }],
      candidates: [{ id: 'cand-1', organization_id: ORG, created_by: 'someone-else' }],
      project_assignments: [],
    }
    const supabase = createFakeSupabase(tables)

    const denied = await buildPermissionSafeDeepLink({
      resourceType: 'verification_request',
      resourceId: 'vr-1',
      viewerUserId: USER,
      viewerRole: 'recruiter',
      organizationId: ORG,
      supabase,
    })
    expect(denied.accessible).toBe(false)

    const allowed = await buildPermissionSafeDeepLink({
      resourceType: 'verification_request',
      resourceId: 'vr-1',
      viewerUserId: USER,
      viewerRole: 'read_only_reviewer',
      organizationId: ORG,
      supabase,
    })
    expect(allowed).toEqual({ accessible: true, path: '/candidates/cand-1' })
  })

  describe('integration_connection', () => {
    const tables: FakeSupabaseSeed = {
      integration_connections: [{ id: 'ic-1', organization_id: ORG, provider: 'apollo' }],
    }

    it('allows agency_admin/platform_admin (mirrors 0032 RLS exactly)', async () => {
      const supabase = createFakeSupabase(tables)
      const result = await buildPermissionSafeDeepLink({
        resourceType: 'integration_connection',
        resourceId: 'ic-1',
        viewerUserId: USER,
        viewerRole: 'agency_admin',
        organizationId: ORG,
        supabase,
      })
      expect(result).toEqual({ accessible: true, path: '/integrations' })
    })

    it('denies a recruiter — the application-layer "read" grant on the integrations resource is NOT sufficient here (0032 grants no RLS access at all to this role)', async () => {
      const supabase = createFakeSupabase(tables)
      const result = await buildPermissionSafeDeepLink({
        resourceType: 'integration_connection',
        resourceId: 'ic-1',
        viewerUserId: USER,
        viewerRole: 'recruiter',
        organizationId: ORG,
        supabase,
      })
      expect(result.accessible).toBe(false)
    })
  })

  it('returns not_found for a resource id that does not exist at all', async () => {
    const supabase = createFakeSupabase({ shortlists: [] })
    const result = await buildPermissionSafeDeepLink({
      resourceType: 'shortlist',
      resourceId: 'does-not-exist',
      viewerUserId: USER,
      viewerRole: 'agency_admin',
      organizationId: ORG,
      supabase,
    })
    expect(result).toEqual({ accessible: false, reason: 'not_found_or_no_longer_accessible' })
  })
})
