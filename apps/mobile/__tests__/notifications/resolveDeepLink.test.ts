import { resolveNotificationDeepLink } from '@/lib/notifications/resolveDeepLink'
import { createFakeSupabase } from '../test-utils/supabaseMock'

/**
 * Direct, unmocked tests of the deep-link resolver's own logic — a
 * "scoped substitute" for a full multi-screen navigation render (see
 * __tests__/navigation/RootNavigator.test.tsx's header comment): this
 * exercises the actual typed navigation TARGET a tapped notification
 * resolves to, including the multi-hop lookups (verification_request →
 * candidate_role_match → candidate, scorecard_version → scorecard → job →
 * project), which NotificationsScreen.test.tsx does not cover since it
 * mocks this module out entirely.
 */
describe('resolveNotificationDeepLink', () => {
  it('resolves a candidate_role_match notification straight to CandidateEvaluation', async () => {
    const supabase = createFakeSupabase({
      candidate_role_matches: { data: { candidate_id: 'cand-1' }, error: null },
    })

    const target = await resolveNotificationDeepLink(supabase, 'candidate_role_match', 'match-1')

    expect(target).toEqual({
      tab: 'PipelineTab',
      screen: 'CandidateEvaluation',
      params: { candidateId: 'cand-1' },
    })
  })

  it('resolves an outreach_message notification to OutreachApproval', async () => {
    const supabase = createFakeSupabase({
      outreach_messages: { data: { candidate_id: 'cand-2' }, error: null },
    })

    const target = await resolveNotificationDeepLink(supabase, 'outreach_message', 'msg-1')

    expect(target).toEqual({
      tab: 'ProjectsTab',
      screen: 'OutreachApproval',
      params: { candidateId: 'cand-2' },
    })
  })

  it('resolves a shortlist notification directly by id, with no lookup needed', async () => {
    const supabase = createFakeSupabase({})

    const target = await resolveNotificationDeepLink(supabase, 'shortlist', 'sl-1')

    expect(target).toEqual({
      tab: 'ShortlistsTab',
      screen: 'FinalShortlist',
      params: { shortlistId: 'sl-1' },
    })
  })

  it('resolves a two-hop verification_request notification (request -> match -> candidate) to EvidenceReview', async () => {
    const supabase = createFakeSupabase({
      verification_requests: { data: { candidate_role_match_id: 'match-1' }, error: null },
      candidate_role_matches: { data: { candidate_id: 'cand-3' }, error: null },
    })

    const target = await resolveNotificationDeepLink(supabase, 'verification_request', 'req-1')

    expect(target).toEqual({
      tab: 'ProjectsTab',
      screen: 'EvidenceReview',
      params: { candidateId: 'cand-3' },
    })
  })

  it('resolves a three-hop scorecard_version notification (version -> scorecard -> job -> project) to JobScorecard', async () => {
    const supabase = createFakeSupabase({
      scorecard_versions: { data: { scorecard_id: 'sc-1' }, error: null },
      scorecards: { data: { job_id: 'job-1' }, error: null },
      jobs: { data: { recruitment_project_id: 'proj-1' }, error: null },
    })

    const target = await resolveNotificationDeepLink(supabase, 'scorecard_version', 'ver-1')

    expect(target).toEqual({
      tab: 'ProjectsTab',
      screen: 'JobScorecard',
      params: { projectId: 'proj-1', scorecardId: 'sc-1' },
    })
  })

  it('falls back to null (never throws) when a multi-hop lookup comes back empty — access may have changed since the notification was sent', async () => {
    const supabase = createFakeSupabase({
      verification_requests: { data: null, error: null },
    })

    const target = await resolveNotificationDeepLink(
      supabase,
      'verification_request',
      'req-missing',
    )

    expect(target).toBeNull()
  })

  it('falls back to null for a resource_type with no mapped mobile screen yet (integration_connection)', async () => {
    const supabase = createFakeSupabase({})

    const target = await resolveNotificationDeepLink(supabase, 'integration_connection', 'conn-1')

    expect(target).toBeNull()
  })

  it('falls back to null gracefully (never throws) when the lookup query itself fails', async () => {
    const supabase = createFakeSupabase({
      outreach_messages: () => {
        throw new Error('network blip')
      },
    })

    const target = await resolveNotificationDeepLink(supabase, 'outreach_message', 'msg-err')

    expect(target).toBeNull()
  })

  it('returns null for a null resourceType or resourceId', async () => {
    const supabase = createFakeSupabase({})

    expect(await resolveNotificationDeepLink(supabase, null, 'x')).toBeNull()
    expect(await resolveNotificationDeepLink(supabase, 'shortlist', null)).toBeNull()
  })
})
