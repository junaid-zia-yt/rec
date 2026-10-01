import { describe, expect, it } from 'vitest'
import { canDecideScorecardApproval } from './approval-permission'

const PROJECT_CLIENT_ID = 'client-1'

describe('canDecideScorecardApproval', () => {
  it('always allows agency_admin, regardless of the client-approval flag', () => {
    expect(
      canDecideScorecardApproval({
        role: 'agency_admin',
        callerClientId: null,
        projectClientId: PROJECT_CLIENT_ID,
        projectClientCanApproveScorecards: false,
      }),
    ).toBe(true)
  })

  it('always allows platform_admin', () => {
    expect(
      canDecideScorecardApproval({
        role: 'platform_admin',
        callerClientId: null,
        projectClientId: PROJECT_CLIENT_ID,
        projectClientCanApproveScorecards: false,
      }),
    ).toBe(true)
  })

  it('never allows a recruiter to decide an approval — drafting rights are not approval rights', () => {
    expect(
      canDecideScorecardApproval({
        role: 'recruiter',
        callerClientId: null,
        projectClientId: PROJECT_CLIENT_ID,
        projectClientCanApproveScorecards: true,
      }),
    ).toBe(false)
  })

  it('never allows a read_only_reviewer', () => {
    expect(
      canDecideScorecardApproval({
        role: 'read_only_reviewer',
        callerClientId: null,
        projectClientId: PROJECT_CLIENT_ID,
        projectClientCanApproveScorecards: true,
      }),
    ).toBe(false)
  })

  it('refuses a client_decision_maker by default, even for their own client, when the project flag is off', () => {
    expect(
      canDecideScorecardApproval({
        role: 'client_decision_maker',
        callerClientId: PROJECT_CLIENT_ID,
        projectClientId: PROJECT_CLIENT_ID,
        projectClientCanApproveScorecards: false,
      }),
    ).toBe(false)
  })

  it('allows a client_decision_maker for their own client once the project flag is explicitly on', () => {
    expect(
      canDecideScorecardApproval({
        role: 'client_decision_maker',
        callerClientId: PROJECT_CLIENT_ID,
        projectClientId: PROJECT_CLIENT_ID,
        projectClientCanApproveScorecards: true,
      }),
    ).toBe(true)
  })

  it("tenant isolation: refuses a client_decision_maker even with the flag on, for a DIFFERENT client's project", () => {
    expect(
      canDecideScorecardApproval({
        role: 'client_decision_maker',
        callerClientId: 'client-2',
        projectClientId: PROJECT_CLIENT_ID,
        projectClientCanApproveScorecards: true,
      }),
    ).toBe(false)
  })

  it('tenant isolation: refuses a client_decision_maker with no client on their membership at all', () => {
    expect(
      canDecideScorecardApproval({
        role: 'client_decision_maker',
        callerClientId: null,
        projectClientId: PROJECT_CLIENT_ID,
        projectClientCanApproveScorecards: true,
      }),
    ).toBe(false)
  })
})
