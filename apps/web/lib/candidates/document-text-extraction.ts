import 'server-only'

/**
 * Deterministic text extraction for candidate documents (Build Phase 6
 * brief §AI PIPELINE steps 2-4: "Extract text using deterministic parsers
 * first", "Detect unreadable or scanned documents", "Route OCR-required
 * documents to a documented adapter").
 *
 * This module is deliberately dependency-free of Supabase/Next.js — it
 * takes already-downloaded bytes (lib/files/storage.ts#downloadDocumentBytes)
 * and a MIME type, and returns a discriminated result. It never calls an AI
 * model: extraction here is 100% deterministic library code, kept separate
 * from the AI parsing step (task #40) per docs/09-ai-architecture.md's
 * "separate deterministic rules from AI interpretation" rule.
 *
 * SECURITY: the bytes and any extracted text passed through this module are
 * untrusted document content (project AI-safety rule). This module must
 * never log the extracted text or a raw exception message that could embed
 * document content — only bounded, non-sensitive diagnostic strings.
 */

const MAX_PROCESSABLE_SIZE_BYTES = 10 * 1024 * 1024 // matches MAX_CANDIDATE_DOCUMENT_FILE_SIZE_BYTES (lib/files/validate.ts) — re-checked here since this module may be called independently of the upload path

/**
 * Hard cap on how much extracted text is carried forward into the AI
 * parsing step (Build Phase 6 brief §SECURITY: "Apply document size and
 * processing limits"). A CV should never legitimately produce more than a
 * few thousand words of text; anything past this is truncated rather than
 * rejected, so an unusually long but genuine document still gets processed
 * on its first pages/sections rather than failing outright.
 */
export const MAX_EXTRACTED_TEXT_CHARS = 60_000

/**
 * Below this character count (for a document with at least one page), the
 * extracted text is treated as too sparse to be a real text layer and is
 * routed to OCR instead of the AI parser (Build Phase 6 brief §AI PIPELINE
 * step 3: "Detect unreadable or scanned documents"). Calibrated against a
 * smoke-tested image-only PDF, whose page-marker boilerplate alone runs to
 * roughly a dozen characters per page — this threshold sits well above that
 * noise floor and well below what even a very short one-page CV contains.
 */
const MIN_CHARS_PER_PAGE_FOR_TEXT_LAYER = 40

export type SupportedDocumentMimeType =
  'application/pdf' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export type TextExtractionErrorKind =
  'corrupted_file' | 'unsupported_format' | 'size_limit_exceeded'

export type TextExtractionResult =
  | {
      status: 'extracted'
      method: 'deterministic'
      text: string
      charCount: number
      truncated: boolean
    }
  | { status: 'needs_ocr'; charCountFound: number; pageCount: number | null }
  | { status: 'error'; errorKind: TextExtractionErrorKind; message: string }

function truncate(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_EXTRACTED_TEXT_CHARS) {
    return { text, truncated: false }
  }
  return { text: text.slice(0, MAX_EXTRACTED_TEXT_CHARS), truncated: true }
}

async function extractFromPdf(bytes: Uint8Array): Promise<TextExtractionResult> {
  const { PDFParse } = await import('pdf-parse')

  let parsed: { text: string; total?: number } | null = null
  try {
    // pdf-parse/pdf.js can detach/consume the underlying buffer it's given
    // (observed: a second parse reusing the same Uint8Array instance fails
    // as if corrupted) — pass it a fresh copy so the caller's own buffer is
    // never mutated and can safely be reused (e.g. by a caller that reads
    // the same downloaded bytes for more than one purpose).
    const parser = new PDFParse({ data: new Uint8Array(bytes) })
    parsed = await parser.getText()
  } catch {
    // pdf-parse throws a typed InvalidPDFException (and similar) on
    // corrupted or unparsable input. The underlying message can echo raw
    // file bytes/structure, so it is deliberately not included here — only
    // a safe, fixed diagnostic string (§SECURITY: no raw document content
    // in logs or error messages).
    return {
      status: 'error',
      errorKind: 'corrupted_file',
      message: 'This PDF could not be read — it may be corrupted or not a valid PDF file.',
    }
  }

  const text = parsed?.text ?? ''
  const pageCount = typeof parsed?.total === 'number' ? parsed.total : null
  const minCharsExpected = MIN_CHARS_PER_PAGE_FOR_TEXT_LAYER * Math.max(pageCount ?? 1, 1)

  if (text.trim().length < minCharsExpected) {
    return { status: 'needs_ocr', charCountFound: text.trim().length, pageCount }
  }

  const { text: finalText, truncated } = truncate(text)
  return {
    status: 'extracted',
    method: 'deterministic',
    text: finalText,
    charCount: finalText.length,
    truncated,
  }
}

async function extractFromDocx(bytes: Uint8Array): Promise<TextExtractionResult> {
  const mammoth = await import('mammoth')

  let value: string
  try {
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) })
    value = result.value
  } catch {
    return {
      status: 'error',
      errorKind: 'corrupted_file',
      message:
        'This Word document could not be read — it may be corrupted or not a valid .docx file.',
    }
  }

  const trimmed = value.trim()
  if (trimmed.length < MIN_CHARS_PER_PAGE_FOR_TEXT_LAYER) {
    // A .docx with (near-)no extractable text is not a "scanned" document in
    // the PDF sense (Word files don't carry scanned page images), but the
    // same "too sparse to parse" outcome applies — route it through the
    // same needs_ocr/manual-review path rather than silently accepting an
    // effectively empty document as valid input to the AI parser.
    return { status: 'needs_ocr', charCountFound: trimmed.length, pageCount: null }
  }

  const { text: finalText, truncated } = truncate(trimmed)
  return {
    status: 'extracted',
    method: 'deterministic',
    text: finalText,
    charCount: finalText.length,
    truncated,
  }
}

/**
 * Extracts text from an already-downloaded, already-validated candidate
 * document. Callers are expected to have already run
 * `validateCandidateDocumentFile` (or equivalent) at upload time — this
 * function re-checks only the size limit (defense in depth, since it may be
 * invoked well after upload, e.g. on reprocess) and the MIME type.
 */
export async function extractDocumentText(
  bytes: Uint8Array,
  mimeType: string,
): Promise<TextExtractionResult> {
  if (bytes.byteLength <= 0) {
    return { status: 'error', errorKind: 'corrupted_file', message: 'The document is empty.' }
  }

  if (bytes.byteLength > MAX_PROCESSABLE_SIZE_BYTES) {
    return {
      status: 'error',
      errorKind: 'size_limit_exceeded',
      message: `Documents must be ${MAX_PROCESSABLE_SIZE_BYTES / (1024 * 1024)} MB or smaller.`,
    }
  }

  if (mimeType === 'application/pdf') {
    return extractFromPdf(bytes)
  }

  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return extractFromDocx(bytes)
  }

  return {
    status: 'error',
    errorKind: 'unsupported_format',
    message: 'Only PDF and Word (.docx) files can be processed.',
  }
}
