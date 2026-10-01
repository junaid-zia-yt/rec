import { describe, expect, it } from 'vitest'
import { canAccessProject, requireProjectAccess } from './project-scope'
import { CrossTenantAccessError } from './errors'
import type { Membership } from './membership'

const membership = (over: Partial<Membership> = {}): Membership => ({
  organizationId: 'org-1',
  role: 'recruiter',
  status: 'active',
  isDefault: false,
  clientId: null,
  ...over,
})

const project = { clientId: 'client-1' }

describe('canAccessProject — Build Phase 3 brief §PERMISSIONS', () => {
  it('agency_admin can access every project in the org', () => {
    const m = membership({ role: 'agency_admin' })
    expect(canAccessProject(m, project, [], 'proj-999')).toBe(true)
  })

  it('platform_admin can access every project', () => {
    const m = membership({ role: 'platform_admin' })
    expect(canAccessProject(m, project, [], 'proj-999')).toBe(true)
  })

  it('read_only_reviewer can access every project (read-only, but not row-scoped)', () => {
    const m = membership({ role: 'read_only_reviewer' })
    expect(canAccessProject(m, project, [], 'proj-999')).toBe(true)
  })

  it('recruiter can access a project they are assigned to', () => {
    const m = membership({ role: 'recruiter' })
    expect(canAccessProject(m, project, ['proj-1'], 'proj-1')).toBe(true)
  })

  it('recruiter cannot access a project they are not assigned to', () => {
    const m = membership({ role: 'recruiter' })
    expect(canAccessProject(m, project, ['proj-2'], 'proj-1')).toBe(false)
  })

  it('recruiter with no assignments at all cannot access any project', () => {
    const m = membership({ role: 'recruiter' })
    expect(canAccessProject(m, project, [], 'proj-1')).toBe(false)
  })

  it('client_decision_maker can access a project belonging to their own client', () => {
    const m = membership({ role: 'client_decision_maker', clientId: 'client-1' })
    expect(canAccessProject(m, project, [], 'proj-1')).toBe(true)
  })

  it('client_decision_maker cannot access a project belonging to a different client', () => {
    const m = membership({ role: 'client_decision_maker', clientId: 'client-2' })
    expect(canAccessProject(m, project, [], 'proj-1')).toBe(false)
  })

  it('client_decision_maker with no client linked yet cannot access any project', () => {
    const m = membership({ role: 'client_decision_maker', clientId: null })
    expect(canAccessProject(m, project, [], 'proj-1')).toBe(false)
  })
})

describe('requireProjectAccess', () => {
  it('does not throw when access is allowed', () => {
    const m = membership({ role: 'agency_admin' })
    expect(() => requireProjectAccess(m, project, [], 'proj-1')).not.toThrow()
  })

  it('throws CrossTenantAccessError (never a "forbidden" message) when access is denied', () => {
    const m = membership({ role: 'recruiter' })
    expect(() => requireProjectAccess(m, project, [], 'proj-1')).toThrow(CrossTenantAccessError)
  })

  it('the denial message never confirms the project exists', () => {
    const m = membership({ role: 'client_decision_maker', clientId: 'client-2' })
    try {
      requireProjectAccess(m, project, [], 'proj-1')
      expect.unreachable()
    } catch (err) {
      expect((err as Error).message).not.toMatch(/forbidden|denied/i)
      expect((err as Error).message).toMatch(/not be found/i)
    }
  })
})
