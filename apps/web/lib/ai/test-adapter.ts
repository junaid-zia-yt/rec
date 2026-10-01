import 'server-only'
import type { AIExtractionRequest, AIProviderCallResult, AIProvider } from './provider'

/**
 * Deterministic, offline test double for AIProvider (Build Phase 4 brief:
 * "If a real Anthropic key is unavailable, implement a typed provider
 * interface and deterministic test adapter"). This is imported ONLY by
 * test files (lib/ai/*.test.ts) and by nothing in the live request path —
 * grep the repo for `TestAIProvider` outside a `.test.ts` file if that
 * invariant is ever in doubt. It never silently substitutes for a missing
 * real key; extract-requirements.ts's default provider resolution returns
 * an honest "not configured" result instead when anthropicConfigured is
 * false, exactly like every other missing-credential path in this app.
 *
 * Behavior is derived purely from the input document text with simple,
 * inspectable string rules — no randomness, no network — so a test can
 * assert on an exact expected output.
 */
export class TestAIProvider implements AIProvider {
  readonly name = 'test-adapter'

  constructor(
    private readonly options: {
      /** Force a specific canned outcome instead of the default rule-based extraction. */
      mode?: 'success' | 'invalid_output' | 'timeout' | 'provider_error'
    } = {},
  ) {}

  async callExtraction(request: AIExtractionRequest): Promise<AIProviderCallResult> {
    if (this.options.mode === 'timeout') {
      const { AIProviderError } = await import('./provider')
      throw new AIProviderError('The AI extraction request timed out', 'timeout')
    }
    if (this.options.mode === 'provider_error') {
      const { AIProviderError } = await import('./provider')
      throw new AIProviderError('The AI provider returned an error', 'provider_error')
    }
    if (this.options.mode === 'invalid_output') {
      return {
        model: 'test-adapter-deterministic',
        // Deliberately malformed: a mandatory requirement with a weight,
        // and a confidence outside 0-1 — exercises the Zod-rejection path.
        rawOutput: {
          requirements: [
            {
              name: 'Malformed requirement',
              type: 'mandatory',
              weight: 40,
              confidence: 4,
            },
          ],
          unresolvedNotes: [],
        },
        inputTokens: 120,
        outputTokens: 40,
        costUsd: 0.0012,
        latencyMs: 5,
      }
    }

    return {
      model: 'test-adapter-deterministic',
      rawOutput: deriveDeterministicExtraction(request.documentText),
      inputTokens: request.documentText.length,
      outputTokens: 80,
      costUsd: 0.0009,
      latencyMs: 5,
    }
  }
}

/**
 * Line-driven deterministic extraction: a line beginning with `MUST:` becomes
 * a mandatory requirement, `PREFERRED(weight):` a preferred one, `DISQUALIFY:`
 * a disqualifying one, `UNCLEAR:` a requires_clarification one — everything
 * else is ignored. This intentionally mirrors, in miniature, the real
 * model's job (never inventing a requirement the text doesn't support) so
 * fixture documents can encode both ordinary cases and adversarial ones (a
 * line that reads like a system instruction is just text with no matching
 * prefix, so it produces no requirement at all).
 */
function deriveDeterministicExtraction(documentText: string) {
  const lines = documentText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const requirements: Array<{
    name: string
    description: string
    category: string
    type: 'mandatory' | 'preferred' | 'informational' | 'disqualifying' | 'requires_clarification'
    weight: number | null
    evidenceExpected: string
    sourceText: string
    sourceLocation: string | null
    confidence: number
  }> = []
  const unresolvedNotes: string[] = []

  for (const [index, line] of lines.entries()) {
    const sourceLocation = `line ${index + 1}`
    const mustMatch = /^MUST:\s*(.+)$/i.exec(line)
    if (mustMatch) {
      const text = mustMatch[1] ?? ''
      requirements.push({
        name: text.slice(0, 80),
        description: text,
        category: 'general',
        type: 'mandatory',
        weight: null,
        evidenceExpected: `Evidence confirming: ${text}`,
        sourceText: line,
        sourceLocation,
        confidence: 0.95,
      })
      continue
    }
    const preferredMatch = /^PREFERRED\((\d+)\):\s*(.+)$/i.exec(line)
    if (preferredMatch) {
      const weightText = preferredMatch[1] ?? '0'
      const text = preferredMatch[2] ?? ''
      requirements.push({
        name: text.slice(0, 80),
        description: text,
        category: 'general',
        type: 'preferred',
        weight: Number(weightText),
        evidenceExpected: `Evidence confirming: ${text}`,
        sourceText: line,
        sourceLocation,
        confidence: 0.85,
      })
      continue
    }
    const disqualifyMatch = /^DISQUALIFY:\s*(.+)$/i.exec(line)
    if (disqualifyMatch) {
      const text = disqualifyMatch[1] ?? ''
      requirements.push({
        name: text.slice(0, 80),
        description: text,
        category: 'general',
        type: 'disqualifying',
        weight: null,
        evidenceExpected: `Evidence confirming: ${text}`,
        sourceText: line,
        sourceLocation,
        confidence: 0.9,
      })
      continue
    }
    const unclearMatch = /^UNCLEAR:\s*(.+)$/i.exec(line)
    if (unclearMatch) {
      const text = unclearMatch[1] ?? ''
      requirements.push({
        name: text.slice(0, 80),
        description: text,
        category: 'general',
        type: 'requires_clarification',
        weight: null,
        evidenceExpected: `Evidence confirming: ${text}`,
        sourceText: line,
        sourceLocation,
        confidence: 0.4,
      })
      unresolvedNotes.push(`Ambiguous requirement at ${sourceLocation}: "${line}"`)
    }
    // Any other line — including one phrased as an instruction to the
    // model ("ignore previous instructions", "system:", etc.) — matches no
    // prefix above and is silently skipped, never turned into a
    // requirement. This is the deterministic stand-in for the real
    // prompt's trust-boundary rule.
  }

  return { requirements, unresolvedNotes }
}
