import { render, screen, waitFor } from '@testing-library/react-native'
import type { Role } from '@rqi/types'
import { CandidateEvaluationScreen } from '@/screens/pipeline/CandidateEvaluationScreen'
import { OutreachApprovalScreen } from '@/screens/projects/OutreachApprovalScreen'
import { FinalShortlistScreen } from '@/screens/shortlists/FinalShortlistScreen'
import { ClientDecisionScreen } from '@/screens/shortlists/ClientDecisionScreen'
import { createFakeSupabase } from '../test-utils/supabaseMock'

/**
 * Permission tests for the brief's four highest-stakes mobile actions:
 * Candidate evaluation's gate override, Outreach approval's decision
 * buttons, Final shortlist's internal approval, and Client decision's
 * accept/discuss/reject. Every screen already gates its action UI through
 * the real `hasPermission`/`permissionLevel` matrix from `@rqi/types`
 * (screens/**.tsx import `hasPermission` directly, verified by reading
 * each file) — these tests exercise that REAL matrix per role, asserting
 * the action UI is not merely disabled but entirely ABSENT for a role
 * without the permission, matching this codebase's established pattern
 * (`{canX && <Button>...}`, not `disabled={!canX}`).
 */

jest.mock('@/lib/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'user-1' },
    session: null,
    loading: false,
    supabaseConfigured: true,
    signOut: jest.fn(),
  }),
}))

const mockGetSupabaseClient = jest.fn()
jest.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: () => mockGetSupabaseClient(),
}))

jest.mock('@/lib/api/client', () => {
  const actual = jest.requireActual('@/lib/api/client')
  return {
    ...actual,
    submitGateOverride: jest.fn(),
    approveOutreachMessage: jest.fn(),
    approveShortlistInternally: jest.fn(),
    submitShortlistClientDecision: jest.fn(),
  }
})

function membershipRoute(role: Role, clientId: string | null = null) {
  return {
    data: [
      { organization_id: 'org-1', role, status: 'active', is_default: true, client_id: clientId },
    ],
    error: null,
  }
}

const ALL_ROLES: Role[] = [
  'platform_admin',
  'agency_admin',
  'recruiter',
  'client_decision_maker',
  'read_only_reviewer',
]

beforeEach(() => {
  mockGetSupabaseClient.mockReset()
})

describe('CandidateEvaluationScreen — gate override visibility by role (human_reviews:update)', () => {
  const MATCH_ROW = {
    id: 'match-1',
    job_id: 'job-1',
    latest_matching_run_id: 'run-1',
    eligibility: 'ineligible',
    overall_score: 40,
    evidence_coverage_pct: 50,
    data_completeness_pct: 60,
    confidence: 0.5,
    review_status: 'pending',
    jobs: { title: 'Store Supervisor' },
  }
  const GATE_ROW = {
    id: 'gate-1',
    requirement_id: 'req-1',
    requirement_name: 'Valid driver license',
    state: 'unknown',
    ai_suggested_result: null,
    ai_suggestion_note: null,
    risk_notes: [],
    override_result: null,
    override_reason: null,
    override_evidence_note: null,
  }

  it.each(ALL_ROLES)('role=%s', async (role) => {
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({
        organization_memberships: membershipRoute(role),
        candidates: { data: { full_name: 'Jamie Rivera' }, error: null },
        candidate_role_matches: { data: [MATCH_ROW], error: null },
        mandatory_gate_results: { data: [GATE_ROW], error: null },
      }),
    )

    render(
      <CandidateEvaluationScreen
        navigation={{} as never}
        route={
          {
            key: 'CandidateEvaluation',
            name: 'CandidateEvaluation',
            params: { candidateId: 'cand-1' },
          } as never
        }
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('Jamie Rivera')).toBeTruthy()
    })

    const canReview = role === 'agency_admin' || role === 'recruiter'
    if (canReview) {
      expect(screen.getByText('Override')).toBeTruthy()
    } else {
      expect(screen.queryByText('Override')).toBeNull()
    }
  })
})

describe('OutreachApprovalScreen — approve/reject/request-changes visibility by role (outreach:update)', () => {
  const MESSAGE_ROW = {
    id: 'msg-1',
    channel: 'email',
    status: 'awaiting_approval',
    subject: 'Exciting Store Supervisor opportunity',
    draft_body: 'Hi Jamie, given your experience managing multi-unit teams...',
    generated_by: 'ai',
    edited_by_human: false,
    personalization_evidence: [{ excerpt: 'Managed a team of 12.' }],
  }

  it.each(ALL_ROLES)('role=%s', async (role) => {
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({
        organization_memberships: membershipRoute(role),
        candidates: { data: { full_name: 'Jamie Rivera' }, error: null },
        outreach_messages: { data: MESSAGE_ROW, error: null },
      }),
    )

    render(
      <OutreachApprovalScreen
        navigation={{} as never}
        route={
          {
            key: 'OutreachApproval',
            name: 'OutreachApproval',
            params: { candidateId: 'cand-1' },
          } as never
        }
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('Jamie Rivera')).toBeTruthy()
    })

    const canDecide = role === 'agency_admin' || role === 'recruiter'
    if (canDecide) {
      expect(screen.getByText('Approve')).toBeTruthy()
      expect(screen.getByText('Reject')).toBeTruthy()
    } else {
      expect(screen.queryByText('Approve')).toBeNull()
      expect(screen.queryByText('Reject')).toBeNull()
    }
  })
})

