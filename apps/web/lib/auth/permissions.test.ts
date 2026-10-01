import { describe, expect, it } from 'vitest'
import { hasPermission, requirePermission } from './permissions'
import { InsufficientRoleError } from './errors'
import type { Membership } from './membership'

const membership = (role: Membership['role']): Membership => ({
  organizationId: 'org-1',
  role,
  status: 'active',
  isDefault: true,
})

/**
 * Transcribes the load-bearing rows of docs/06-roles-permissions.md §6.2's
 * permission matrix as executable assertions, so a future edit to
 * packages/types/src/permissions.ts that silently loosens access is a test
 * failure, not a code-review-only concern.
 */
describe('hasPermission — docs/06-roles-permissions.md §6.2', () => {
  it('agency_admin has full access to candidate_records', () => {
    expect(hasPermission('agency_admin', 'candidate_records', 'create')).toBe(true)
    expect(hasPermission('agency_admin', 'candidate_records', 'delete')).toBe(true)
  })

  it('recruiter has full access to candidate_records but not billing', () => {
    expect(hasPermission('recruiter', 'candidate_records', 'update')).toBe(true)
    expect(hasPermission('recruiter', 'billing', 'read')).toBe(false)
  })

  it('client_decision_maker may only approve/read shortlists, never create or delete', () => {
    expect(hasPermission('client_decision_maker', 'shortlists', 'read')).toBe(true)
    expect(hasPermission('client_decision_maker', 'shortlists', 'approve')).toBe(true)
    expect(hasPermission('client_decision_maker', 'shortlists', 'create')).toBe(false)
    expect(hasPermission('client_decision_maker', 'shortlists', 'delete')).toBe(false)
  })

  it('client_decision_maker has no access to candidate_documents (internal-only)', () => {
    expect(hasPermission('client_decision_maker', 'candidate_documents', 'read')).toBe(false)
  })

  it('read_only_reviewer is read-only everywhere it has any access at all', () => {
    for (const resource of ['recruitment_projects', 'candidate_records', 'shortlists'] as const) {
      expect(hasPermission('read_only_reviewer', resource, 'read')).toBe(true)
      expect(hasPermission('read_only_reviewer', resource, 'create')).toBe(false)
      expect(hasPermission('read_only_reviewer', resource, 'update')).toBe(false)
      expect(hasPermission('read_only_reviewer', resource, 'delete')).toBe(false)
    }
  })

  it('platform_admin has no access to candidate data (support/billing/infra only)', () => {
    expect(hasPermission('platform_admin', 'candidate_records', 'read')).toBe(false)
    expect(hasPermission('platform_admin', 'candidate_documents', 'read')).toBe(false)
    expect(hasPermission('platform_admin', 'billing', 'update')).toBe(true)
  })

  it('only agency_admin/platform_admin can manage users', () => {
    expect(hasPermission('agency_admin', 'users', 'create')).toBe(true)
    expect(hasPermission('recruiter', 'users', 'create')).toBe(false)
    expect(hasPermission('client_decision_maker', 'users', 'create')).toBe(false)
    expect(hasPermission('read_only_reviewer', 'users', 'create')).toBe(false)
  })
})

describe('hasPermission — outreach resource (Build Phase 9, docs/06-roles-permissions.md)', () => {
  it("agency_admin and recruiter have full outreach access, but \"full\" NEVER grants the approve action — every outreach write in apps/web/lib/outreach/outreach-actions.ts (including recordOutreachApprovalAction) is therefore correctly gated on 'update', not 'approve'", () => {
    for (const role of ['agency_admin', 'recruiter'] as const) {
      expect(hasPermission(role, 'outreach', 'create')).toBe(true)
      expect(hasPermission(role, 'outreach', 'read')).toBe(true)
      expect(hasPermission(role, 'outreach', 'update')).toBe(true)
      expect(hasPermission(role, 'outreach', 'delete')).toBe(true)
      expect(hasPermission(role, 'outreach', 'approve')).toBe(false)
    }
  })

  it("no role at all has the approve action on outreach — gating any outreach write on 'approve' would make it uncallable by every role", () => {
    for (const role of [
      'platform_admin',
      'agency_admin',
      'recruiter',
      'client_decision_maker',
      'read_only_reviewer',
    ] as const) {
      expect(hasPermission(role, 'outreach', 'approve')).toBe(false)
    }
  })

  it('client_decision_maker has zero access to outreach on any action, including read — outreach drafting/sending is an internal recruiter workflow the client never sees', () => {
    for (const action of ['create', 'read', 'update', 'delete', 'approve'] as const) {
      expect(hasPermission('client_decision_maker', 'outreach', action)).toBe(false)
    }
  })

  it('read_only_reviewer can read outreach but never write to it', () => {
    expect(hasPermission('read_only_reviewer', 'outreach', 'read')).toBe(true)
    expect(hasPermission('read_only_reviewer', 'outreach', 'create')).toBe(false)
    expect(hasPermission('read_only_reviewer', 'outreach', 'update')).toBe(false)
    expect(hasPermission('read_only_reviewer', 'outreach', 'delete')).toBe(false)
  })

  it('platform_admin has no access to outreach (support/billing/infra only, consistent with its candidate-data exclusion elsewhere)', () => {
    for (const action of ['create', 'read', 'update', 'delete', 'approve'] as const) {
      expect(hasPermission('platform_admin', 'outreach', action)).toBe(false)
    }
  })
})

