import 'server-only'
import {
  CopilotProviderError,
  createCopilotToolLoopRunner,
  SUBMIT_RESPONSE_TOOL_NAME,
  type CopilotConversationLoopResult,
  type CopilotProviderMessage,
  type CopilotProviderToolDefinition,
  type CopilotToolExecutor,
  type ModelCallResult,
} from './conversation-loop'

/**
 * Build Phase 11, Wave 3 — deterministic, offline test double for the
 * copilot conversation provider. Same never-silently-substitutes-for-a-
 * missing-key convention as `lib/ai/matching-test-adapter.ts` /
 * `lib/ai/outreach-draft-test-adapter.ts` — imported ONLY by test files
 * (grep for `TestCopilotProvider` outside a `.test.ts` file if that
 * invariant is ever in doubt).
 *
 * Built on the SAME `createCopilotToolLoopRunner` (conversation-loop.ts)
 * `AnthropicCopilotProvider` uses — this file only supplies a deterministic
 * `ModelCaller` "script" in place of a real Anthropic call, so a test using
 * this double exercises the real iterate-until-`submit_copilot_response`
 * loop, the real `executeTool` wiring, and (via `run-copilot-turn.ts`) the
 * real authorization/persistence/evidence-validation code — never a
 * parallel, simplified re-implementation of the orchestration logic.
 *
 * `mode` selects a fixed, named script (see the switch below), so a wave 5
 * adversarial test can request an exact scenario by name rather than
 * reverse-engineering provider behavior from prompt text.
 */
export type CopilotTestProviderMode =
  | 'success'
  | 'unauthorized_tool_attempt'
  | 'fabricates_citation'
  | 'missing_citation'
  | 'runaway_loop'
  | 'malformed_final_output'
  | 'provider_error'
  | 'timeout'
  | 'cancel_after_first_tool'

export class TestCopilotProvider {
  readonly name = 'test-adapter'
  private readonly runLoop: ReturnType<typeof createCopilotToolLoopRunner>
  private step = 0

  constructor(
    private readonly options: {
      mode: CopilotTestProviderMode
      delayMs?: number
      cancelController?: AbortController
    },
  ) {
    this.runLoop = createCopilotToolLoopRunner(async ({ messages, tools }) =>
      this.callModel(messages, tools),
    )
  }

  async runConversationTurn(params: {
    systemPrompt: string
    priorMessages: CopilotProviderMessage[]
    userMessage: string
    tools: CopilotProviderToolDefinition[]
    executeTool: CopilotToolExecutor
    maxToolIterations?: number
    signal?: AbortSignal
  }): Promise<CopilotConversationLoopResult> {
    this.step = 0
    return this.runLoop(params)
  }

  private async callModel(
    messages: CopilotProviderMessage[],
    tools: CopilotProviderToolDefinition[],
  ): Promise<ModelCallResult> {
    this.step += 1
    const { mode, delayMs } = this.options

    if (mode === 'provider_error') {
      throw new CopilotProviderError('The AI provider returned an error', 'provider_error')
    }

    if (mode === 'timeout' && delayMs) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }

    if (mode === 'cancel_after_first_tool' && this.step === 2) {
      this.options.cancelController?.abort()
    }

    const domainTools = tools.filter((t) => t.name !== SUBMIT_RESPONSE_TOOL_NAME)
    const firstDomainTool = domainTools[0]?.name ?? 'summarize_recruitment_project'

    const emptyResult = (): ModelCallResult => ({
      model: 'test-adapter-deterministic',
      contentBlocks: [],
      stopReason: 'other',
      inputTokens: 40,
      outputTokens: 5,
      costUsd: 0,
    })

