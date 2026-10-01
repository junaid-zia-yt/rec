import 'server-only'
import type {
  OutreachDraftAIProvider,
  OutreachDraftAIProviderCallResult,
  OutreachDraftAIRequest,
  OutreachEvidenceBundleItem,
} from './outreach-draft-provider'

/**
 * Deterministic, offline test double for OutreachDraftAIProvider (same
 * never-silently-substitutes-for-a-missing-key convention as
 * lib/ai/matching-test-adapter.ts). Imported ONLY by test files — grep for
 * `TestOutreachDraftAIProvider` outside a `.test.ts` file if that invariant
 * is ever in doubt.
 *
 * Behavior: builds a short, generic opener plus, for each evidence item
 * whose text looks like a direct statement, one personalized sentence
 * quoting that item verbatim as its evidenceExcerpt — this intentionally
 * mirrors, in miniature, the real model's actual job (cite real evidence,
 * never invent), including immunity to prompt injection embedded in an
 * evidence item's text, since this adapter only ever echoes the item's own
 * text back as a verbatim excerpt, never obeys anything inside it.
 */
export class TestOutreachDraftAIProvider implements OutreachDraftAIProvider {
  readonly name = 'test-adapter'

  constructor(
    private readonly options: {
      mode?: 'success' | 'invalid_output' | 'timeout' | 'provider_error'
    } = {},
  ) {}

  async generateDraft(request: OutreachDraftAIRequest): Promise<OutreachDraftAIProviderCallResult> {
    if (this.options.mode === 'timeout') {
      const { OutreachDraftAIProviderError } = await import('./outreach-draft-provider')
      throw new OutreachDraftAIProviderError('The AI outreach draft request timed out', 'timeout')
    }
    if (this.options.mode === 'provider_error') {
      const { OutreachDraftAIProviderError } = await import('./outreach-draft-provider')
      throw new OutreachDraftAIProviderError('The AI provider returned an error', 'provider_error')
    }
    if (this.options.mode === 'invalid_output') {
      return {
        model: 'test-adapter-deterministic',
        // Deliberately malformed: body is empty, violates min(1) in the schema.
        rawOutput: {
          subject: null,
          body: '',
          personalizationEvidence: [],
          wroteGenerically: true,
          unresolvedNotes: [],
        },
        inputTokens: 50,
        outputTokens: 10,
        costUsd: 0.0005,
        latencyMs: 5,
      }
    }

    return {
      model: 'test-adapter-deterministic',
      rawOutput: deriveDeterministicDraft(request),
      inputTokens: request.candidateEvidence.reduce((sum, item) => sum + item.text.length, 0),
      outputTokens: 80,
      costUsd: 0.0007,
      latencyMs: 5,
    }
  }
}

function pickPersonalizableEvidence(
  evidence: OutreachEvidenceBundleItem[],
): OutreachEvidenceBundleItem[] {
  return evidence.filter((item) => item.isDirectStatement).slice(0, 2)
}

function deriveDeterministicDraft(request: OutreachDraftAIRequest) {
  const { trustedContext, candidateEvidence } = request
  const personalizable = pickPersonalizableEvidence(candidateEvidence)
  const greeting = `Hi there, I'm reaching out about the ${trustedContext.jobTitle} role${trustedContext.clientName ? ` with ${trustedContext.clientName}` : ''}.`

  if (personalizable.length === 0) {
    return {
      subject: trustedContext.channel === 'email' ? `${trustedContext.jobTitle} opportunity` : null,
      body: `${greeting} I'd love to tell you more and hear if you're open to a conversation.`,
      personalizationEvidence: [],
      wroteGenerically: true,
      unresolvedNotes:
        candidateEvidence.length > 0
          ? ['No direct-statement evidence available to personalize on.']
          : [],
    }
  }

  const personalizedSentences = personalizable.map(
    (item) => `I noticed: ${item.text.slice(0, 120)}.`,
  )
  const body = `${greeting} ${personalizedSentences.join(' ')} I'd love to hear if you're open to a conversation.`

  return {
    subject: trustedContext.channel === 'email' ? `${trustedContext.jobTitle} opportunity` : null,
    body,
    personalizationEvidence: personalizable.map((item) => ({
      sourceKind: item.sourceKind,
      sourceId: item.sourceId,
      claimText: `I noticed: ${item.text.slice(0, 120)}.`,
      evidenceExcerpt: item.text.slice(0, 120),
    })),
    wroteGenerically: false,
    unresolvedNotes: [],
  }
}
