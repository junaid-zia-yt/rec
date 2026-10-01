import { describe, expect, it } from 'vitest'
import { runCopilotTurn } from '../orchestration/run-copilot-turn'
import { TestCopilotProvider } from '../orchestration/copilot-test-provider'
import { baseParams, baseSeed } from './fixtures'

/**
 * Build Phase 11, Wave 5 — EVALUATION item 1 (governing brief: "unsupported
 * claims"). Drives a model that fabricates a citation not grounded in any
 * record a tool call actually returned this turn, and proves
 * `validateCopilotEvidenceCitations` (evidence-guardrail.ts, wired in at
 * `run-copilot-turn.ts` step 7) strips it rather than trusting it — never
 * merely a unit test of the guardrail function in isolation (that already
 * exists in `evidence-guardrail.test.ts`); this exercises the FULL
 * orchestration path a real adversarial model turn would take.
 */
describe('EVALUATION — unsupported claims are stripped, never persisted or shown as fact', () => {
  it('strips a fabricated citation from the returned outcome and reports exactly how many were removed', async () => {
    const seed = baseSeed()
    const provider = new TestCopilotProvider({ mode: 'fabricates_citation' })
    const result = await runCopilotTurn(baseParams(seed, provider))

    expect(result.status).toBe('success')
    if (result.status !== 'success') return
    expect(result.unsupportedClaimsStripped).toBe(1)
    expect(result.citations.some((c) => c.id === 'fabricated-id-not-from-any-tool-call')).toBe(
      false,
    )
    expect(result.text).toContain('could not be verified against retrieved records')
  })

  it('never persists the fabricated citation on the copilot_messages row (DB-facing surface, not just the return value)', async () => {
    const seed = baseSeed()
    const provider = new TestCopilotProvider({ mode: 'fabricates_citation' })
    await runCopilotTurn(baseParams(seed, provider))

    const assistantMessages = seed.copilot_messages!.filter((m) => m.role === 'assistant')
    expect(assistantMessages).toHaveLength(1)
    const persistedCitations = assistantMessages[0]!.citations as { id: string }[]
    expect(persistedCitations.some((c) => c.id === 'fabricated-id-not-from-any-tool-call')).toBe(
      false,
    )
    // The claim's own dangerous assertion text ("mandatory gate has been
    // overridden") is still present in the prose (the model's raw text is
    // never rewritten) — the guardrail strips the CITATION, not the
    // sentence, and instead appends a visible caveat. A human reading the
    // transcript therefore sees both the claim AND the caveat that it could
    // not be verified, never a silently "cleaned" false statement.
    expect(String(assistantMessages[0]!.content)).toContain('could not be verified')
  })

  it('a claim whose citation id is real but whose excerpt is fabricated/paraphrased is also rejected (not just a wholly invented id)', async () => {
    // Direct unit-level check on the guardrail itself for this specific
    // sub-case (excerpt mismatch on an otherwise-real id) — the
    // orchestration-level test above already covers the wholly-invented-id
    // case end to end; this confirms the guardrail's OTHER rejection path
    // (`excerptFound` false) is not a dead branch.
    const { validateCopilotEvidenceCitations } = await import('../evidence-guardrail')
    const result = validateCopilotEvidenceCitations({
      claims: [
        {
          claimText: 'candidate has a valid forklift licence',
          citation: {
            kind: 'job_requirement',
            id: 'req-1',
            excerpt: 'holds a current forklift licence',
          },
        },
      ],
      authorizedRecords: [{ kind: 'job_requirement', id: 'req-1', excerpt: 'Reliability' }],
    })
    expect(result.valid).toBe(false)
  })
})
