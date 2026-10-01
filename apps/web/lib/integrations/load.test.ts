import { describe, expect, it, vi } from 'vitest'
import {
  createFakeSupabase,
  type FakeSupabaseSeed,
} from '@/lib/copilot/orchestration/test-fake-supabase'
import {
  loadIntegrationConnections,
  loadIntegrationSyncJobSummary,
  INTEGRATION_PROVIDERS,
} from './load'

/**
 * Build Phase 12, Wave 6 — `loadIntegrationConnections`'s `visible: false`
 * pattern (this module's own header note: the permission-matrix-vs-RLS
 * discrepancy resolution) had no dedicated test before this wave. The
 * brief's item 7 explicitly asks to confirm this loader "never attempts a
 * query whose RLS-empty-result could be misread as 'nothing connected'"
 * for a non-admin role — this file asserts that at the call-count level,
 * not just the returned shape.
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111'
const OTHER_ORG_ID = '22222222-2222-2222-2222-222222222222'

function seed(overrides: FakeSupabaseSeed = {}): FakeSupabaseSeed {
  return { integration_connections: [], background_jobs: [], ...overrides }
}

describe('loadIntegrationConnections — visible:false pattern for non-admin roles', () => {
  it('for a recruiter, returns visible:false and every provider as not_connected — WITHOUT attempting a query at all (never an RLS-empty-result silently reread as "nothing connected")', async () => {
    const tables = seed({
      integration_connections: [
        {
          id: 'ic-1',
          organization_id: ORG_ID,
          provider: 'apollo',
          mode: null,
          status: 'connected',
          account_owner_label: null,
        },
      ],
    })
    const supabase = createFakeSupabase(tables)
    const fromSpy = vi.spyOn(supabase, 'from')

    const result = await loadIntegrationConnections(ORG_ID, 'recruiter', supabase)

    expect(result.visible).toBe(false)
    expect(result.connections).toHaveLength(INTEGRATION_PROVIDERS.length)
    expect(result.connections.every((c) => c.status === 'not_connected')).toBe(true)
    // The defining guarantee: no query against integration_connections was
    // even attempted for this role — a real RLS-empty-result for this same
    // scenario would be indistinguishable from "nothing is connected",
    // which is exactly the misread this loader's design avoids.
    expect(fromSpy).not.toHaveBeenCalledWith('integration_connections')
  })

  it('for client_decision_maker (neither agency_admin nor platform_admin), also visible:false', async () => {
    const tables = seed({
      integration_connections: [
        { id: 'ic-1', organization_id: ORG_ID, provider: 'apollo', status: 'connected' },
      ],
    })
    const supabase = createFakeSupabase(tables)
    const result = await loadIntegrationConnections(ORG_ID, 'client_decision_maker', supabase)
    expect(result.visible).toBe(false)
  })

  it('for read_only_reviewer, also visible:false', async () => {
    const supabase = createFakeSupabase(seed())
    const result = await loadIntegrationConnections(ORG_ID, 'read_only_reviewer', supabase)
    expect(result.visible).toBe(false)
  })

  it('for agency_admin, returns visible:true with the REAL per-provider status from the database', async () => {
    const tables = seed({
      integration_connections: [
        {
          id: 'ic-1',
          organization_id: ORG_ID,
          provider: 'apollo',
          mode: null,
          status: 'connected',
          account_owner_label: 'Agency-owned',
        },
      ],
    })
    const supabase = createFakeSupabase(tables)
    const result = await loadIntegrationConnections(ORG_ID, 'agency_admin', supabase)

    expect(result.visible).toBe(true)
    const apollo = result.connections.find((c) => c.provider === 'apollo')
    expect(apollo?.status).toBe('connected')
    expect(apollo?.accountOwnerLabel).toBe('Agency-owned')
  })

  it('for platform_admin, also returns visible:true with real status (the RLS oversight policy this loader mirrors grants platform_admin read too)', async () => {
    const tables = seed({
      integration_connections: [
        { id: 'ic-1', organization_id: ORG_ID, provider: 'apollo', status: 'connected' },
      ],
    })
    const supabase = createFakeSupabase(tables)
    const result = await loadIntegrationConnections(ORG_ID, 'platform_admin', supabase)
    expect(result.visible).toBe(true)
  })

  it("never leaks a connection belonging to a DIFFERENT organization into an agency_admin's own view", async () => {
    const tables = seed({
      integration_connections: [
        { id: 'ic-other', organization_id: OTHER_ORG_ID, provider: 'apollo', status: 'connected' },
      ],
    })
    const supabase = createFakeSupabase(tables)
    const result = await loadIntegrationConnections(ORG_ID, 'agency_admin', supabase)
    const apollo = result.connections.find((c) => c.provider === 'apollo')
    expect(apollo?.status).toBe('not_connected')
  })
})

describe('loadIntegrationSyncJobSummary — data ownership', () => {
  it('only counts background_jobs rows for the requested organization and job_type integration_sync', async () => {
    const tables = seed({
      background_jobs: [
        { id: 'j-1', organization_id: ORG_ID, job_type: 'integration_sync', status: 'queued' },
        { id: 'j-2', organization_id: ORG_ID, job_type: 'integration_sync', status: 'failed' },
        {
          id: 'j-3',
          organization_id: OTHER_ORG_ID,
          job_type: 'integration_sync',
          status: 'queued',
        },
        { id: 'j-4', organization_id: ORG_ID, job_type: 'notification_dispatch', status: 'queued' },
      ],
    })
    const supabase = createFakeSupabase(tables)
    const summary = await loadIntegrationSyncJobSummary(ORG_ID, supabase)
    expect(summary).toEqual({ queued: 1, running: 0, failed: 1, deadLettered: 0 })
  })
})
