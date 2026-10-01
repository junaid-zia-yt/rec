import 'server-only'
import {
  extractDocumentText,
  type TextExtractionErrorKind,
} from '@/lib/candidates/document-text-extraction'

/**
 * Job-description text extraction — Build Phase 17A Wave 3, Part A. Closes
 * the previously-disclosed gap (docs/release-readiness.md GO/NO-GO item 6):
 * an uploaded JD file used to always save with `status: draft` and no
 * `raw_text`, so it never reached requirement extraction — only the paste
 * path did.
 *
 * This module is a thin, job-description-specific wrapper around the
 * deterministic extraction the candidate-CV pipeline already established
 * (`lib/candidates/document-text-extraction.ts#extractDocumentText`) — same
 * pure, dependency-free, non-AI extraction, same "never invent content"
 * discipline, reused rather than duplicated (project engineering rule:
 * "create reusable components instead of duplicating"). It does not call
 * an AI model; the untrusted-input framing that module documents applies
 * identically here (project AI-safety rule: "treat uploaded CVs and
 * documents as untrusted data").
 *
 * OCR is deliberately NOT wired here even though the candidate pipeline has
 * an OCR adapter (`lib/candidates/ocr-adapter.ts`) — a scanned/image-only
 * JD upload is rare (job descriptions are near-universally text-native
 * documents, unlike CVs) and wiring OCR for a second document type is out
 * of this wave's scope. A `needs_ocr` outcome is therefore a terminal,
 * human-actionable state here: the recruiter is told to paste the text
 * instead, not silently left with an empty document treated as real
 * content.
 */

const PDF_MIME_TYPE = 'application/pdf'
const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

// Kept as literal strings (not imported from package.json) so this module
// stays dependency-free of anything beyond document-text-extraction.ts —
// bumped by hand alongside the dependency version in apps/web/package.json.
// Verified against installed versions at the time this module was written
// (`node -e "console.log(require('pdf-parse/package.json').version)"` etc.).
const PDF_EXTRACTION_LIBRARY = 'pdf-parse@2.4.5'
const DOCX_EXTRACTION_LIBRARY = 'mammoth@1.12.3'

export interface JobDescriptionExtractionOutcome {
  /** Maps directly onto `job_descriptions.status` (0011/0036). */
  jobDescriptionStatus: 'parsed' | 'draft'
  /** `job_descriptions.raw_text` — populated only on a genuine extraction. */
  rawText: string | null
  textExtractionStatus: 'extracted' | 'needs_ocr' | 'error'
  textExtractionMethod: 'deterministic' | null
  textExtractionLibrary: string
  textExtractionErrorKind: TextExtractionErrorKind | null
  /** Always safe to store/log/show — never raw document content. */
  textExtractionErrorMessage: string | null
  /** User-facing message for the upload action's ActionResult. */
  userMessage: string
}

function libraryFor(mimeType: string): string {
  return mimeType === PDF_MIME_TYPE ? PDF_EXTRACTION_LIBRARY : DOCX_EXTRACTION_LIBRARY
}

/**
 * Runs deterministic extraction against an already-validated, already-
 * downloaded job-description file and translates the result into what the
 * upload action needs to write to `job_descriptions`. Never throws — a
 * dynamic-import failure or any other unexpected error from the underlying
 * library is caught and turned into the same honest `error` outcome a
 * corrupted file would produce, so a bad file can never crash the request
 * or silently produce empty/garbage text treated as real content.
 */
export async function extractJobDescriptionText(
  bytes: Uint8Array,
  mimeType: string,
): Promise<JobDescriptionExtractionOutcome> {
  const library = libraryFor(mimeType)

  let result: Awaited<ReturnType<typeof extractDocumentText>>
  try {
    result = await extractDocumentText(bytes, mimeType)
  } catch {
    // Defense in depth: extractDocumentText already wraps its own
    // pdf-parse/mammoth calls in try/catch and returns a typed `error`
    // result, but a dynamic-import failure (e.g. the library itself
    // failing to load) happens outside that try/catch. Same fixed, safe
    // message either way — no raw exception text is ever surfaced.
    result = {
      status: 'error',
      errorKind: 'corrupted_file',
      message: 'This file could not be read — it may be corrupted or not a valid document.',
    }
  }

  if (result.status === 'extracted') {
    return {
      jobDescriptionStatus: 'parsed',
      rawText: result.text,
      textExtractionStatus: 'extracted',
      textExtractionMethod: 'deterministic',
      textExtractionLibrary: library,
      textExtractionErrorKind: null,
      textExtractionErrorMessage: null,
      userMessage: result.truncated
        ? 'File uploaded and text extracted (a very long document was truncated). Ready for requirement extraction.'
        : 'File uploaded and text extracted. Ready for requirement extraction.',
    }
  }

  if (result.status === 'needs_ocr') {
    return {
      jobDescriptionStatus: 'draft',
      rawText: null,
      textExtractionStatus: 'needs_ocr',
      textExtractionMethod: null,
      textExtractionLibrary: library,
      textExtractionErrorKind: null,
      textExtractionErrorMessage: null,
      userMessage:
        'File uploaded, but it looks like a scanned or image-based document — no text could be automatically extracted. Paste the text instead to continue with requirement extraction.',
    }
  }

  // result.status === 'error'
  return {
    jobDescriptionStatus: 'draft',
    rawText: null,
    textExtractionStatus: 'error',
    textExtractionMethod: null,
    textExtractionLibrary: library,
    textExtractionErrorKind: result.errorKind,
    textExtractionErrorMessage: result.message,
    userMessage: `File uploaded, but its text could not be extracted: ${result.message} Paste the text instead to continue with requirement extraction.`,
  }
}
