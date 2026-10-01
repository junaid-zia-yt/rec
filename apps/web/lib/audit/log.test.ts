import { describe, expect, it, vi } from 'vitest'
import { logAuditEvent } from './log'

const { captureMonitoringMessageMock } = vi.hoisted(() => ({
  captureMonitoringMessageMock: vi.fn(),
}))
vi.mock('@/lib/monitoring/capture', () => ({
  captureMonitoringMessage: captureMonitoringMessageMock,
}))

function fakeSupabase(insertResult: { error: { message: string } | null }) {
  const insert = vi.fn().mockResolvedValue(insertResult)
  const from = vi.fn().mockReturnValue({ insert })
  return { client: { from } as never, insert, from }
}

describe('logAuditEvent', () => {
  it('inserts a row shaped for the audit_events table', async () => {
    const { client, from, insert } = fakeSupabase({ error: null })

    await logAuditEvent(
      {
        organizationId: 'org-1',
        actorId: 'user-1',
        action: 'auth.sign_in',
        entityType: 'user_profiles',
        entityId: 'user-1',
      },
      client,
    )

    expect(from).toHaveBeenCalledWith('audit_events')
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: 'org-1',
        actor_id: 'user-1',
        action: 'auth.sign_in',
        entity_type: 'user_profiles',
        entity_id: 'user-1',
      }),
    )
  })

  it('inserts before/after/metadata for a candidate action — Build Phase 5 brief §"Every stage transition must ... produce an audit event"', async () => {
    const { client, from, insert } = fakeSupabase({ error: null })

    await logAuditEvent(
      {
        organizationId: 'org-1',
        actorId: 'user-1',
        action: 'candidate.stage_transitioned',
        entityType: 'candidate_project_entries',
        entityId: 'cand-1',
        before: { stage: 'discovered' },
        after: { stage: 'eligibility_check', clientVisible: false },
        metadata: { reason: null },
      },
      client,
    )

    expect(from).toHaveBeenCalledWith('audit_events')
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: 'org-1',
        actor_id: 'user-1',
        action: 'candidate.stage_transitioned',
        entity_type: 'candidate_project_entries',
        entity_id: 'cand-1',
        before_json: { stage: 'discovered' },
        after_json: { stage: 'eligibility_check', clientVisible: false },
        metadata: { reason: null },
      }),
    )
  })

  it('never throws when the insert fails — an audit-log failure must not block the action it records', async () => {
    const { client } = fakeSupabase({ error: { message: 'boom' } })
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      logAuditEvent(
        {
          organizationId: null,
          actorId: 'user-1',
          action: 'auth.sign_out',
          entityType: 'user_profiles',
        },
        client,
      ),
    ).resolves.toBeUndefined()

    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('Build Phase 15 Wave 3 — reports the audit-write failure to monitoring (category: audit) when the insert fails', async () => {
    captureMonitoringMessageMock.mockClear()
    const { client } = fakeSupabase({ error: { message: 'boom' } })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await logAuditEvent(
      {
        organizationId: 'org-1',
        actorId: 'user-1',
        action: 'auth.sign_out',
        entityType: 'user_profiles',
      },
      client,
    )

    expect(captureMonitoringMessageMock).toHaveBeenCalledWith(
      expect.stringContaining('auth.sign_out'),
      'error',
      expect.objectContaining({ category: 'audit', organizationId: 'org-1' }),
    )
  })

  it('does not report to monitoring when the insert succeeds', async () => {
    captureMonitoringMessageMock.mockClear()
    const { client } = fakeSupabase({ error: null })

    await logAuditEvent(
      {
        organizationId: 'org-1',
        actorId: 'user-1',
        action: 'auth.sign_in',
        entityType: 'user_profiles',
      },
      client,
    )

    expect(captureMonitoringMessageMock).not.toHaveBeenCalled()
  })

  it('is a no-op (never throws) when no client is available (Supabase not configured)', async () => {
    await expect(
      logAuditEvent(
        {
          organizationId: null,
          actorId: 'user-1',
          action: 'auth.sign_out',
          entityType: 'user_profiles',
        },
        null,
      ),
    ).resolves.toBeUndefined()
  })
})
