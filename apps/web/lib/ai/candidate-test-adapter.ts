import 'server-only'
import type { AIProviderCallResult } from './provider'
import type { CandidateAIExtractionRequest, CandidateAIProvider } from './candidate-provider'

/**
 * Deterministic, offline test double for CandidateAIProvider (mirrors
 * lib/ai/test-adapter.ts's TestAIProvider for the same reason: no live
 * Anthropic key is configured in this environment). This is imported ONLY
 * by test files (lib/ai/*.test.ts, lib/candidates/*.test.ts) and by
 * nothing in the live request path — grep the repo for
 * `TestCandidateAIProvider` outside a `.test.ts` file if that invariant is
 * ever in doubt. It never silently substitutes for a missing real key; the
 * default provider resolution in lib/ai/parse-candidate-document.ts
 * returns an honest "not configured" result instead when
 * anthropicConfigured is false, exactly like every other missing-credential
 * path in this app.
 *
 * Behavior is derived purely from the input document text with simple,
 * inspectable line-prefix rules — no randomness, no network — so a test
 * can assert on an exact expected output. A line with no matching prefix
 * (including one phrased as an instruction to the model) produces no
 * field at all, the deterministic stand-in for the real prompt's
 * trust-boundary rule (see malicious-prompt-cv.pdf in
 * test/fixtures/candidate-documents/: its injected "SYSTEM NOTE" lines
 * match no prefix below and are silently ignored, never turned into
 * fabricated work-authorization/compensation values).
 */
export class TestCandidateAIProvider implements CandidateAIProvider {
  readonly name = 'test-adapter'

  constructor(
    private readonly options: {
      mode?: 'success' | 'invalid_output' | 'timeout' | 'provider_error'
    } = {},
  ) {}

  async callCandidateExtraction(
    request: CandidateAIExtractionRequest,
  ): Promise<AIProviderCallResult> {
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
        // Deliberately malformed: hasEvidence=false carrying a non-null
        // value — exercises the extractedScalarField().refine() rejection
        // path (the exact shape a prompt-injected/hallucinating model
        // would produce if it invented a value it wasn't given evidence
        // for).
        rawOutput: {
          fullName: {
            value: 'Invented Name',
            hasEvidence: false,
            sourceExcerpt: null,
            sourceLocation: null,
            confidence: null,
          },
          contactDetails: [],
          employmentHistory: [],
          skills: [],
          education: [],
          certifications: [],
          industryExposure: [],
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
      rawOutput: deriveDeterministicCandidateExtraction(request.documentText),
      inputTokens: request.documentText.length,
      outputTokens: 120,
      costUsd: 0.0011,
      latencyMs: 5,
    }
  }
}

interface ScalarField {
  value: string | null
  hasEvidence: boolean
  sourceExcerpt: string | null
  sourceLocation: string | null
  confidence: number | null
}

function unknownScalar(): ScalarField {
  return {
    value: null,
    hasEvidence: false,
    sourceExcerpt: null,
    sourceLocation: null,
    confidence: null,
  }
}

function evidencedScalar(
  value: string,
  sourceExcerpt: string,
  sourceLocation: string,
  confidence = 0.9,
): ScalarField {
  return { value, hasEvidence: true, sourceExcerpt, sourceLocation, confidence }
}

/**
 * Line-prefix-driven deterministic extraction:
 *   NAME:, LOCATION:, TITLE:, COMPANY:, LEADERSHIP:, PNL:, WORKAUTH:,
 *   COMP:, AVAIL: — each sets one scalar field.
 *   EMAIL:, PHONE:, LINKEDIN: — each appends one contact detail.
 *   SKILL:, INDUSTRY: — each appends one array item.
 *   ROLE:<company>|<title>|<start-or-empty>|<end-or-empty>|<true|false>|<r1;r2;...> — appends an employment-history item.
 *   EDU:<institution>|<degree-or-empty>|<field-or-empty>|<start-or-empty>|<end-or-empty> — appends an education item.
 *   CERT:<name>|<issuingBody-or-empty>|<issuedDate-or-empty>|<expiresDate-or-empty> — appends a certification item.
 *   UNCLEAR:<note> — appends an unresolvedNotes entry.
 * Every other line (blank lines, free-form prose, and any injected
 * "instruction"-shaped text) matches nothing and contributes no field,
 * exactly mirroring the honest "no evidence found" outcome a well-behaved
 * real model should also produce for content that isn't a recognized fact.
 */
