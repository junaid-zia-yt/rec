import { describe, expect, it } from 'vitest'
import {
  createFakeSupabase,
  type FakeSupabaseSeed,
} from '@/lib/copilot/orchestration/test-fake-supabase'
import {
  notificationIdempotencyKey,
  notifyCandidateAwaitingReview,
  notifyCandidateResponded,
  notifyIntegrationFailed,
  notifyOutreachAwaitingApproval,
  notifyPocCompleted,
  notifyScorecardAwaitingApproval,
  notifyShortlistAwaitingClientDecision,
  notifyVerificationRequested,
} from './event-triggers'

// enqueueJob validates NotificationDispatchPayloadSchema, which requires
// recipientUserId/resourceId to be real UUIDs — every id below is a
// well-formed UUID for that reason (not because it needs to look like a
// real Supabase-generated one).
const ORG = '00000000-0000-0000-0000-00000000000a'
const OTHER_ORG = '00000000-0000-0000-0000-00000000000b'
const ACTOR = '00000000-0000-0000-0000-000000000001'
const ADMIN_1 = '00000000-0000-0000-0000-000000000002'
const PLATFORM_1 = '00000000-0000-0000-0000-000000000003'
const CLIENT_1 = '00000000-0000-0000-0000-000000000004'
const CLIENT_2 = '00000000-0000-0000-0000-000000000005'
const RECRUITER_1 = '00000000-0000-0000-0000-000000000006'
const RECRUITER_2 = '00000000-0000-0000-0000-000000000007'
const CLIENT_X = '00000000-0000-0000-0000-0000000000c1'
const CLIENT_OTHER = '00000000-0000-0000-0000-0000000000c2'
const PROJ_1 = '00000000-0000-0000-0000-0000000000d1'
const OTHER_PROJ = '00000000-0000-0000-0000-0000000000d2'
const RES_1 = '00000000-0000-0000-0000-0000000000e1'
const RES_2 = '00000000-0000-0000-0000-0000000000e2'

function seed(overrides: FakeSupabaseSeed = {}): FakeSupabaseSeed {
  return {
    background_jobs: [],
    audit_events: [],
    organization_memberships: [],
    project_assignments: [],
    ...overrides,
  }
}

describe('notificationIdempotencyKey', () => {
  it('builds a deterministic key from (eventType, resourceId, recipientUserId)', () => {
    const key = notificationIdempotencyKey({
      eventType: 'poc_completed',
      resourceId: RES_1,
      recipientUserId: ACTOR,
    })
    expect(key).toBe(`poc_completed:${RES_1}:${ACTOR}`)
  })

  it('appends a dedupeSuffix when supplied, so a recurring event does not collide with a prior firing', () => {
    const key = notificationIdempotencyKey({
      eventType: 'candidate_responded',
      resourceId: RES_1,
      recipientUserId: ACTOR,
      dedupeSuffix: 'response-2',
    })
    expect(key).toBe(`candidate_responded:${RES_1}:${ACTOR}:response-2`)
  })
})

describe('idempotency: the SAME event firing twice for the SAME (recipient, event_type, resource_id) never creates a second notification_dispatch job', () => {
  it('notifyPocCompleted called twice for the same benchmark/client enqueues each recipient exactly once', async () => {
    const tables = seed({
      organization_memberships: [
        { user_id: ADMIN_1, organization_id: ORG, role: 'agency_admin', status: 'active' },
        {
          user_id: CLIENT_1,
          organization_id: ORG,
          role: 'client_decision_maker',
          status: 'active',
          client_id: CLIENT_X,
        },
      ],
    })
    const supabase = createFakeSupabase(tables)

    const params = {
      organizationId: ORG,
      actorUserId: ACTOR,
      pocBenchmarkId: RES_1,
      clientId: CLIENT_X,
      benchmarkName: 'Retail Cashier POC',
      supabase,
    }

    const first = await notifyPocCompleted(params)
    const second = await notifyPocCompleted(params)

    expect(first).toHaveLength(2)
    expect(second).toHaveLength(2)
    expect(second.every((r) => r.wasExisting)).toBe(true)
    // Exactly one background_jobs row per recipient, not two.
    expect(tables.background_jobs).toHaveLength(2)
  })
})

