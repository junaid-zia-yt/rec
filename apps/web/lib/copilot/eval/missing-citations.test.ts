import { describe, expect, it } from 'vitest'
import { runCopilotTurn } from '../orchestration/run-copilot-turn'
import { TestCopilotProvider } from '../orchestration/copilot-test-provider'
import { baseParams, baseSeed, JOB } from './fixtures'

/**
 * Build Phase 11, Wave 5 — EVALUATION item 6 (governing brief: "missing
 * citations"). `run-copilot-turn.test.ts` already has one happy-path test
 * of this ('logs copilot.citation_missing and appends a caveat'); this file
 * adds the adversarial edge the brief specifically wants proven: a response
 * with NO citable records available at all (a purely procedural answer)
 * must NOT be treated as a violation, distinguishing "nothing to cite" from
 * "should have cited something and didn't".
 */
describe('EVALUATION — missing citations: soft-fail only when citable records genuinely existed', () => {
  it('does NOT apply the missing-citation caveat when no tool call this turn returned any citable record at all (a purely procedural answer has nothing to cite)', async () => {
    // summarize_recruitment_project's own citations array is always empty
    // (tools/project.ts — a statistical summary, not evidence-backed) — so
    // a 'timeout' (no delayMs => behaves as a generic success calling
    // firstDomainTool, per copilot-test-provider.ts's own default branch)
    // scenario against a seed with no jobs/requirements genuinely has zero
    // authorized citable records this turn.
    const seed = baseSeed() // no jobs/job_requirements seeded — summarize_recruitment_project's own output has no candidate/requirement detail to cite.
    const provider = new TestCopilotProvider({ mode: 'timeout' })
    const result = await runCopilotTurn(baseParams(seed, provider, { turnTimeoutMs: 5_000 }))
    expect(result.status).toBe('success')
    if (result.status !== 'success') return
    expect(result.citationsCaveatApplied).toBe(false)
    expect(seed.audit_events!.some((e) => e.action === 'copilot.citation_missing')).toBe(false)
  })

  it('DOES apply the caveat when citable records existed this turn but the model claimed none of them', async () => {
    const seed = baseSeed({
      jobs: [
        {
          id: JOB,
          organization_id: 'org-a',
          recruitment_project_id: '00000000-0000-0000-0000-000000000001',
          title: 'Store Manager',
          status: 'active',
        },
      ],
      job_requirements: [
        {
          id: 'req-1',
          organization_id: 'org-a',
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
    if (result.status !== 'success') return
    expect(result.citationsCaveatApplied).toBe(true)
    expect(result.text).toContain('did not cite specific records')
    expect(seed.audit_events!.some((e) => e.action === 'copilot.citation_missing')).toBe(true)
  })

  it('the missing-citation retry is a soft check, not a hard reject — the turn still succeeds with a caveat rather than being turned into validation_rejected', async () => {
    const seed = baseSeed({
      jobs: [
        {
          id: JOB,
          organization_id: 'org-a',
          recruitment_project_id: '00000000-0000-0000-0000-000000000001',
          title: 'Store Manager',
          status: 'active',
        },
      ],
      job_requirements: [
        {
          id: 'req-1',
          organization_id: 'org-a',
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
    expect(result.status).not.toBe('validation_rejected')
    expect(seed.copilot_messages!.filter((m) => m.role === 'assistant')).toHaveLength(1)
  })
})