describe('hasPermission — poc_reports resource (Build Phase 10, docs/06-roles-permissions.md)', () => {
  it('only agency_admin holds full (create/update/delete) access to poc_reports — the resource-level default for the whole POC benchmark/comparison surface', () => {
    for (const action of ['create', 'read', 'update', 'delete'] as const) {
      expect(hasPermission('agency_admin', 'poc_reports', action)).toBe(true)
    }
  })

  it("recruiter is read-only at the resource-permission level, even though supabase/migrations/0030 RLS is separately more permissive for baseline/data-point/exclusion inserts — see apps/web/lib/poc/poc-actions.ts assertPocDataEntryAccess, which is why those three actions never call requirePermission(..., 'poc_reports', ...) at all", () => {
    expect(hasPermission('recruiter', 'poc_reports', 'read')).toBe(true)
    expect(hasPermission('recruiter', 'poc_reports', 'create')).toBe(false)
    expect(hasPermission('recruiter', 'poc_reports', 'update')).toBe(false)
    expect(hasPermission('recruiter', 'poc_reports', 'delete')).toBe(false)
  })

  it('client_decision_maker is read-only on poc_reports (may view the comparison report, never write a benchmark, role, result or decision)', () => {
    expect(hasPermission('client_decision_maker', 'poc_reports', 'read')).toBe(true)
    expect(hasPermission('client_decision_maker', 'poc_reports', 'create')).toBe(false)
    expect(hasPermission('client_decision_maker', 'poc_reports', 'update')).toBe(false)
    expect(hasPermission('client_decision_maker', 'poc_reports', 'delete')).toBe(false)
    expect(hasPermission('client_decision_maker', 'poc_reports', 'approve')).toBe(false)
  })

  it('read_only_reviewer is read-only on poc_reports, consistent with every other resource it can see', () => {
    expect(hasPermission('read_only_reviewer', 'poc_reports', 'read')).toBe(true)
    expect(hasPermission('read_only_reviewer', 'poc_reports', 'create')).toBe(false)
  })

  it("platform_admin has NO resource-level access to poc_reports at all, including read — consistent with its consistent exclusion from every org/client-owned data resource elsewhere in this matrix (candidate_records, outreach, human_reviews). Note: this means recordPocDecisionAction/computePocResultsAction/etc. (all gated on requirePermission(..., 'poc_reports', ...)) are agency_admin-only in practice, despite apps/web/lib/poc/poc-actions.ts's own module header describing \"agency_admin/platform_admin\" as jointly holding approval authority for poc_decisions — that header is only accurate for the assertPocDataEntryAccess-gated actions (baseline/data-point/exclusion recording), not for recordPocDecisionAction itself, which is a resource-permission-gated action platform_admin cannot call.", () => {
    for (const action of ['create', 'read', 'update', 'delete', 'approve'] as const) {
      expect(hasPermission('platform_admin', 'poc_reports', action)).toBe(false)
    }
  })
})

describe('requirePermission', () => {
  it('does not throw when the role is permitted', () => {
    expect(() =>
      requirePermission(membership('agency_admin'), 'scorecards', 'update'),
    ).not.toThrow()
  })

  it('throws InsufficientRoleError when the role is not permitted', () => {
    expect(() =>
      requirePermission(membership('client_decision_maker'), 'scorecards', 'update'),
    ).toThrow(InsufficientRoleError)
  })
})
