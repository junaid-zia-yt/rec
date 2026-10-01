import type { Role } from '@rqi/types'

/**
 * Pure approval-permission gate (Build Phase 4 brief §PERMISSIONS: "Client
 * reviewers may approve only if explicitly permitted"). Extracted from
 * lib/scorecards/actions.ts so it is unit-testable without mocking
 * Supabase, mirroring lib/auth/project-scope.ts's pure row-level-access
 * pattern — the actual authority is still the RLS policy
 * (scorecard_approvals_insert_client_decision_maker in
 * supabase/migrations/0016_scorecards.sql) and the application layer's
 * requireProjectAccess call before this is ever reached; this function is
 * the second, independently-testable layer, not a replacement for either.
 */
export interface ApprovalPermissionCheck {
  role: Role
  /** The caller's own membership.clientId — set only for a client_decision_maker, null for every other role. */
  callerClientId: string | null
  projectClientId: string
  projectClientCanApproveScorecards: boolean
}

export function canDecideScorecardApproval(check: ApprovalPermissionCheck): boolean {
  if (check.role === 'platform_admin' || check.role === 'agency_admin') {
    return true
  }
  if (check.role === 'client_decision_maker') {
    return check.projectClientCanApproveScorecards && check.callerClientId === check.projectClientId
  }
  // recruiter, read_only_reviewer: never an approval decision — matches
  // docs/06-roles-permissions.md §6.2 (Scorecards: F "draft, propose" only
  // for Recruiter, R for Read-Only Reviewer — neither includes "approve").
  return false
}
