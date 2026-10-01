import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractJobDescriptionText } from './text-extraction'

/**
 * Reuses the candidate-document fixture set (test/fixtures/candidate-
 * documents/) rather than maintaining a second, duplicate set of PDF/DOCX
 * fixtures — a standard CV and a job description are both just "a PDF or
 * DOCX with a text layer" from the extraction layer's point of view (the
 * module under test never interprets content, only extracts it), and
 * these fixtures already cover the standard/corrupted/scanned cases this
 * suite needs (project engineering rule: reuse rather than duplicate).
 */
const FIXTURES_DIR = path.join(__dirname, '..', '..', 'test', 'fixtures', 'candidate-documents')

async function loadFixture(name: string): Promise<Uint8Array> {
  const buffer = await readFile(path.join(FIXTURES_DIR, name))
  return new Uint8Array(buffer)
}

const PDF_MIME = 'application/pdf'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

describe('extractJobDescriptionText', () => {
  it('extracts text from a real PDF and marks the job description parsed', async () => {
    const bytes = await loadFixture('standard-cv.pdf')
    const outcome = await extractJobDescriptionText(bytes, PDF_MIME)

    expect(outcome.jobDescriptionStatus).toBe('parsed')
    expect(outcome.textExtractionStatus).toBe('extracted')
    expect(outcome.textExtractionMethod).toBe('deterministic')
    expect(outcome.textExtractionLibrary).toBe('pdf-parse@2.4.5')
    expect(outcome.rawText).toContain('Jordan Ellis Rivera')
    expect(outcome.textExtractionErrorKind).toBeNull()
    expect(outcome.userMessage).toContain('extracted')
  })

  it('extracts text from a real DOCX and marks the job description parsed', async () => {
    const bytes = await loadFixture('standard-cv.docx')
    const outcome = await extractJobDescriptionText(bytes, DOCX_MIME)

    expect(outcome.jobDescriptionStatus).toBe('parsed')
    expect(outcome.textExtractionStatus).toBe('extracted')
    expect(outcome.textExtractionLibrary).toBe('mammoth@1.12.3')
    expect(outcome.rawText).not.toBeNull()
    expect((outcome.rawText ?? '').length).toBeGreaterThan(0)
  })

  it('routes a scanned/image-only PDF to a draft, human-actionable state — never fabricates text', async () => {
    const bytes = await loadFixture('scanned-cv.pdf')
    const outcome = await extractJobDescriptionText(bytes, PDF_MIME)

    expect(outcome.jobDescriptionStatus).toBe('draft')
    expect(outcome.textExtractionStatus).toBe('needs_ocr')
    expect(outcome.rawText).toBeNull()
    expect(outcome.userMessage.toLowerCase()).toContain('paste')
  })

  it('fails gracefully on a corrupted PDF — never crashes, never returns fabricated text', async () => {
    const bytes = await loadFixture('corrupted-file.pdf')
    const outcome = await extractJobDescriptionText(bytes, PDF_MIME)

    expect(outcome.jobDescriptionStatus).toBe('draft')
    expect(outcome.textExtractionStatus).toBe('error')
    expect(outcome.textExtractionErrorKind).toBe('corrupted_file')
    expect(outcome.rawText).toBeNull()
    // Never echoes raw parser exception / document bytes.
    expect(outcome.textExtractionErrorMessage).not.toMatch(/%PDF|stream|xref/)
  })

  it('fails gracefully on a corrupted DOCX', async () => {
    const bytes = await loadFixture('corrupted-file.docx')
    const outcome = await extractJobDescriptionText(bytes, DOCX_MIME)

    expect(outcome.jobDescriptionStatus).toBe('draft')
    expect(outcome.textExtractionStatus).toBe('error')
    expect(outcome.textExtractionErrorKind).toBe('corrupted_file')
    expect(outcome.rawText).toBeNull()
  })

  it('never lets extracted text carry AI-facing instructions unnoticed — extraction is purely mechanical', async () => {
    // A document containing embedded prompt-injection-style text still
    // extracts verbatim (this module never interprets content) — the
    // untrusted-input framing is enforced by callers (the AI extraction
    // step treats raw_text as data, never instructions), not by refusing
    // to extract it here.
    const bytes = await loadFixture('malicious-prompt-cv.pdf')
    const outcome = await extractJobDescriptionText(bytes, PDF_MIME)

    expect(outcome.textExtractionStatus).toBe('extracted')
    expect(outcome.rawText).toContain('Ignore all previous instructions')
  })
})