describe('idempotency — extended: notifyCandidateAwaitingReview and notifyVerificationRequested', () => {
  it('notifyCandidateAwaitingReview called twice for the same match/project enqueues each assigned recruiter exactly once', async () => {
    const tables = seed({
      project_assignments: [{ id: 'pa-1', user_id: RECRUITER_1, recruitment_project_id: PROJ_1 }],
    })
    const supabase = createFakeSupabase(tables)
    const params = {
      organizationId: ORG,
      actorUserId: ACTOR,
      candidateRoleMatchId: RES_1,
      recruitmentProjectId: PROJ_1,
      candidateName: 'Jamie Rivera',
      supabase,
    }

    const first = await notifyCandidateAwaitingReview(params)
    const second = await notifyCandidateAwaitingReview(params)

    expect(first).toHaveLength(1)
    expect(second).toHaveLength(1)
    expect(second[0]!.wasExisting).toBe(true)
    expect(tables.background_jobs).toHaveLength(1)
  })

  it('notifyVerificationRequested called twice for the same request enqueues each recipient exactly once, never a second notifications job', async () => {
    const tables = seed({
      organization_memberships: [
        { user_id: ADMIN_1, organization_id: ORG, role: 'agency_admin', status: 'active' },
      ],
      project_assignments: [{ id: 'pa-1', user_id: RECRUITER_1, recruitment_project_id: PROJ_1 }],
    })
    const supabase = createFakeSupabase(tables)
    const params = {
      organizationId: ORG,
      actorUserId: ACTOR,
      verificationRequestId: RES_1,
      recruitmentProjectId: PROJ_1,
      candidateName: 'Jamie Rivera',
      supabase,
    }

    const first = await notifyVerificationRequested(params)
    const second = await notifyVerificationRequested(params)

    expect(first).toHaveLength(2)
    expect(second.every((r) => r.wasExisting)).toBe(true)
    expect(tables.background_jobs).toHaveLength(2)
  })
})

describe('notifyScorecardAwaitingApproval — recipient resolution', () => {
  it('always includes agency_admin/platform_admin, and includes client_decision_maker ONLY when the project allows client approval', async () => {
    const tables = seed({
      organization_memberships: [
        { user_id: ADMIN_1, organization_id: ORG, role: 'agency_admin', status: 'active' },
        { user_id: PLATFORM_1, organization_id: ORG, role: 'platform_admin', status: 'active' },
        {
          user_id: CLIENT_1,
          organization_id: ORG,
          role: 'client_decision_maker',
          status: 'active',
          client_id: CLIENT_X,
        },
        { user_id: RECRUITER_1, organization_id: ORG, role: 'recruiter', status: 'active' },
      ],
    })
    const supabase = createFakeSupabase(tables)

    const withoutClientApproval = await notifyScorecardAwaitingApproval({
      organizationId: ORG,
      actorUserId: ACTOR,
      scorecardVersionId: RES_1,
      recruitmentProjectId: PROJ_1,
      projectClientId: CLIENT_X,
      projectClientCanApproveScorecards: false,
      jobTitle: 'Store Manager',
      supabase,
    })
    const recipientsWithout = withoutClientApproval.map(
      (r) => r.job.payload.recipientUserId as string,
    )
    expect(new Set(recipientsWithout)).toEqual(new Set([ADMIN_1, PLATFORM_1]))
    expect(recipientsWithout).not.toContain(CLIENT_1)
    expect(recipientsWithout).not.toContain(RECRUITER_1)

    tables.background_jobs = []
    const withClientApproval = await notifyScorecardAwaitingApproval({
      organizationId: ORG,
      actorUserId: ACTOR,
      scorecardVersionId: RES_2,
      recruitmentProjectId: PROJ_1,
      projectClientId: CLIENT_X,
      projectClientCanApproveScorecards: true,
      jobTitle: 'Store Manager',
      supabase,
    })
    const recipientsWith = withClientApproval.map((r) => r.job.payload.recipientUserId as string)
    expect(new Set(recipientsWith)).toEqual(new Set([ADMIN_1, PLATFORM_1, CLIENT_1]))
  })

  it('never notifies a client_decision_maker representing a DIFFERENT client, even when their project can approve', async () => {
    const tables = seed({
      organization_memberships: [
        {
          user_id: CLIENT_2,
          organization_id: ORG,
          role: 'client_decision_maker',
          status: 'active',
          client_id: CLIENT_OTHER,
        },
      ],
    })
    const supabase = createFakeSupabase(tables)

    const result = await notifyScorecardAwaitingApproval({
      organizationId: ORG,
      actorUserId: ACTOR,
      scorecardVersionId: RES_1,
      recruitmentProjectId: PROJ_1,
      projectClientId: CLIENT_X,
      projectClientCanApproveScorecards: true,
      jobTitle: 'Store Manager',
      supabase,
    })
    expect(result).toHaveLength(0)
  })

  it('never notifies the actor themselves, even if they would otherwise qualify (e.g. an agency_admin submitting their own scorecard)', async () => {
    const tables = seed({
      organization_memberships: [
        { user_id: ACTOR, organization_id: ORG, role: 'agency_admin', status: 'active' },
      ],
    })
    const supabase = createFakeSupabase(tables)

    const result = await notifyScorecardAwaitingApproval({
      organizationId: ORG,
      actorUserId: ACTOR,
      scorecardVersionId: RES_1,
      recruitmentProjectId: PROJ_1,
      projectClientId: CLIENT_X,
      projectClientCanApproveScorecards: false,
      jobTitle: 'Store Manager',
      supabase,
    })
    expect(result).toHaveLength(0)
  })
})

