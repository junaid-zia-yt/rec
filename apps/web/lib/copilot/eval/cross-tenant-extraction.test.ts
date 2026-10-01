import { describe, expect, it } from 'vitest'
import { assertResourceOwnership, ResourceOwnershipError } from '../resource-ownership'
import { runCopilotTurn } from '../orchestration/run-copilot-turn'
import { TestCopilotProvider } from '../orchestration/copilot-test-provider'
import { createFakeSupabase } from '../orchestration/test-fake-supabase'
import { baseParams, baseSeed, CONVERSATION, ORG_A, ORG_B, PROJECT, USER } from './fixtures'

/**
 * Build Phase 11, Wave 5 — EVALUATION item 2 (governing brief: "cross-tenant
 * extraction attempts").
 *
 * LAYERING, STATED EXPLICITLY (per the task brief's own instruction): this
 * file proves cross-tenant isolation at the APPLICATION layer only, using
 * the in-memory fake Supabase (no live Postgres/RLS exists in this
 * environment). The DB-layer proof for the identical guarantee — that a
 * cross-org `SELECT`/`INSERT` against every one of the eight `copilot_*`
 * tables plus the `metric_definitions`-style pattern is rejected under REAL
 * Postgres Row Level Security, with actual role-switched sessions — is
 * `scripts/verify_candidates.sql`'s TEST17 block (0031_copilot.sql's own RLS
 * policies), re-confirmed fresh for this wave (§4 of
 * docs/build-phase-11-report.md). Neither layer alone is the whole
 * guarantee: RLS is the backstop if application code is ever wrong, and
 * `assertResourceOwnership`/`runCopilotTurn`'s own re-checks are what
 * actually produce a clean, typed `CopilotTurnOutcome` denial rather than a
 * raw RLS empty-result silently misread as "not found" vs. "not allowed".
 */

describe('EVALUATION — cross-tenant extraction attempts (application layer; see file header for the DB-layer cross-reference)', () => {
  it("assertResourceOwnership denies a resourceId that belongs to a DIFFERENT organization than the caller's own, even though the row exists", async () => {
    // A recruitment_project seeded under ORG_B; the caller is authenticated
    // into ORG_A and attempts to address a tool call at ORG_B's project id
    // directly (e.g. an id guessed, leaked, or replayed from another
    // tenant's URL/response).
    const supabase = createFakeSupabase({
      recruitment_projects: [
        { id: PROJECT, organization_id: ORG_B, client_id: 'client-b', role_title: 'Store Manager' },
      ],
      project_assignments: [],
    })
    await expect(
      assertResourceOwnership(supabase, {
        organizationId: ORG_A,
        userId: USER,
        role: 'recruiter',
        resourceType: 'recruitment_project',
        resourceId: PROJECT,
      }),
    ).rejects.toThrow(ResourceOwnershipError)
  })

  it("assertResourceOwnership denies even an org-wide role (agency_admin) reaching into another organization's candidate", async () => {
    // Proves the org-mismatch check is not merely a recruiter-assignment
    // check that a broader role would skip past — the FIRST gate every
    // resourceType branch applies is `record.organization_id !== callerOrg`,
    // before any role-specific branch runs at all (resource-ownership.ts).
    const supabase = createFakeSupabase({ candidates: [{ id: 'cand-1', organization_id: ORG_B }] })
    await expect(
      assertResourceOwnership(supabase, {
        organizationId: ORG_A,
        userId: USER,
        role: 'agency_admin',
        resourceType: 'candidate',
        resourceId: 'cand-1',
      }),
    ).rejects.toThrow(ResourceOwnershipError)
  })

  it("a full runCopilotTurn cannot be driven to leak another organization's data by supplying that org's conversation id — the conversation load itself is scoped by organization_id", async () => {
    // Defense in depth beyond a single resource-ownership check: the very
    // FIRST thing `runCopilotTurn` does is load the conversation row scoped
    // to `.eq('organization_id', organizationId)` (run-copilot-turn.ts's
    // `loadConversation`) — a conversation that belongs to a different org
    // is treated identically to "does not exist", never partially loaded.
    const seed = baseSeed({
      organization_memberships: [
        { organization_id: ORG_A, user_id: USER, role: 'recruiter', status: 'active' },
      ],
      // The conversation row itself belongs to ORG_B, not ORG_A.
      copilot_conversations: [
        {
          id: CONVERSATION,
          organization_id: ORG_B,
          user_id: USER,
          role_at_creation: 'recruiter',
          client_id: null,
          recruitment_project_id: PROJECT,
          data_classification: 'standard',
          status: 'active',
        },
      ],
    })
    const provider = new TestCopilotProvider({ mode: 'success' })
    const result = await runCopilotTurn(baseParams(seed, provider))
    expect(result.status).toBe('permission_narrowed_since_conversation_start')
    // No message, no tool call, no data of any kind was persisted or
    // returned for this cross-tenant attempt.
    expect(seed.copilot_messages!).toHaveLength(0)
    expect(seed.copilot_tool_calls!).toHaveLength(0)
  })

  it("a project-scoped conversation whose project has since moved out of the caller's reachable org fails safe (not silently ignored)", async () => {
    const seed = baseSeed({
      // The conversation row is legitimately in ORG_A, but the project it
      // points at is seeded under ORG_B (simulating org data ever being
      // inconsistent, or an attempted resourceId swap after creation).
      recruitment_projects: [
        {
          id: PROJECT,
          organization_id: ORG_B,
          client_id: 'client-b',
          role_title: 'Store Manager',
          status: 'active',
          is_poc: false,
          target_shortlist_size: 3,
          match_threshold: 70,
        },
      ],
    })
    const provider = new TestCopilotProvider({ mode: 'success' })
    const result = await runCopilotTurn(baseParams(seed, provider))
    expect(result.status).toBe('permission_narrowed_since_conversation_start')
  })
})
