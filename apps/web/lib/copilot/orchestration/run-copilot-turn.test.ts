import { describe, expect, it } from 'vitest'
import { createFakeSupabase, type FakeSupabaseSeed } from './test-fake-supabase'
import { runCopilotTurn } from './run-copilot-turn'
import { TestCopilotProvider } from './copilot-test-provider'

/**
 * Build Phase 11, Wave 3 — integration-style tests for `runCopilotTurn`.
 * Every test here uses the deterministic `TestCopilotProvider`
 * (copilot-test-provider.ts) — no live network call is ever made, and
 * `anthropicConfigured` is false in this environment regardless (see
 * `not_configured` test below, which exercises the real gate with no
 * injected provider at all).
 *
 * These tests exercise the FULL orchestration logic — authorization,
 * persistence, evidence validation — through the real `runCopilotTurn`
 * code path, only substituting the "model" itself.
 */

const ORG = 'org-1'
const USER = 'user-1'
// `sampleInputFor` (copilot-test-provider.ts) always fills a tool's id
// parameter with this same fixed UUID regardless of which tool a scenario
// calls — the fake Supabase (test-fake-supabase.ts) applies real `.eq()`
// filtering, unlike a live model that would receive whatever id a prior
// tool result actually returned, so every seeded resource id a
// `TestCopilotProvider` scenario might address a tool call at must match it.
const PROJECT = '00000000-0000-0000-0000-000000000001'
const CLIENT = 'client-1'
const CONVERSATION = 'conv-1'

function baseSeed(overrides: Partial<FakeSupabaseSeed> = {}): FakeSupabaseSeed {
  return {
    organization_memberships: [
      { organization_id: ORG, user_id: USER, role: 'recruiter', status: 'active' },
    ],
    copilot_conversations: [
      {
        id: CONVERSATION,
        organization_id: ORG,
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
        organization_id: ORG,
        client_id: CLIENT,
        role_title: 'Store Manager',
        status: 'active',
        is_poc: false,
        target_shortlist_size: 3,
        match_threshold: 70,
      },
    ],
    clients: [{ id: CLIENT, organization_id: ORG, name: 'Acme Retail' }],
    project_assignments: [{ id: 'pa-1', user_id: USER, recruitment_project_id: PROJECT }],
    jobs: [],
    job_requirements: [],
    scorecards: [],
    candidate_role_matches: [],
    shortlists: [],
    copilot_messages: [],
    copilot_tool_calls: [],
    copilot_usage_counters: [],
    ai_runs: [],
    audit_events: [],
    ...overrides,
  }
}

function baseParams(
  seed: FakeSupabaseSeed,
  provider: TestCopilotProvider,
  extra: Record<string, unknown> = {},
) {
  return {
    conversationId: CONVERSATION,
    userMessage: 'How is this project going?',
    supabase: createFakeSupabase(seed),
    userId: USER,
    organizationId: ORG,
    currentRole: 'recruiter' as const,
    provider,
    ...extra,
  }
}

describe('runCopilotTurn — not_configured', () => {
  it('returns not_configured and never calls the model when no provider is supplied and Anthropic is not configured', async () => {
    const seed = baseSeed()
    const result = await runCopilotTurn({
      conversationId: CONVERSATION,
      userMessage: 'Hi',
      supabase: createFakeSupabase(seed),
      userId: USER,
      organizationId: ORG,
      currentRole: 'recruiter',
    })
    expect(result.status).toBe('not_configured')
    // The user's message is still persisted first, even on this path... no
    // — not_configured is detected AFTER message persistence in this
    // implementation, so assert it exists.
    expect(seed.copilot_messages!).toHaveLength(1)
    expect(seed.ai_runs!).toHaveLength(0)
  })
})

