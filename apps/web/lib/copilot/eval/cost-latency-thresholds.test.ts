import { describe, expect, it, vi } from 'vitest'
import { runCopilotTurn } from '../orchestration/run-copilot-turn'
import { TestCopilotProvider } from '../orchestration/copilot-test-provider'
import { baseParams, baseSeed } from './fixtures'

/**
 * Build Phase 11, Wave 5 — EVALUATION item 10 (governing brief: "cost and
 * latency thresholds"). Two independent guarantees:
 *
 *  COST: the daily message/cost rate limit (200 msg/day, $5/day — wave 3's
 *  own documented placeholder constants) is checked and enforced BEFORE any
 *  provider call — proven here with a spy on the injected provider's
 *  `runConversationTurn`, asserting it is never invoked once the threshold
 *  is already met, not merely that the final outcome status is
 *  `rate_limited` (which `run-copilot-turn.test.ts` already covers, but
 *  without the spy proof that the model was genuinely never reached).
 *
 *  LATENCY: the hard 45s wall-clock timeout actually bounds a runaway turn,
 *  and leaves clean, resolvable DB state afterward — never a tool call
 *  stuck "in progress" forever. Every `copilot_tool_calls` row is written
 *  SYNCHRONOUSLY as `executeTool` runs (see run-copilot-turn.ts's own
 *  comment on this), so there is no "pending" row shape to begin with; this
 *  test asserts every row a timed-out turn did produce has a terminal
 *  `output_validation_status` and that the run is recorded as a clean
 *  `ai_runs` failure, not left silently unresolved.
 */
describe('EVALUATION — cost threshold: the model is never called once the daily limit is already met', () => {
  it('spies on the provider and confirms runConversationTurn is never invoked when message_count is already at the cap', async () => {
    const today = new Date().toISOString().slice(0, 10)
    const seed = baseSeed({
      copilot_usage_counters: [
        {
          id: 'usage-1',
          organization_id: 'org-a',
          user_id: 'user-1',
          window_date: today,
          message_count: 200,
          rate_limited_count: 0,
          total_cost_usd: 0,
        },
      ],
    })
    const provider = new TestCopilotProvider({ mode: 'success' })
    const spy = vi.spyOn(provider, 'runConversationTurn')

    const result = await runCopilotTurn(baseParams(seed, provider))

    expect(result.status).toBe('rate_limited')
    expect(spy).not.toHaveBeenCalled()
    // The rate-limited counter itself was incremented (observability), but
    // no message_count/tool_call/ai_run activity was recorded for this
    // blocked attempt.
    expect(seed.copilot_usage_counters![0]!.rate_limited_count).toBe(1)
    expect(seed.ai_runs!).toHaveLength(0)
    expect(seed.copilot_tool_calls!).toHaveLength(0)
  })

  it('the same holds when the daily COST cap ($5) is already met, independent of message_count', async () => {
    const today = new Date().toISOString().slice(0, 10)
    const seed = baseSeed({
      copilot_usage_counters: [
        {
          id: 'usage-1',
          organization_id: 'org-a',
          user_id: 'user-1',
          window_date: today,
          message_count: 3,
          rate_limited_count: 0,
          total_cost_usd: 5.01,
        },
      ],
    })
    const provider = new TestCopilotProvider({ mode: 'success' })
    const spy = vi.spyOn(provider, 'runConversationTurn')

    const result = await runCopilotTurn(baseParams(seed, provider))
    expect(result.status).toBe('rate_limited')
    expect(spy).not.toHaveBeenCalled()
    expect(
      seed.audit_events!.some(
        (e) =>
          e.action === 'copilot.rate_limited' &&
          (e.metadata as { reason?: string })?.reason === 'daily_cost_limit',
      ),
    ).toBe(true)
  })
})

describe('EVALUATION — latency threshold: a runaway turn is bounded by the hard wall-clock timeout, with clean, resolvable state afterward', () => {
  it('a model that never responds within the wall-clock budget produces a clean timeout, not an indefinite hang', async () => {
    const seed = baseSeed()
    const provider = new TestCopilotProvider({ mode: 'timeout', delayMs: 200 })
    const startedAt = Date.now()
    const result = await runCopilotTurn(baseParams(seed, provider, { turnTimeoutMs: 20 }))
    const elapsedMs = Date.now() - startedAt

    expect(result.status).toBe('timeout')
    // Bounded — the turn resolved close to the configured timeout, not
    // anywhere near the provider's full 200ms simulated delay left
    // unbounded (proves the abort actually races ahead of the slow call,
    // per run-copilot-turn.ts's raceAgainstAbort, rather than merely
    // waiting the delay out and THEN reporting timeout).
    expect(elapsedMs).toBeLessThan(200)

    // Clean, resolvable DB state: the user's message was still persisted
    // (never lost — run-copilot-turn.ts persists it before the model call),
    // and exactly one ai_runs row records the failure explicitly, never a
    // row left in an ambiguous "still running" state (no `status: 'error'`
    // ai_runs row is ever left absent for a path that reached the model).
    expect(seed.copilot_messages!.filter((m) => m.role === 'user')).toHaveLength(1)
    expect(seed.ai_runs!).toHaveLength(1)
    expect(seed.ai_runs![0]!.status).toBe('error')
    // No assistant message was ever fabricated for a turn that didn't
    // actually complete.
    expect(seed.copilot_messages!.filter((m) => m.role === 'assistant')).toHaveLength(0)
  })

  it('a runaway tool-call loop (never submitting a final answer) is stopped by the hard 8-iteration cap, never runs unbounded', async () => {
    const seed = baseSeed()
    const provider = new TestCopilotProvider({ mode: 'runaway_loop' })
    const result = await runCopilotTurn(baseParams(seed, provider, { turnTimeoutMs: 10_000 }))
    expect(result.status).toBe('validation_rejected')
    // Exactly 8 tool calls — the documented hard cap (conversation-loop.ts's
    // COPILOT_MAX_TOOL_ITERATIONS) — never more, proving the loop cannot be
    // steered into unbounded cost by simply never finishing.
    expect(seed.copilot_tool_calls!.length).toBe(8)
    // Every one of those 8 calls resolved to a definite, non-pending
    // validation status — none left ambiguous.
    for (const call of seed.copilot_tool_calls!) {
      expect(['valid', 'invalid', 'error']).toContain(call.output_validation_status)
    }
  })
})