describe('notifyCandidateAwaitingReview — recipient resolution', () => {
  it("notifies only recruiters assigned to the candidate match's project, not every org member", async () => {
    const tables = seed({
      organization_memberships: [
        { user_id: ADMIN_1, organization_id: ORG, role: 'agency_admin', status: 'active' },
      ],
      project_assignments: [
        { id: 'pa-1', user_id: RECRUITER_1, recruitment_project_id: PROJ_1 },
        { id: 'pa-2', user_id: RECRUITER_2, recruitment_project_id: OTHER_PROJ },
      ],
    })
    const supabase = createFakeSupabase(tables)

    const result = await notifyCandidateAwaitingReview({
      organizationId: ORG,
      actorUserId: ACTOR,
      candidateRoleMatchId: RES_1,
      recruitmentProjectId: PROJ_1,
      candidateName: 'Jamie Rivera',
      supabase,
    })
    const recipients = result.map((r) => r.job.payload.recipientUserId as string)
    expect(recipients).toEqual([RECRUITER_1])
  })
})

describe('notifyVerificationRequested / notifyOutreachAwaitingApproval — assigned recruiter(s) + org admins', () => {
  it('notifyVerificationRequested combines project-assigned recruiters and org agency_admin, deduped', async () => {
    const tables = seed({
      organization_memberships: [
        { user_id: ADMIN_1, organization_id: ORG, role: 'agency_admin', status: 'active' },
      ],
      project_assignments: [{ id: 'pa-1', user_id: RECRUITER_1, recruitment_project_id: PROJ_1 }],
    })
    const supabase = createFakeSupabase(tables)

    const result = await notifyVerificationRequested({
      organizationId: ORG,
      actorUserId: ACTOR,
      verificationRequestId: RES_1,
      recruitmentProjectId: PROJ_1,
      candidateName: 'Jamie Rivera',
      supabase,
    })
    const recipients = new Set(result.map((r) => r.job.payload.recipientUserId as string))
    expect(recipients).toEqual(new Set([ADMIN_1, RECRUITER_1]))
  })

  it("notifyOutreachAwaitingApproval does the same for an outreach message's project", async () => {
    const tables = seed({
      organization_memberships: [
        { user_id: ADMIN_1, organization_id: ORG, role: 'agency_admin', status: 'active' },
      ],
      project_assignments: [{ id: 'pa-1', user_id: RECRUITER_1, recruitment_project_id: PROJ_1 }],
    })
    const supabase = createFakeSupabase(tables)

    const result = await notifyOutreachAwaitingApproval({
      organizationId: ORG,
      actorUserId: ACTOR,
      outreachMessageId: RES_1,
      recruitmentProjectId: PROJ_1,
      candidateName: 'Jamie Rivera',
      supabase,
    })
    const recipients = new Set(result.map((r) => r.job.payload.recipientUserId as string))
    expect(recipients).toEqual(new Set([ADMIN_1, RECRUITER_1]))
  })
})