describe('runCopilotTurn — permission_narrowed_since_conversation_start', () => {
  it('fails safe when the caller no longer has an active membership', async () => {
    const seed = baseSeed({ organization_memberships: [] })
    const provider = new TestCopilotProvider({ mode: 'success' })
    const result = await runCopilotTurn(baseParams(seed, provider))
    expect(result.status).toBe('permission_narrowed_since_conversation_start')
  })

  it('fails safe when the live role no longer matches role_at_creation', async () => {
    const seed = baseSeed({
      organization_memberships: [
        { organization_id: ORG, user_id: USER, role: 'agency_admin', status: 'active' },
      ],
    })
    const provider = new TestCopilotProvider({ mode: 'success' })
    const result = await runCopilotTurn(baseParams(seed, provider))
    expect(result.status).toBe('permission_narrowed_since_conversation_start')
  })

  it("fails safe when the caller is no longer assigned to the conversation's project", async () => {
    const seed = baseSeed({ project_assignments: [] })
    const provider = new TestCopilotProvider({ mode: 'success' })
    const result = await runCopilotTurn(baseParams(seed, provider))
    expect(result.status).toBe('permission_narrowed_since_conversation_start')
  })

  it('fails safe when the conversation does not exist / is not owned by the caller', async () => {
    const seed = baseSeed({ copilot_conversations: [] })
    const provider = new TestCopilotProvider({ mode: 'success' })
    const result = await runCopilotTurn(baseParams(seed, provider))
    expect(result.status).toBe('permission_narrowed_since_conversation_start')
  })
})

describe('runCopilotTurn — rate_limited', () => {
  it('blocks before any model call once the daily message limit is reached', async () => {
    const today = new Date().toISOString().slice(0, 10)
    const seed = baseSeed({
      copilot_usage_counters: [
        {
          id: 'usage-1',
          organization_id: ORG,
          user_id: USER,
          window_date: today,
          message_count: 200,
          rate_limited_count: 0,
          total_cost_usd: 0,
        },
      ],
    })
    const provider = new TestCopilotProvider({ mode: 'success' })

    const result = await runCopilotTurn(baseParams(seed, provider))
    expect(result.status).toBe('rate_limited')
    // No tool call and no ai_runs row were ever written — proof the model
    // was never reached.
    expect(seed.copilot_tool_calls!).toHaveLength(0)
    expect(seed.ai_runs!).toHaveLength(0)
    expect(seed.audit_events!.some((e) => e.action === 'copilot.rate_limited')).toBe(true)
  })
})

describe('runCopilotTurn — unauthorized_tool_attempt', () => {
  it('denies the tool BEFORE the handler runs and aborts the turn, without ever writing resource_ownership_validated: true', async () => {
    // recruiter has ALL 13 tools allowed (tool-registry.ts) — there is no
    // real tool name recruiter is denied, so this scenario uses a
    // client_decision_maker conversation instead, whose allowed subset
    // deliberately excludes explain_scorecard (tool-registry.ts's
    // documented reasoning). The test provider's 'unauthorized_tool_attempt'
    // script always tries explain_scorecard regardless of what `tools` it
    // was actually offered — simulating a hallucinating or adversarially
    // steered model, exactly the case run-copilot-turn.ts's executeTool
    // must not trust.
    const seed = baseSeed({
      organization_memberships: [
        {
          organization_id: ORG,
          user_id: USER,
          role: 'client_decision_maker',
          status: 'active',
          client_id: CLIENT,
        },
      ],
      copilot_conversations: [
        {
          id: CONVERSATION,
          organization_id: ORG,
          user_id: USER,
          role_at_creation: 'client_decision_maker',
          client_id: CLIENT,
          recruitment_project_id: PROJECT,
          data_classification: 'restricted_notes_excluded',
          status: 'active',
        },
      ],
    })
    const provider = new TestCopilotProvider({ mode: 'unauthorized_tool_attempt' })
    const result = await runCopilotTurn(
      baseParams(seed, provider, { currentRole: 'client_decision_maker' }),
    )
    expect(result.status).toBe('unauthorized_tool_attempt')
    if (result.status === 'unauthorized_tool_attempt') {
      expect(result.toolName).toBe('explain_scorecard')
    }
    expect(seed.copilot_tool_calls!).toHaveLength(1)
    expect(seed.copilot_tool_calls![0]!.denied).toBe(true)
    expect(seed.copilot_tool_calls![0]!.resource_ownership_validated).toBe(false)
    // The handler was never even called — no candidate/job data was ever
    // touched for this attempt, since the deny happens before the handler
    // runs at all (this is what makes the row's `output` stay null).
    expect(seed.copilot_tool_calls![0]!.output ?? null).toBeNull()
    expect(seed.audit_events!.some((e) => e.action === 'copilot.unauthorized_tool_attempt')).toBe(
      true,
    )
  })

  it('blocks every tool for a role with zero allowed tools (read_only_reviewer) — the same isToolAllowedForRole=false branch a nonexistent/hallucinated tool name would also hit', async () => {
    const seed = baseSeed({
      organization_memberships: [
        { organization_id: ORG, user_id: USER, role: 'read_only_reviewer', status: 'active' },
      ],
      copilot_conversations: [
        {
          id: CONVERSATION,
          organization_id: ORG,
          user_id: USER,
          role_at_creation: 'read_only_reviewer',
          client_id: null,
          recruitment_project_id: null,
          data_classification: 'standard',
          status: 'active',
        },
      ],
      project_assignments: [],
    })
    const provider = new TestCopilotProvider({ mode: 'unauthorized_tool_attempt' })
    const result = await runCopilotTurn(
      baseParams(seed, provider, { currentRole: 'read_only_reviewer' }),
    )
    expect(result.status).toBe('unauthorized_tool_attempt')
  })
})