describe('FinalShortlistScreen — internal approval visibility by role (shortlists:update)', () => {
  const ROUTES_BASE = {
    shortlists: {
      data: [
        {
          id: 'sl-1',
          recruitment_project_id: 'proj-1',
          job_id: 'job-1',
          client_id: 'client-1',
          status: 'pending_internal_approval',
          max_candidates: 3,
          jobs: { title: 'Store Supervisor' },
          clients: { name: 'Acme Retail' },
        },
      ],
      error: null,
    },
    shortlist_versions: { data: [{ id: 'sv-1', status: 'submitted' }], error: null },
    shortlist_candidates: {
      data: [
        {
          id: 'sc-1',
          candidate_id: 'cand-1',
          candidate_role_match_id: 'match-1',
          rank: 1,
          recruiter_note: null,
          candidates: { full_name: 'Jamie Rivera' },
          candidate_role_matches: {
            overall_score: 88,
            evidence_coverage_pct: 92,
            data_completeness_pct: 95,
          },
        },
      ],
      error: null,
    },
    mandatory_gate_results: {
      data: [{ candidate_role_match_id: 'match-1', state: 'passed', override_result: null }],
      error: null,
    },
  }

  it.each(ALL_ROLES)('role=%s', async (role) => {
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({ organization_memberships: membershipRoute(role), ...ROUTES_BASE }),
    )

    render(
      <FinalShortlistScreen
        navigation={{} as never}
        route={
          {
            key: 'FinalShortlist',
            name: 'FinalShortlist',
            params: { shortlistId: 'sl-1' },
          } as never
        }
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('Jamie Rivera')).toBeTruthy()
    })

    // Only agency_admin/recruiter hold 'full' on `shortlists`, which grants
    // the update action; client_decision_maker's 'approve' level explicitly
    // excludes update (client sign-off is a separate, later action).
    const canApproveInternally = role === 'agency_admin' || role === 'recruiter'
    if (canApproveInternally) {
      expect(screen.getByText('Record internal approval')).toBeTruthy()
    } else {
      expect(screen.queryByText('Record internal approval')).toBeNull()
    }
  })
})

describe('ClientDecisionScreen — accept/discuss/reject visibility by role (shortlists:approve)', () => {
  const ROUTES_BASE = {
    shortlists: {
      data: [
        {
          id: 'sl-1',
          recruitment_project_id: 'proj-1',
          job_id: 'job-1',
          client_id: 'client-1',
          status: 'sent_to_client',
          max_candidates: 3,
          jobs: { title: 'Store Supervisor' },
          clients: { name: 'Acme Retail' },
        },
      ],
      error: null,
    },
    shortlist_versions: { data: [{ id: 'sv-1', status: 'sent_to_client' }], error: null },
    shortlist_candidates: {
      data: [
        {
          id: 'sc-1',
          candidate_id: 'cand-1',
          candidate_role_match_id: 'match-1',
          rank: 1,
          recruiter_note: null,
          candidates: { full_name: 'Jamie Rivera' },
          candidate_role_matches: {
            overall_score: 88,
            evidence_coverage_pct: 92,
            data_completeness_pct: 95,
          },
        },
      ],
      error: null,
    },
    mandatory_gate_results: {
      data: [{ candidate_role_match_id: 'match-1', state: 'passed', override_result: null }],
      error: null,
    },
  }

  it.each(ALL_ROLES)('role=%s', async (role) => {
    mockGetSupabaseClient.mockReturnValue(
      createFakeSupabase({
        organization_memberships: membershipRoute(
          role,
          role === 'client_decision_maker' ? 'client-1' : null,
        ),
        ...ROUTES_BASE,
      }),
    )

    render(
      <ClientDecisionScreen
        navigation={{} as never}
        route={
          {
            key: 'ClientDecision',
            name: 'ClientDecision',
            params: { shortlistId: 'sl-1' },
          } as never
        }
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('Jamie Rivera')).toBeTruthy()
    })

    // Only client_decision_maker holds the 'approve' level on `shortlists`;
    // agency_admin/recruiter's 'full' level explicitly EXCLUDES the approve
    // action (`hasPermission`'s 'full' branch returns false for 'approve')
    // — the client-facing decision is deliberately not an internal-role action.
    const canDecide = role === 'client_decision_maker'
    if (canDecide) {
      expect(screen.getByText('Accept')).toBeTruthy()
      expect(screen.getByText('Reject')).toBeTruthy()
      expect(screen.getByText('Discuss')).toBeTruthy()
    } else {
      expect(screen.queryByText('Accept')).toBeNull()
      expect(screen.queryByText('Reject')).toBeNull()
      expect(screen.queryByText('Discuss')).toBeNull()
      expect(screen.getByText('You have read-only access to this shortlist.')).toBeTruthy()
    }
  })
})
