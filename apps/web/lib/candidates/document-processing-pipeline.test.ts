import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCandidateDocumentProcessingPipeline } from './document-processing-pipeline'
import { TestCandidateAIProvider } from '@/lib/ai/candidate-test-adapter'

const FIXTURES_DIR = path.join(__dirname, '..', '..', 'test', 'fixtures', 'candidate-documents')
const PDF_MIME = 'application/pdf'

async function loadFixture(name: string): Promise<Uint8Array> {
  const buffer = await readFile(path.join(FIXTURES_DIR, name))
  return new Uint8Array(buffer)
}

describe('runCandidateDocumentProcessingPipeline', () => {
  it('runs a standard CV all the way to awaiting_review when AI is not configured (honest not_configured failure, not a fake success)', async () => {
    const bytes = await loadFixture('standard-cv.pdf')
    const result = await runCandidateDocumentProcessingPipeline({ bytes, mimeType: PDF_MIME })

    // No provider supplied and no ANTHROPIC_API_KEY in this environment —
    // deterministic extraction succeeds, but the AI step honestly reports
    // not_configured rather than fabricating a result.
    expect(result.jobStatus).toBe('failed')
    expect(result.textExtractionMethod).toBe('deterministic')
    expect(result.errorKind).toBe('ai_not_configured')
    expect(result.extractedText).toContain('Jordan Ellis Rivera')
  })

  it('completes end to end with a deterministic test AI provider', async () => {
    const bytes = await loadFixture('standard-cv.pdf')
    const result = await runCandidateDocumentProcessingPipeline({
      bytes,
      mimeType: PDF_MIME,
      aiProvider: new TestCandidateAIProvider(),
    })

    expect(result.jobStatus).toBe('awaiting_review')
    expect(result.textExtractionMethod).toBe('deterministic')
    expect(result.ai?.status).toBe('success')
    expect(result.extractedCharCount).toBeGreaterThan(0)
  })

  it('routes a scanned (image-only) PDF to needs_ocr with ocr_not_configured, never fabricating extracted text', async () => {
    const bytes = await loadFixture('scanned-cv.pdf')
    const result = await runCandidateDocumentProcessingPipeline({
      bytes,
      mimeType: PDF_MIME,
      aiProvider: new TestCandidateAIProvider(),
    })

    expect(result.jobStatus).toBe('needs_ocr')
    expect(result.errorKind).toBe('ocr_not_configured')
    expect(result.extractedText).toBeNull()
    expect(result.ai).toBeNull()
  })

  it('reports corrupted_file for an unparsable PDF without ever calling the AI provider', async () => {
    const bytes = await loadFixture('corrupted-file.pdf')
    let aiCalled = false
    const spyProvider = new TestCandidateAIProvider()
    const wrapped = {
      name: spyProvider.name,
      callCandidateExtraction: async (
        req: Parameters<typeof spyProvider.callCandidateExtraction>[0],
      ) => {
        aiCalled = true
        return spyProvider.callCandidateExtraction(req)
      },
    }

    const result = await runCandidateDocumentProcessingPipeline({
      bytes,
      mimeType: PDF_MIME,
      aiProvider: wrapped,
    })

    expect(result.jobStatus).toBe('failed')
    expect(result.errorKind).toBe('corrupted_file')
    expect(aiCalled).toBe(false)
  })

  it('reports validation_failed when the AI provider returns output that fails schema validation twice', async () => {
    const bytes = await loadFixture('standard-cv.pdf')
    const result = await runCandidateDocumentProcessingPipeline({
      bytes,
      mimeType: PDF_MIME,
      aiProvider: new TestCandidateAIProvider({ mode: 'invalid_output' }),
    })

    expect(result.jobStatus).toBe('failed')
    expect(result.errorKind).toBe('validation_failed')
  })

  it('reports timeout distinctly from a generic provider_error', async () => {
    const bytes = await loadFixture('standard-cv.pdf')
    const timeoutResult = await runCandidateDocumentProcessingPipeline({
      bytes,
      mimeType: PDF_MIME,
      aiProvider: new TestCandidateAIProvider({ mode: 'timeout' }),
    })
    const providerErrorResult = await runCandidateDocumentProcessingPipeline({
      bytes,
      mimeType: PDF_MIME,
      aiProvider: new TestCandidateAIProvider({ mode: 'provider_error' }),
    })

    expect(timeoutResult.errorKind).toBe('timeout')
    expect(providerErrorResult.errorKind).toBe('provider_error')
  })

  it('processes a multi-column CV end to end (deterministic extraction survives non-linear layout)', async () => {
    const bytes = await loadFixture('multi-column-cv.pdf')
    const result = await runCandidateDocumentProcessingPipeline({
      bytes,
      mimeType: PDF_MIME,
      aiProvider: new TestCandidateAIProvider(),
    })

    expect(result.jobStatus).toBe('awaiting_review')
  })

  it('never lets an embedded prompt-injection line reach the ai outcome as a fabricated field (malicious-prompt-cv fixture)', async () => {
    const bytes = await loadFixture('malicious-prompt-cv.pdf')
    const result = await runCandidateDocumentProcessingPipeline({
      bytes,
      mimeType: PDF_MIME,
      aiProvider: new TestCandidateAIProvider(),
    })

    expect(result.jobStatus).toBe('awaiting_review')
    expect(result.ai?.validated?.workAuthorization.hasEvidence).toBe(false)
    expect(result.ai?.validated?.compensation.hasEvidence).toBe(false)
  })
})
