import { createFakeSupabase, type FakeSupabaseSeed } from '../orchestration/test-fake-supabase'
import type { CopilotConversationProvider } from '../orchestration/run-copilot-turn'

/**
 * Build Phase 11, Wave 5 — shared fixture builders for the adversarial
 * evaluation suite (`apps/web/lib/copilot/eval/*.test.ts`). Deliberately
 * mirrors `run-copilot-turn.test.ts`'s own `baseSeed`/`baseParams`
 * conventions (same `PROJECT` UUID, same shape) rather than inventing a
 * parallel fixture style — every eval test in this directory is exercising
 * the SAME orchestration code that file's own tests already exercise, just
 * under adversarial rather than happy-path conditions.
 *
 * Two organizations are pre-wired here (`ORG_A`/`ORG_B`) specifically for
 * the cross-tenant-extraction tests (`cross-tenant-extraction.test.ts`),
 * which no single-org fixture set could otherwise express.
 */

export const ORG_A = 'org-a'
export const ORG_B = 'org-b'
export const USER = 'user-1'
// `sampleInputFor` (copilot-test-provider.ts) always fills a tool's id
// parameter with this fixed UUID regardless of which tool a scenario calls
// — every seeded resource id a `TestCopilotProvider` scenario might address
// a tool call at must match it, exactly as run-copilot-turn.test.ts documents.
export const PROJECT = '00000000-0000-0000-0000-000000000001'
export const JOB = '00000000-0000-0000-0000-000000000001'
export const CANDIDATE = '00000000-0000-0000-0000-000000000001'
export const CANDIDATE_ROLE_MATCH = '00000000-0000-0000-0000-000000000001'
export const SHORTLIST = '00000000-0000-0000-0000-000000000001'
export const POC_BENCHMARK = '00000000-0000-0000-0000-000000000001'
export const CLIENT_A = 'client-a'
export const CLIENT_B = 'client-b'
export const CONVERSATION = 'conv-1'

export function baseSeed(overrides: Partial<FakeSupabaseSeed> = {}): FakeSupabaseSeed {
  return {
    organization_memberships: [
      { organization_id: ORG_A, user_id: USER, role: 'recruiter', status: 'active' },
    ],
    copilot_conversations: [
      {
        id: CONVERSATION,
        organization_id: ORG_A,
        user_id: USER,
        role_at_creation: 'recruiter',
        client_id: null,
        recruitment_project_id: PROJECT,
        data_classification: 'standard',
        status: 'active',
      },
    ],
    recruitment_projects: [
      {
        id: PROJECT,
        organization_id: ORG_A,
        client_id: CLIENT_A,
        role_title: 'Store Manager',
        status: 'active',
        is_poc: false,
        target_shortlist_size: 3,
        match_threshold: 70,
      },
    ],
    clients: [{ id: CLIENT_A, organization_id: ORG_A, name: 'Acme Retail' }],
    project_assignments: [{ id: 'pa-1', user_id: USER, recruitment_project_id: PROJECT }],
    jobs: [],
    job_requirements: [],
    scorecards: [],
    scorecard_versions: [],
    candidates: [],
    candidate_project_entries: [],
    candidate_role_matches: [],
    shortlists: [],
    shortlist_versions: [],
    shortlist_candidates: [],
    mandatory_gate_results: [],
    copilot_messages: [],
    copilot_tool_calls: [],
    copilot_usage_counters: [],
    ai_runs: [],
    audit_events: [],
    ...overrides,
  }
}

export function baseParams(
  seed: FakeSupabaseSeed,
  provider: CopilotConversationProvider,
  extra: Record<string, unknown> = {},
) {
  return {
    conversationId: CONVERSATION,
    userMessage: 'How is this project going?',
    supabase: createFakeSupabase(seed),
    userId: USER,
    organizationId: ORG_A,
    currentRole: 'recruiter' as const,
    provider,
    ...extra,
  }
}

export { createFakeSupabase, type FakeSupabaseSeed }