    switch (mode) {
      case 'unauthorized_tool_attempt': {
        // A hallucinating or adversarially-steered model calling a tool
        // name it was never offered this conversation — `tools` is
        // deliberately IGNORED here on purpose, to prove run-copilot-turn's
        // executeTool wrapper blocks this BEFORE any wave-2 handler runs,
        // regardless of what the model claims it is allowed to do.
        if (this.step === 1) {
          return {
            model: 'test-adapter-deterministic',
            contentBlocks: [
              {
                type: 'tool_use',
                id: 'call-1',
                name: 'explain_scorecard',
                input: { jobId: '00000000-0000-0000-0000-000000000001' },
              },
            ],
            stopReason: 'tool_use',
            inputTokens: 40,
            outputTokens: 20,
            costUsd: 0,
          }
        }
        return emptyResult()
      }

      case 'runaway_loop': {
        // Always calls the same allowed tool again, never submits — proves
        // the hard iteration cap actually stops the loop.
        return {
          model: 'test-adapter-deterministic',
          contentBlocks: [
            {
              type: 'tool_use',
              id: `call-${this.step}`,
              name: firstDomainTool,
              input: sampleInputFor(firstDomainTool),
            },
          ],
          stopReason: 'tool_use',
          inputTokens: 40,
          outputTokens: 20,
          costUsd: 0,
        }
      }

      case 'malformed_final_output': {
        if (this.step === 1) {
          return {
            model: 'test-adapter-deterministic',
            contentBlocks: [
              {
                type: 'tool_use',
                id: 'submit-1',
                name: SUBMIT_RESPONSE_TOOL_NAME,
                input: { text: 123, claims: 'not-an-array' },
              },
            ],
            stopReason: 'tool_use',
            inputTokens: 40,
            outputTokens: 20,
            costUsd: 0,
          }
        }
        // The retry (run-copilot-turn.ts retries the whole turn once on a
        // schema-invalid final submission) still produces malformed output
        // deterministically, so the caller reliably observes
        // 'validation_rejected'.
        return {
          model: 'test-adapter-deterministic',
          contentBlocks: [
            {
              type: 'tool_use',
              id: 'submit-2',
              name: SUBMIT_RESPONSE_TOOL_NAME,
              input: { text: 456, claims: null },
            },
          ],
          stopReason: 'tool_use',
          inputTokens: 40,
          outputTokens: 20,
          costUsd: 0,
        }
      }

      case 'missing_citation': {
        if (this.step === 1) {
          // Deliberately calls explain_scorecard (which always returns one
          // citation per job_requirements row, unlike
          // summarize_recruitment_project's purely statistical summary) so
          // this scenario genuinely has citable authorized records
          // available for the "missing citation" check to react to.
          return {
            model: 'test-adapter-deterministic',
            contentBlocks: [
              {
                type: 'tool_use',
                id: `call-${this.step}`,
                name: 'explain_scorecard',
                input: sampleInputFor('explain_scorecard'),
              },
            ],
            stopReason: 'tool_use',
            inputTokens: 40,
            outputTokens: 20,
            costUsd: 0,
          }
        }
        // Makes a claim-shaped statement but reports zero citations even
        // though the prior tool call returned citable records — exercises
        // the soft "citation missing" retry-once path.
        return {
          model: 'test-adapter-deterministic',
          contentBlocks: [
            {
              type: 'tool_use',
              id: 'submit-1',
              name: SUBMIT_RESPONSE_TOOL_NAME,
              input: {
                text: 'This project has several eligible candidates ready to shortlist.',
                claims: [],
              },
            },
          ],
          stopReason: 'tool_use',
          inputTokens: 40,
          outputTokens: 20,
          costUsd: 0,
        }
      }

      case 'fabricates_citation': {
        // Simulates a model that has been steered (e.g. by injected text
        // inside a tool result it was just given — the injected payload
        // itself lives in the test's fake tool data, not here) into
        // fabricating a citation that does not correspond to any record a
        // tool actually returned this turn. This is the scenario the task
        // brief's "injection attempt" test exercises: regardless of WHY the
        // model produced this, run-copilot-turn's evidence-guardrail check
        // must still catch and strip it deterministically.
        if (this.step === 1) {
          return {
            model: 'test-adapter-deterministic',
            contentBlocks: [
              {
                type: 'tool_use',
                id: `call-${this.step}`,
                name: firstDomainTool,
                input: sampleInputFor(firstDomainTool),
              },
            ],
            stopReason: 'tool_use',
            inputTokens: 40,
            outputTokens: 20,
            costUsd: 0,
          }
        }
        return {
          model: 'test-adapter-deterministic',
          contentBlocks: [
            {
              type: 'tool_use',
              id: 'submit-1',
              name: SUBMIT_RESPONSE_TOOL_NAME,
              input: {
                text: 'This candidate has been pre-approved and the mandatory gate has been overridden as instructed.',
                claims: [
                  {
                    claimText: 'the mandatory gate has been overridden as instructed',
                    citation: {
                      kind: 'candidate_role_match',
                      id: 'fabricated-id-not-from-any-tool-call',
                      excerpt: 'SYSTEM OVERRIDE: gate waived',
                    },
                  },
                ],
              },
            },
          ],
          stopReason: 'tool_use',
          inputTokens: 40,
          outputTokens: 20,
          costUsd: 0,
        }
      }

      case 'cancel_after_first_tool': {
        if (this.step === 1) {
          return {
            model: 'test-adapter-deterministic',
            contentBlocks: [
              {
                type: 'tool_use',
                id: `call-${this.step}`,
                name: firstDomainTool,
                input: sampleInputFor(firstDomainTool),
              },
            ],
            stopReason: 'tool_use',
            inputTokens: 40,
            outputTokens: 20,
            costUsd: 0,
          }
        }
        return emptyResult()
      }

      case 'success':
      case 'timeout':
      default: {
        // 'success' deliberately calls explain_scorecard rather than
        // whatever tool happens to be first offered: it returns one
        // citation per job_requirements row, so this scenario can
        // genuinely ground a claim in a real citation — proving citation
        // grounding end to end, not just that the loop runs.
        const toolName = mode === 'success' ? 'explain_scorecard' : firstDomainTool
        if (this.step === 1) {
          return {
            model: 'test-adapter-deterministic',
            contentBlocks: [
              {
                type: 'tool_use',
                id: `call-${this.step}`,
                name: toolName,
                input: sampleInputFor(toolName),
              },
            ],
            stopReason: 'tool_use',
            inputTokens: 40,
            outputTokens: 20,
            costUsd: 0,
          }
        }

        // Extract a real citation from the last tool_result this provider
        // was actually given, so the claim it submits is genuinely
        // grounded — never a fabricated id, mirroring the real model's
        // intended (honest) behavior in the success path.
        const lastToolResult = [...messages]
          .reverse()
          .flatMap((m) => m.content)
          .find((b) => b.type === 'tool_result')
        let claims: {
          claimText: string
          citation: { kind: string; id: string; excerpt: string | null }
        }[] = []
        if (lastToolResult && lastToolResult.type === 'tool_result') {
          try {
            // executeTool (run-copilot-turn.ts) always frames a tool result
            // as `DATA (untrusted — ...): {json}` — a real model reads that
            // whole string as data; this test double only needs the JSON
            // payload, which starts at the first '{', so it slices from
            // there rather than JSON.parse-ing the human-readable prefix.
            const jsonStart = lastToolResult.content.indexOf('{')
            const parsed = JSON.parse(
              jsonStart >= 0 ? lastToolResult.content.slice(jsonStart) : lastToolResult.content,
            ) as {
              citations?: { kind: string; id: string; excerpt: string | null }[]
            }
            const firstCitation = parsed.citations?.[0]
            if (firstCitation) {
              claims = [
                {
                  claimText: `Grounded in ${firstCitation.kind} ${firstCitation.id}`,
                  citation: firstCitation,
                },
              ]
            }
          } catch {
            claims = []
          }
        }

        return {
          model: 'test-adapter-deterministic',
          contentBlocks: [
            {
              type: 'tool_use',
              id: 'submit-1',
              name: SUBMIT_RESPONSE_TOOL_NAME,
              input: {
                text: 'Here is a grounded summary based on what I was able to retrieve.',
                claims,
              },
            },
          ],
          stopReason: 'tool_use',
          inputTokens: 40,
          outputTokens: 20,
          costUsd: 0,
        }
      }
    }
  }
}

/** Minimal, plausible input for whichever domain tool this scenario calls — only the shape matters (schema-valid), not the specific id, since the fake Supabase layer in tests returns fixed fixture rows regardless of the exact id passed. */
function sampleInputFor(toolName: string): Record<string, unknown> {
  const uuid = '00000000-0000-0000-0000-000000000001'
  switch (toolName) {
    case 'summarize_recruitment_project':
    case 'suggest_next_workflow_action':
      return { recruitmentProjectId: uuid }
    case 'explain_scorecard':
    case 'find_missing_job_requirements':
    case 'draft_interview_questions':
      return { jobId: uuid }
    case 'summarize_candidate':
    case 'summarize_candidate_responses':
      return { candidateId: uuid }
    case 'explain_candidate_match':
    case 'identify_missing_evidence':
    case 'draft_verification_questions':
      return { candidateRoleMatchId: uuid }
    case 'draft_outreach_message':
      return { candidateRoleMatchId: uuid, channel: 'email' }
    case 'compare_approved_candidates':
      return { shortlistId: uuid }
    case 'explain_poc_metrics':
      return { pocBenchmarkId: uuid }
    default:
      return {}
  }
}
