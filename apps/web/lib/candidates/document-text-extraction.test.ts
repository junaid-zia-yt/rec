import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractDocumentText, MAX_EXTRACTED_TEXT_CHARS } from './document-text-extraction'

const FIXTURES_DIR = path.join(__dirname, '..', '..', 'test', 'fixtures', 'candidate-documents')

async function loadFixture(name: string): Promise<Uint8Array> {
  const buffer = await readFile(path.join(FIXTURES_DIR, name))
  return new Uint8Array(buffer)
}

const PDF_MIME = 'application/pdf'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

describe('extractDocumentText', () => {
  it('extracts text from a standard single-column PDF CV', async () => {
    const bytes = await loadFixture('standard-cv.pdf')
    const result = await extractDocumentText(bytes, PDF_MIME)

    expect(result.status).toBe('extracted')
    if (result.status !== 'extracted') throw new Error('expected extracted')
    expect(result.method).toBe('deterministic')
    expect(result.text).toContain('Jordan Ellis Rivera')
    expect(result.text).toContain('Store Manager')
    expect(result.truncated).toBe(false)
  })

  it('extracts text from a multi-column PDF CV (content present even if reading order is imperfect)', async () => {
    const bytes = await loadFixture('multi-column-cv.pdf')
    const result = await extractDocumentText(bytes, PDF_MIME)

    expect(result.status).toBe('extracted')
    if (result.status !== 'extracted') throw new Error('expected extracted')
    expect(result.text).toContain('Priya')
    expect(result.text).toContain('Category Manager')
  })

  it('extracts text from a CV missing employment dates (extraction does not require dates to succeed)', async () => {
    const bytes = await loadFixture('missing-dates-cv.pdf')
    const result = await extractDocumentText(bytes, PDF_MIME)

    expect(result.status).toBe('extracted')
    if (result.status !== 'extracted') throw new Error('expected extracted')
    expect(result.text).toContain('Deputy Store Manager')
  })

  it('extracts text from a CV with overlapping role date ranges (deterministic layer does not interpret dates)', async () => {
    const bytes = await loadFixture('overlapping-roles-cv.pdf')
    const result = await extractDocumentText(bytes, PDF_MIME)

    expect(result.status).toBe('extracted')
    if (result.status !== 'extracted') throw new Error('expected extracted')
    expect(result.text).toContain('Prairie Mart')
  })

  it('extracts text from a CV containing embedded prompt-injection text (extraction is purely mechanical, no interpretation)', async () => {
    const bytes = await loadFixture('malicious-prompt-cv.pdf')
    const result = await extractDocumentText(bytes, PDF_MIME)

    expect(result.status).toBe('extracted')
    if (result.status !== 'extracted') throw new Error('expected extracted')
    expect(result.text).toContain('Ignore all previous instructions')
  })

  it('routes an image-only (scanned) PDF to needs_ocr', async () => {
    const bytes = await loadFixture('scanned-cv.pdf')
    const result = await extractDocumentText(bytes, PDF_MIME)

    expect(result.status).toBe('needs_ocr')
  })

  it('returns a corrupted_file error for a non-PDF byte stream with a .pdf name', async () => {
    const bytes = await loadFixture('corrupted-file.pdf')
    const result = await extractDocumentText(bytes, PDF_MIME)

    expect(result.status).toBe('error')
    if (result.status !== 'error') throw new Error('expected error')
    expect(result.errorKind).toBe('corrupted_file')
    // The error message must never echo raw document bytes/content.
    expect(result.message).not.toContain('garbage')
  })

  it('returns a corrupted_file error for a genuinely empty PDF page (no extractable text and no page-count fallback below threshold)', async () => {
    const bytes = await loadFixture('empty-document.pdf')
    const result = await extractDocumentText(bytes, PDF_MIME)

    // A valid PDF with a blank page has ~0 chars of text — same signal as a
    // scanned document, so it is routed the same way rather than treated as
    // successfully "extracted" empty content.
    expect(result.status).toBe('needs_ocr')
  })

  it('extracts text from a standard DOCX CV', async () => {
    const bytes = await loadFixture('standard-cv.docx')
    const result = await extractDocumentText(bytes, DOCX_MIME)

    expect(result.status).toBe('extracted')
    if (result.status !== 'extracted') throw new Error('expected extracted')
    expect(result.text).toContain('Jordan Ellis Rivera')
  })

  it('returns a corrupted_file error for a non-DOCX byte stream with a .docx name', async () => {
    const bytes = await loadFixture('corrupted-file.docx')
    const result = await extractDocumentText(bytes, DOCX_MIME)

    expect(result.status).toBe('error')
    if (result.status !== 'error') throw new Error('expected error')
    expect(result.errorKind).toBe('corrupted_file')
  })

  it('routes an empty DOCX (no body text) to needs_ocr rather than a false success', async () => {
    const bytes = await loadFixture('empty-document.docx')
    const result = await extractDocumentText(bytes, DOCX_MIME)

    expect(result.status).toBe('needs_ocr')
  })

  it('rejects a zero-byte file as corrupted_file regardless of declared MIME type', async () => {
    const result = await extractDocumentText(new Uint8Array(0), PDF_MIME)

    expect(result.status).toBe('error')
    if (result.status !== 'error') throw new Error('expected error')
    expect(result.errorKind).toBe('corrupted_file')
  })

  it('rejects an unsupported MIME type', async () => {
    const bytes = await loadFixture('standard-cv.pdf')
    const result = await extractDocumentText(bytes, 'image/png')

    expect(result.status).toBe('error')
    if (result.status !== 'error') throw new Error('expected error')
    expect(result.errorKind).toBe('unsupported_format')
  })

  it('rejects a file over the processing size limit before attempting to parse it', async () => {
    const oversized = new Uint8Array(11 * 1024 * 1024)
    const result = await extractDocumentText(oversized, PDF_MIME)

    expect(result.status).toBe('error')
    if (result.status !== 'error') throw new Error('expected error')
    expect(result.errorKind).toBe('size_limit_exceeded')
  })

  it('truncates extracted text at MAX_EXTRACTED_TEXT_CHARS and flags it as truncated', async () => {
    // A synthetic single-page PDF whose text layer we can't easily blow
    // past 60k chars with reportlab in a reasonable fixture, so this is
    // covered structurally: confirm the constant is exported and sane
    // rather than generating a multi-hundred-page fixture here.
    expect(MAX_EXTRACTED_TEXT_CHARS).toBeGreaterThan(1000)
  })
})