describe('notifyCandidateResponded', () => {
  it("notifies only the sequence's started_by recruiter", async () => {
    const supabase = createFakeSupabase(seed())
    const result = await notifyCandidateResponded({
      organizationId: ORG,
      actorUserId: ACTOR,
      outreachMessageId: RES_1,
      sequenceStartedBy: RECRUITER_1,
      candidateName: 'Jamie Rivera',
      responseEventId: 'evt-1',
      supabase,
    })
    expect(result.map((r) => r.job.payload.recipientUserId)).toEqual([RECRUITER_1])
  })

  it('returns no notifications when the sequence has no recorded started_by', async () => {
    const supabase = createFakeSupabase(seed())
    const result = await notifyCandidateResponded({
      organizationId: ORG,
      actorUserId: ACTOR,
      outreachMessageId: RES_1,
      sequenceStartedBy: null,
      candidateName: 'Jamie Rivera',
      responseEventId: 'evt-1',
      supabase,
    })
    expect(result).toHaveLength(0)
  })

  it('a SECOND, distinct response (different responseEventId) is NOT deduped away by the first', async () => {
    const tables = seed()
    const supabase = createFakeSupabase(tables)
    const base = {
      organizationId: ORG,
      actorUserId: ACTOR,
      outreachMessageId: RES_1,
      sequenceStartedBy: RECRUITER_1,
      candidateName: 'Jamie Rivera',
      supabase,
    }
    await notifyCandidateResponded({ ...base, responseEventId: 'evt-1' })
    await notifyCandidateResponded({ ...base, responseEventId: 'evt-2' })

    expect(tables.background_jobs).toHaveLength(2)
  })
})

describe('notifyShortlistAwaitingClientDecision', () => {
  it("notifies only client_decision_maker(s) representing the shortlist's own client", async () => {
    const tables = seed({
      organization_memberships: [
        {
          user_id: CLIENT_1,
          organization_id: ORG,
          role: 'client_decision_maker',
          status: 'active',
          client_id: CLIENT_X,
        },
        {
          user_id: CLIENT_2,
          organization_id: ORG,
          role: 'client_decision_maker',
          status: 'active',
          client_id: CLIENT_OTHER,
        },
        { user_id: ADMIN_1, organization_id: ORG, role: 'agency_admin', status: 'active' },
      ],
    })
    const supabase = createFakeSupabase(tables)

    const result = await notifyShortlistAwaitingClientDecision({
      organizationId: ORG,
      actorUserId: ACTOR,
      shortlistId: RES_1,
      clientId: CLIENT_X,
      jobTitle: 'Store Manager',
      supabase,
    })
    expect(result.map((r) => r.job.payload.recipientUserId)).toEqual([CLIENT_1])
  })
})

describe('notifyIntegrationFailed', () => {
  it('notifies only agency_admin/platform_admin, never a recruiter (mirrors integration_connections RLS)', async () => {
    const tables = seed({
      organization_memberships: [
        { user_id: ADMIN_1, organization_id: ORG, role: 'agency_admin', status: 'active' },
        { user_id: RECRUITER_1, organization_id: ORG, role: 'recruiter', status: 'active' },
      ],
    })
    const supabase = createFakeSupabase(tables)

    const result = await notifyIntegrationFailed({
      organizationId: ORG,
      actorUserId: ACTOR,
      integrationConnectionId: RES_1,
      provider: 'apollo',
      errorMessage: 'Apollo is not configured.',
      supabase,
    })
    expect(result.map((r) => r.job.payload.recipientUserId)).toEqual([ADMIN_1])
  })
})

describe('cross-tenant isolation', () => {
  it("never resolves a recipient from a different organization's membership rows", async () => {
    const tables = seed({
      organization_memberships: [
        { user_id: ADMIN_1, organization_id: OTHER_ORG, role: 'agency_admin', status: 'active' },
      ],
    })
    const supabase = createFakeSupabase(tables)

    const result = await notifyIntegrationFailed({
      organizationId: ORG,
      actorUserId: ACTOR,
      integrationConnectionId: RES_1,
      provider: 'apollo',
      errorMessage: 'boom',
      supabase,
    })
    expect(result).toHaveLength(0)
  })
})
