import { describe, expect, it } from 'vitest'
import { runOutreachDraftGeneration } from './run-outreach-draft-generation'
import { TestOutreachDraftAIProvider } from './outreach-draft-test-adapter'
import type { TrustedOutreachContext } from './outreach-draft-provider'
import type { OutreachEvidenceBundleItem } from './outreach-draft-provider'

const CONTEXT: TrustedOutreachContext = {
  jobTitle: 'Store Manager',
  clientName: 'Acme Retail',
  recruiterName: 'Jordan Recruiter',
  channel: 'email',
  templateBody: null,
  templateSubject: null,
  toneInstructions: null,
}

describe('runOutreachDraftGeneration', () => {
  it('returns not_configured and calls no provider when none is available (no ANTHROPIC_API_KEY in this environment)', async () => {
    const outcome = await runOutreachDraftGeneration({
      trustedContext: CONTEXT,
      candidateEvidence: [],
    })
    expect(outcome.status).toBe('not_configured')
    expect(outcome.validated).toBeNull()
    expect(outcome.errorMessage).toMatch(/not available/i)
  })

  it('succeeds on the first attempt, producing a personalized draft that quotes evidence verbatim', async () => {
    const evidence: OutreachEvidenceBundleItem[] = [
      {
        sourceKind: 'experience',
        sourceId: 'e1',
        text: 'Managed 12 convenience stores across the North West region.',
        isDirectStatement: true,
      },
    ]
    const outcome = await runOutreachDraftGeneration({
      trustedContext: CONTEXT,
      candidateEvidence: evidence,
      provider: new TestOutreachDraftAIProvider(),
    })

    expect(outcome.status).toBe('success')
    expect(outcome.retried).toBe(false)
    expect(outcome.validated?.wroteGenerically).toBe(false)
    expect(outcome.validated?.personalizationEvidence).toHaveLength(1)
    expect(outcome.validated?.personalizationEvidence[0]?.evidenceExcerpt).toBe(
      evidence[0]!.text.slice(0, 120),
    )
  })

  it('writes generically (no fabricated personalization) when no evidence is available', async () => {
    const outcome = await runOutreachDraftGeneration({
      trustedContext: CONTEXT,
      candidateEvidence: [],
      provider: new TestOutreachDraftAIProvider(),
    })
    expect(outcome.status).toBe('success')
    expect(outcome.validated?.wroteGenerically).toBe(true)
    expect(outcome.validated?.personalizationEvidence).toHaveLength(0)
  })

  it('retries exactly once on invalid structured output, then reports rejected_by_validation on a second failure', async () => {
    const outcome = await runOutreachDraftGeneration({
      trustedContext: CONTEXT,
      candidateEvidence: [],
      provider: new TestOutreachDraftAIProvider({ mode: 'invalid_output' }),
    })
    expect(outcome.status).toBe('rejected_by_validation')
    expect(outcome.retried).toBe(true)
    expect(outcome.validated).toBeNull()
    expect(outcome.errorMessage).toMatch(/failed structured-schema validation twice/i)
  })

  it('reports a timeout distinctly from a generic provider_error', async () => {
    const timeout = await runOutreachDraftGeneration({
      trustedContext: CONTEXT,
      candidateEvidence: [],
      provider: new TestOutreachDraftAIProvider({ mode: 'timeout' }),
    })
    expect(timeout.status).toBe('error')
    expect(timeout.errorMessage).toMatch(/timed out/i)

    const providerError = await runOutreachDraftGeneration({
      trustedContext: CONTEXT,
      candidateEvidence: [],
      provider: new TestOutreachDraftAIProvider({ mode: 'provider_error' }),
    })
    expect(providerError.status).toBe('error')
    expect(providerError.errorMessage).toMatch(/provider returned an error/i)
  })

  it('records the prompt version on every outcome, including a failed one', async () => {
    const outcome = await runOutreachDraftGeneration({
      trustedContext: CONTEXT,
      candidateEvidence: [],
      provider: new TestOutreachDraftAIProvider({ mode: 'provider_error' }),
    })
    expect(outcome.promptVersion).toBe('outreach-draft-v1')
  })
})