describe('runCopilotTurn — success', () => {
  it('runs a tool, grounds its claim in a real citation, and persists a valid tool_call row', async () => {
    const JOB = '00000000-0000-0000-0000-000000000001'
    const seed = baseSeed({
      jobs: [
        {
          id: JOB,
          organization_id: ORG,
          recruitment_project_id: PROJECT,
          title: 'Store Manager',
          status: 'active',
        },
      ],
      job_requirements: [
        {
          id: 'req-1',
          organization_id: ORG,
          job_id: JOB,
          name: 'Reliability',
          description: 'desc',
          type: 'mandatory',
          weight: 1,
          evidence_expected: 'evidence',
          verification_status: 'verified',
        },
      ],
    })
    const provider = new TestCopilotProvider({ mode: 'success' })
    const result = await runCopilotTurn(baseParams(seed, provider))
    expect(result.status).toBe('success')
    if (result.status === 'success') {
      expect(result.citations.length).toBeGreaterThan(0)
      expect(result.unsupportedClaimsStripped).toBe(0)
    }
    expect(seed.copilot_tool_calls!).toHaveLength(1)
    expect(seed.copilot_tool_calls![0]!.output_validation_status).toBe('valid')
    expect(seed.copilot_tool_calls![0]!.resource_ownership_validated).toBe(true)
    expect(seed.ai_runs!).toHaveLength(1)
    expect(seed.ai_runs![0]!.status).toBe('success')
    expect(seed.ai_runs![0]!.workflow_type).toBe('copilot_response')
    // Assistant message persisted with the same citations.
    const assistantMessages = seed.copilot_messages!.filter((m) => m.role === 'assistant')
    expect(assistantMessages).toHaveLength(1)
  })
})

describe('runCopilotTurn — fabricated citation (simulated injection outcome)', () => {
  it('strips an unsupported/fabricated claim rather than trusting it, regardless of why the model produced it', async () => {
    const seed = baseSeed()
    const provider = new TestCopilotProvider({ mode: 'fabricates_citation' })
    const result = await runCopilotTurn(baseParams(seed, provider))
    expect(result.status).toBe('success')
    if (result.status === 'success') {
      expect(result.unsupportedClaimsStripped).toBe(1)
      expect(result.citations.some((c) => c.id === 'fabricated-id-not-from-any-tool-call')).toBe(
        false,
      )
      expect(result.text).toContain('could not be verified')
    }
  })
})

describe('runCopilotTurn — missing_citation', () => {
  it('logs copilot.citation_missing and appends a caveat when claims are empty despite citable records', async () => {
    const JOB = '00000000-0000-0000-0000-000000000001'
    const seed = baseSeed({
      jobs: [
        {
          id: JOB,
          organization_id: ORG,
          recruitment_project_id: PROJECT,
          title: 'Store Manager',
          status: 'active',
        },
      ],
      job_requirements: [
        {
          id: 'req-1',
          organization_id: ORG,
          job_id: JOB,
          name: 'Reliability',
          description: 'desc',
          type: 'mandatory',
          weight: 1,
          evidence_expected: 'evidence',
          verification_status: 'verified',
        },
      ],
    })
    const provider = new TestCopilotProvider({ mode: 'missing_citation' })
    const result = await runCopilotTurn(baseParams(seed, provider))
    expect(result.status).toBe('success')
    if (result.status === 'success') {
      expect(result.citationsCaveatApplied).toBe(true)
      expect(result.text).toContain('did not cite specific records')
    }
    expect(seed.audit_events!.some((e) => e.action === 'copilot.citation_missing')).toBe(true)
  })
})

