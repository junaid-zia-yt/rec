import { describe, expect, it } from 'vitest'
import {
  createFakeSupabase,
  type FakeSupabaseSeed,
} from '@/lib/copilot/orchestration/test-fake-supabase'
import { integrationSyncHandler } from './integration-sync'
import type { JobExecutionContext } from '../types'

const ORG_ID = '11111111-1111-1111-1111-111111111111'

function makeContext(supabase: ReturnType<typeof createFakeSupabase>): JobExecutionContext {
  return {
    organizationId: ORG_ID,
    correlationId: 'corr-1',
    jobId: 'job-1',
    attemptCount: 1,
    signal: new AbortController().signal,
    supabase,
  }
}

describe('integrationSyncHandler', () => {
  it('ta_tracker / mode=api always reports no_documentation and marks the sync failed', async () => {
    const tables: FakeSupabaseSeed = {
      integration_connections: [
        {
          id: 'conn-1',
          organization_id: ORG_ID,
          provider: 'ta_tracker',
          mode: 'api',
          status: 'not_connected',
        },
      ],
    }
    const supabase = createFakeSupabase(tables)

    const result = await integrationSyncHandler(
      { integrationConnectionId: 'conn-1', provider: 'ta_tracker' },
      makeContext(supabase),
    )

    expect(result.outcome).toBe('failed')
    expect(result.message).toContain('no confirmed API')
    expect(tables.integration_connections![0]!.last_sync_status).toBe('failed')
    expect(tables.integration_connections![0]!.last_sync_error).toContain('no confirmed API')
  })

  it('ta_tracker / mode=csv_import_export reports failed with an honest "human-triggered" explanation', async () => {
    const tables: FakeSupabaseSeed = {
      integration_connections: [
        {
          id: 'conn-2',
          organization_id: ORG_ID,
          provider: 'ta_tracker',
          mode: 'csv_import_export',
          status: 'connected',
        },
      ],
    }
    const supabase = createFakeSupabase(tables)

    const result = await integrationSyncHandler(
      { integrationConnectionId: 'conn-2', provider: 'ta_tracker' },
      makeContext(supabase),
    )

    expect(result.outcome).toBe('failed')
    expect(result.message).toContain('human-triggered')
  })

  it('apollo not configured reports failed with a not_configured message', async () => {
    const tables: FakeSupabaseSeed = {
      integration_connections: [
        {
          id: 'conn-3',
          organization_id: ORG_ID,
          provider: 'apollo',
          mode: null,
          status: 'not_connected',
        },
      ],
    }
    const supabase = createFakeSupabase(tables)

    const result = await integrationSyncHandler(
      { integrationConnectionId: 'conn-3', provider: 'apollo' },
      makeContext(supabase),
    )

    expect(result.outcome).toBe('failed')
    expect(result.message).toContain('not configured')
  })

  it('sms always reports failed / not configured', async () => {
    const tables: FakeSupabaseSeed = {
      integration_connections: [
        {
          id: 'conn-4',
          organization_id: ORG_ID,
          provider: 'sms',
          mode: null,
          status: 'not_connected',
        },
      ],
    }
    const supabase = createFakeSupabase(tables)

    const result = await integrationSyncHandler(
      { integrationConnectionId: 'conn-4', provider: 'sms' },
      makeContext(supabase),
    )

    expect(result.outcome).toBe('failed')
  })
})
