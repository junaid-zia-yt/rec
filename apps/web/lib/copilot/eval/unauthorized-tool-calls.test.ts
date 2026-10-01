import { describe, expect, it, vi } from 'vitest'
import { runCopilotTurn, type CopilotConversationProvider } from '../orchestration/run-copilot-turn'
import * as toolRegistryModule from '../tool-registry'
import { baseParams, baseSeed, CLIENT_A, CONVERSATION, ORG_A } from './fixtures'

/**
 * Build Phase 11, Wave 5 — EVALUATION item 5 (governing brief: "unauthorized
 * tool calls"). `client_decision_maker` attempting a recruiter-only tool
 * (`draft_outreach_message`) specifically — wave 3's own flagged gap
 * ("role-boundary combinations not yet exercised... client_decision_maker
 * attempting a recruiter-only tool specifically"), in addition to the
 * existing `explain_scorecard` case `run-copilot-turn.test.ts` already
 * covers.
 */
describe('EVALUATION — unauthorized tool calls are denied before the handler ever runs', () => {
  it('client_decision_maker attempting draft_outreach_message (a STAFF_ROLES-only tool, never offered to clients at all) is denied before the handler runs, and the handler spy is never invoked', async () => {
    const handlerSpy = vi.spyOn(toolRegistryModule.TOOL_REGISTRY.draft_outreach_message, 'handler')

    const seed = baseSeed({
      organization_memberships: [
        {
          organization_id: ORG_A,
          user_id: 'user-1',
          role: 'client_decision_maker',
          status: 'active',
          client_id: CLIENT_A,
        },
      ],
      copilot_conversations: [
        {
          id: CONVERSATION,
          organization_id: ORG_A,
          user_id: 'user-1',
          role_at_creation: 'client_decision_maker',
          client_id: CLIENT_A,
          recruitment_project_id: '00000000-0000-0000-0000-000000000001',
          data_classification: 'restricted_notes_excluded',
          status: 'active',
        },
      ],
    })

    // A custom provider that always attempts draft_outreach_message
    // regardless of what tools it was actually offered (client_decision_maker
    // is never offered it — tool-registry.ts's STAFF_ROLES) — simulating a
    // hallucinating or adversarially-steered model, the same class of attack
    // `TestCopilotProvider`'s `unauthorized_tool_attempt` mode models, but
    // targeting this SPECIFIC recruiter-only tool by name rather than
    // explain_scorecard.
    const provider: CopilotConversationProvider = {
      name: 'draft-outreach-attempt',
      async runConversationTurn(params) {
        const result = await params.executeTool('draft_outreach_message', {
          candidateRoleMatchId: '00000000-0000-0000-0000-000000000001',
          channel: 'email',
        })
        return {
          status: 'terminal_denied',
          model: 'draft-outreach-attempt',
          finalRaw: null,
          toolCallsExecuted: [],
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          iterations: 1,
          terminalReason: result.terminal?.reason,
        }
      },
    }

    const result = await runCopilotTurn(
      baseParams(seed, provider, { currentRole: 'client_decision_maker' }),
    )

    expect(result.status).toBe('unauthorized_tool_attempt')
    if (result.status === 'unauthorized_tool_attempt')
      expect(result.toolName).toBe('draft_outreach_message')
    expect(handlerSpy).not.toHaveBeenCalled()

    // Persisted denial row, with the true attempted tool name recorded in
    // denial_reason even though the CHECK-allowlisted column itself cannot
    // literally store "draft_outreach_message" as a denial against a
    // disallowed role in a way that would misrepresent it — see
    // run-copilot-turn.ts's own comment on this row's `tool_name` field.
    expect(seed.copilot_tool_calls!).toHaveLength(1)
    expect(seed.copilot_tool_calls![0]!.denied).toBe(true)
    expect(seed.copilot_tool_calls![0]!.resource_ownership_validated).toBe(false)
    expect(String(seed.copilot_tool_calls![0]!.denial_reason)).toContain('draft_outreach_message')

    // The required audit trail entry.
    expect(
      seed.audit_events!.some(
        (e) =>
          e.action === 'copilot.unauthorized_tool_attempt' &&
          (e.metadata as { toolName?: string })?.toolName === 'draft_outreach_message',
      ),
    ).toBe(true)

    handlerSpy.mockRestore()
  })

  it("a real registry tool is not even OFFERED to a role outside its allowedRoles (the model is never told it exists) — client_decision_maker's tool list omits every STAFF_ROLES-only tool", async () => {
    const { isToolAllowedForRole } = await import('../tool-registry')
    const staffOnlyTools = [
      'explain_scorecard',
      'find_missing_job_requirements',
      'summarize_candidate',
      'identify_missing_evidence',
      'draft_verification_questions',
      'draft_interview_questions',
      'draft_outreach_message',
      'summarize_candidate_responses',
    ] as const
    for (const tool of staffOnlyTools) {
      expect(isToolAllowedForRole(tool, 'client_decision_maker')).toBe(false)
    }
  })
})