describe('runCopilotTurn — validation_rejected', () => {
  it('rejects after the final structured response fails schema validation twice', async () => {
    const seed = baseSeed()
    const provider = new TestCopilotProvider({ mode: 'malformed_final_output' })
    const result = await runCopilotTurn(baseParams(seed, provider))
    expect(result.status).toBe('validation_rejected')
    expect(seed.ai_runs!).toHaveLength(1)
    expect(seed.ai_runs![0]!.status).toBe('rejected_by_validation')
  })

  it('rejects once the hard tool-call iteration budget is exhausted (runaway loop)', async () => {
    const seed = baseSeed()
    const provider = new TestCopilotProvider({ mode: 'runaway_loop' })
    const result = await runCopilotTurn(baseParams(seed, provider, { turnTimeoutMs: 5_000 }))
    expect(result.status).toBe('validation_rejected')
    // 8 tool calls executed (the hard cap), never more.
    expect(seed.copilot_tool_calls!.length).toBe(8)
  })
})

describe('runCopilotTurn — timeout', () => {
  it('returns a clean timeout state when the model never responds within the wall-clock budget', async () => {
    const seed = baseSeed()
    const provider = new TestCopilotProvider({ mode: 'timeout', delayMs: 200 })
    const result = await runCopilotTurn(baseParams(seed, provider, { turnTimeoutMs: 20 }))
    expect(result.status).toBe('timeout')
    expect(seed.ai_runs!).toHaveLength(1)
    expect(seed.ai_runs![0]!.status).toBe('error')
  })
})

describe('runCopilotTurn — cancelled', () => {
  it('returns a clean cancelled state, with a system_note recording what was in flight, when the caller aborts mid-turn', async () => {
    const seed = baseSeed()
    const controller = new AbortController()
    const provider = new TestCopilotProvider({
      mode: 'cancel_after_first_tool',
      cancelController: controller,
    })
    const result = await runCopilotTurn(
      baseParams(seed, provider, { signal: controller.signal, turnTimeoutMs: 5_000 }),
    )
    expect(result.status).toBe('cancelled')
    expect(
      seed.copilot_messages!.some(
        (m) => m.role === 'system_note' && String(m.content).includes('cancelled'),
      ),
    ).toBe(true)
  })
})

describe('runCopilotTurn — restricted_notes_excluded data classification', () => {
  it('still succeeds on a tool a client_decision_maker IS allowed to call (summarize_recruitment_project)', async () => {
    const seed = baseSeed({
      organization_memberships: [
        {
          organization_id: ORG,
          user_id: USER,
          role: 'client_decision_maker',
          status: 'active',
          client_id: CLIENT,
        },
      ],
      copilot_conversations: [
        {
          id: CONVERSATION,
          organization_id: ORG,
          user_id: USER,
          role_at_creation: 'client_decision_maker',
          client_id: CLIENT,
          recruitment_project_id: PROJECT,
          data_classification: 'restricted_notes_excluded',
          status: 'active',
        },
      ],
    })
    const provider = new TestCopilotProvider({ mode: 'timeout' }) // reuses the generic firstDomainTool script (no delayMs set, so it behaves like 'success' but calling whatever is first-allowed for this role).
    const result = await runCopilotTurn(
      baseParams(seed, provider, { currentRole: 'client_decision_maker', turnTimeoutMs: 5_000 }),
    )
    expect(result.status).toBe('success')
    expect(seed.copilot_tool_calls!).toHaveLength(1)
    expect(seed.copilot_tool_calls![0]!.tool_name).toBe('summarize_recruitment_project')
    expect(seed.copilot_tool_calls![0]!.output_validation_status).toBe('valid')
  })
})