function deriveDeterministicCandidateExtraction(documentText: string) {
  const lines = documentText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  let fullName: ScalarField = unknownScalar()
  let location: ScalarField = unknownScalar()
  let currentTitle: ScalarField = unknownScalar()
  let currentCompany: ScalarField = unknownScalar()
  let leadershipScope: ScalarField = unknownScalar()
  let pnlResponsibility: ScalarField = unknownScalar()
  let workAuthorization: ScalarField = unknownScalar()
  let compensation: ScalarField = unknownScalar()
  let availability: ScalarField = unknownScalar()

  const contactDetails: Array<{
    type: 'email' | 'phone' | 'linkedin' | 'other'
    value: string
    sourceExcerpt: string
    sourceLocation: string | null
    confidence: number
  }> = []
  const skills: Array<{
    skillName: string
    sourceExcerpt: string
    sourceLocation: string | null
    confidence: number
  }> = []
  const industryExposure: Array<{
    industry: string
    sourceExcerpt: string
    sourceLocation: string | null
    confidence: number
  }> = []
  const employmentHistory: Array<{
    company: string
    title: string
    startDate: string | null
    endDate: string | null
    isCurrent: boolean
    responsibilities: string[]
    sourceExcerpt: string
    sourceLocation: string | null
    confidence: number
  }> = []
  const education: Array<{
    institution: string
    degree: string | null
    fieldOfStudy: string | null
    startDate: string | null
    endDate: string | null
    sourceExcerpt: string
    sourceLocation: string | null
    confidence: number
  }> = []
  const certifications: Array<{
    name: string
    issuingBody: string | null
    issuedDate: string | null
    expiresDate: string | null
    sourceExcerpt: string
    sourceLocation: string | null
    confidence: number
  }> = []
  const unresolvedNotes: string[] = []

  for (const [index, line] of lines.entries()) {
    const sourceLocation = `line ${index + 1}`

    const scalarMatch =
      /^(NAME|LOCATION|TITLE|COMPANY|LEADERSHIP|PNL|WORKAUTH|COMP|AVAIL):\s*(.+)$/i.exec(line)
    if (scalarMatch) {
      const [, key, value] = scalarMatch
      const field = evidencedScalar(value ?? '', line, sourceLocation)
      switch (key?.toUpperCase()) {
        case 'NAME':
          fullName = field
          break
        case 'LOCATION':
          location = field
          break
        case 'TITLE':
          currentTitle = field
          break
        case 'COMPANY':
          currentCompany = field
          break
        case 'LEADERSHIP':
          leadershipScope = field
          break
        case 'PNL':
          pnlResponsibility = field
          break
        case 'WORKAUTH':
          workAuthorization = field
          break
        case 'COMP':
          compensation = field
          break
        case 'AVAIL':
          availability = field
          break
      }
      continue
    }

    const contactMatch = /^(EMAIL|PHONE|LINKEDIN):\s*(.+)$/i.exec(line)
    if (contactMatch) {
      const [, key, value] = contactMatch
      contactDetails.push({
        type: (key?.toLowerCase() as 'email' | 'phone' | 'linkedin') ?? 'other',
        value: value ?? '',
        sourceExcerpt: line,
        sourceLocation,
        confidence: 0.95,
      })
      continue
    }

    const skillMatch = /^SKILL:\s*(.+)$/i.exec(line)
    if (skillMatch) {
      skills.push({
        skillName: skillMatch[1] ?? '',
        sourceExcerpt: line,
        sourceLocation,
        confidence: 0.85,
      })
      continue
    }

    const industryMatch = /^INDUSTRY:\s*(.+)$/i.exec(line)
    if (industryMatch) {
      industryExposure.push({
        industry: industryMatch[1] ?? '',
        sourceExcerpt: line,
        sourceLocation,
        confidence: 0.85,
      })
      continue
    }

    const roleMatch = /^ROLE:(.+)$/i.exec(line)
    if (roleMatch) {
      const parts = (roleMatch[1] ?? '').split('|')
      employmentHistory.push({
        company: parts[0]?.trim() ?? '',
        title: parts[1]?.trim() ?? '',
        startDate: parts[2]?.trim() || null,
        endDate: parts[3]?.trim() || null,
        isCurrent: (parts[4]?.trim() ?? '').toLowerCase() === 'true',
        responsibilities: (parts[5] ?? '')
          .split(';')
          .map((r) => r.trim())
          .filter(Boolean),
        sourceExcerpt: line,
        sourceLocation,
        confidence: 0.88,
      })
      continue
    }

    const eduMatch = /^EDU:(.+)$/i.exec(line)
    if (eduMatch) {
      const parts = (eduMatch[1] ?? '').split('|')
      education.push({
        institution: parts[0]?.trim() ?? '',
        degree: parts[1]?.trim() || null,
        fieldOfStudy: parts[2]?.trim() || null,
        startDate: parts[3]?.trim() || null,
        endDate: parts[4]?.trim() || null,
        sourceExcerpt: line,
        sourceLocation,
        confidence: 0.85,
      })
      continue
    }

    const certMatch = /^CERT:(.+)$/i.exec(line)
    if (certMatch) {
      const parts = (certMatch[1] ?? '').split('|')
      certifications.push({
        name: parts[0]?.trim() ?? '',
        issuingBody: parts[1]?.trim() || null,
        issuedDate: parts[2]?.trim() || null,
        expiresDate: parts[3]?.trim() || null,
        sourceExcerpt: line,
        sourceLocation,
        confidence: 0.85,
      })
      continue
    }

    const unclearMatch = /^UNCLEAR:\s*(.+)$/i.exec(line)
    if (unclearMatch) {
      unresolvedNotes.push(unclearMatch[1] ?? '')
      continue
    }

    // Any other line — including free prose, embedded prompt-injection
    // text, or unsupported bare claims — matches no prefix and contributes
    // nothing, mirroring the "no evidence, so unknown" rule.
  }

  return {
    fullName,
    contactDetails,
    location,
    currentTitle,
    currentCompany,
    employmentHistory,
    skills,
    education,
    certifications,
    industryExposure,
    leadershipScope,
    pnlResponsibility,
    workAuthorization,
    compensation,
    availability,
    unresolvedNotes,
  }
}
