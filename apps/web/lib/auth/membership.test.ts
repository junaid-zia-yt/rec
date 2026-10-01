import { describe, expect, it } from 'vitest'
import {
  findMembership,
  requireMembership,
  requireRole,
  resolveDefaultMembership,
  verifyResourceOrg,
  type Membership,
} from './membership'
import { CrossTenantAccessError, InsufficientRoleError, NotAMemberError } from './errors'

const membership = (over: Partial<Membership> = {}): Membership => ({
  organizationId: 'org-1',
  role: 'recruiter',
  status: 'active',
  isDefault: false,
  ...over,
})

describe('resolveDefaultMembership', () => {
  it('picks the membership explicitly marked default', () => {
    const memberships = [
      membership({ organizationId: 'org-1' }),
      membership({ organizationId: 'org-2', isDefault: true }),
    ]
    expect(resolveDefaultMembership(memberships)?.organizationId).toBe('org-2')
  })

  it('falls back to the sole active membership when none is marked default', () => {
    const memberships = [membership({ organizationId: 'org-1' })]
    expect(resolveDefaultMembership(memberships)?.organizationId).toBe('org-1')
  })

  it('never guesses between two orgs with no default set', () => {
    const memberships = [
      membership({ organizationId: 'org-1' }),
      membership({ organizationId: 'org-2' }),
    ]
    expect(resolveDefaultMembership(memberships)).toBeNull()
  })

  it('ignores revoked memberships', () => {
    const memberships = [membership({ organizationId: 'org-1', status: 'revoked' })]
    expect(resolveDefaultMembership(memberships)).toBeNull()
  })
})

describe('findMembership / requireMembership', () => {
  it('finds an active membership for the given org', () => {
    const memberships = [membership({ organizationId: 'org-1' })]
    expect(findMembership(memberships, 'org-1')).not.toBeNull()
  })

  it('does not find a membership in a different org (cross-tenant denial)', () => {
    const memberships = [membership({ organizationId: 'org-1' })]
    expect(findMembership(memberships, 'org-2')).toBeNull()
  })

  it('does not find a revoked membership', () => {
    const memberships = [membership({ organizationId: 'org-1', status: 'revoked' })]
    expect(findMembership(memberships, 'org-1')).toBeNull()
  })

  it('requireMembership throws NotAMemberError when absent', () => {
    expect(() => requireMembership([], 'org-1')).toThrow(NotAMemberError)
  })
})

describe('requireRole', () => {
  it('passes when the role is allowed', () => {
    const m = membership({ role: 'agency_admin' })
    expect(requireRole(m, ['agency_admin', 'platform_admin'])).toBe(m)
  })

  it('throws InsufficientRoleError when the role is not allowed', () => {
    const m = membership({ role: 'recruiter' })
    expect(() => requireRole(m, ['agency_admin'])).toThrow(InsufficientRoleError)
  })

  it('a client_decision_maker is never granted an agency_admin-only action', () => {
    const m = membership({ role: 'client_decision_maker' })
    expect(() => requireRole(m, ['agency_admin', 'platform_admin'])).toThrow(InsufficientRoleError)
  })
})

describe('verifyResourceOrg', () => {
  it('passes when the resource belongs to the active org', () => {
    expect(() => verifyResourceOrg('org-1', 'org-1')).not.toThrow()
  })

  it('throws CrossTenantAccessError when the resource belongs to a different org', () => {
    expect(() => verifyResourceOrg('org-2', 'org-1')).toThrow(CrossTenantAccessError)
  })

  it('the cross-tenant error message never confirms the resource exists', () => {
    try {
      verifyResourceOrg('org-2', 'org-1')
      expect.unreachable()
    } catch (err) {
      expect((err as Error).message).not.toMatch(/forbidden|denied/i)
      expect((err as Error).message).toMatch(/not be found/i)
    }
  })
})
