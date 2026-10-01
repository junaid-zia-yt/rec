/**
 * File-security validation for job-description and candidate-document
 * (Build Phase 5 brief §"CV document management") uploads. Deliberately a
 * pure, dependency-free module (no Supabase, no Next.js) so every rule here
 * is unit-testable without a live project, and so the same rules can be
 * reused by a future mobile app.
 *
 * Every uploaded document is untrusted input (docs/12-security-
 * compliance.md, project AI-safety rule "treat uploaded CVs and documents
 * as untrusted data") — this module is the first gate a file passes
 * through, before anything is written to Storage or a database row.
 */

/** Allow-list only — anything not explicitly listed here is rejected, including formats that "should" be safe. */
export const ALLOWED_JOB_DESCRIPTION_TYPES = [
  {
    mimeType: 'application/pdf',
    extensions: ['.pdf'],
    label: 'PDF',
  },
  {
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extensions: ['.docx'],
    label: 'Word document (.docx)',
  },
] as const

/** Executable/script content types explicitly rejected even if a caller somehow bypasses the allow-list check (defense in depth — belt and suspenders, not the primary gate). */
const BLOCKED_EXTENSIONS = [
  '.exe',
  '.bat',
  '.cmd',
  '.com',
  '.msi',
  '.sh',
  '.js',
  '.jse',
  '.vbs',
  '.vbe',
  '.ps1',
  '.scr',
  '.dll',
  '.jar',
  '.app',
]

export const MAX_JOB_DESCRIPTION_FILE_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB

/** Same allow-listed formats as a job description (PDF/DOCX) — CVs and cover letters use the identical format policy, kept as its own named constant so the two can diverge independently later without touching shared logic. */
export const ALLOWED_CANDIDATE_DOCUMENT_TYPES = ALLOWED_JOB_DESCRIPTION_TYPES
export const MAX_CANDIDATE_DOCUMENT_FILE_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB

export interface FileValidationInput {
  fileName: string
  mimeType: string
  sizeBytes: number
}

export interface FileValidationResult {
  valid: boolean
  /** Machine-checkable reason, for tests and for branching UI copy. */
  reason?:
    | 'empty_file'
    | 'file_too_large'
    | 'extension_not_allowed'
    | 'mime_type_not_allowed'
    | 'extension_mime_mismatch'
    | 'blocked_extension'
  /** Human-readable message safe to show the person who uploaded the file. */
  message?: string
}

function getExtension(fileName: string): string {
  const trimmed = fileName.trim().toLowerCase()
  const lastDot = trimmed.lastIndexOf('.')
  return lastDot === -1 ? '' : trimmed.slice(lastDot)
}

type AllowedType = (typeof ALLOWED_JOB_DESCRIPTION_TYPES)[number]

/**
 * Shared validation core: allow-list, size limit, executable-extension
 * blocking, and extension↔MIME cross-check (a common spoofing vector: a
 * renamed .exe presented with a document MIME type, or vice versa). Checks
 * metadata only — it does not (and cannot, in a pure module) inspect file
 * bytes; callers that need magic-byte sniffing do that separately before
 * this function is trusted as the final gate. Both
 * validateJobDescriptionFile and validateCandidateDocumentFile are thin
 * wrappers around this — same rules, different allow-list/size-limit
 * parameters, so the two can diverge later without duplicating the logic.
 */
function validateDocumentFile(
  input: FileValidationInput,
  allowedTypes: readonly AllowedType[],
  maxSizeBytes: number,
): FileValidationResult {
  if (input.sizeBytes <= 0) {
    return { valid: false, reason: 'empty_file', message: 'The file is empty.' }
  }

  if (input.sizeBytes > maxSizeBytes) {
    return {
      valid: false,
      reason: 'file_too_large',
      message: `Files must be ${maxSizeBytes / (1024 * 1024)} MB or smaller.`,
    }
  }

  const extension = getExtension(input.fileName)

  if (BLOCKED_EXTENSIONS.includes(extension)) {
    return {
      valid: false,
      reason: 'blocked_extension',
      message: 'Executable files are not allowed.',
    }
  }

  const matchByExtension = allowedTypes.find((t) =>
    (t.extensions as readonly string[]).includes(extension),
  )
  if (!matchByExtension) {
    return {
      valid: false,
      reason: 'extension_not_allowed',
      message: 'Only PDF and Word (.docx) files are accepted.',
    }
  }

  const matchByMime = allowedTypes.find((t) => t.mimeType === input.mimeType)
  if (!matchByMime) {
    return {
      valid: false,
      reason: 'mime_type_not_allowed',
      message: 'Only PDF and Word (.docx) files are accepted.',
    }
  }

  if (matchByExtension.mimeType !== matchByMime.mimeType) {
    return {
      valid: false,
      reason: 'extension_mime_mismatch',
      message: "This file's extension and content type don't match.",
    }
  }

  return { valid: true }
}

export function validateJobDescriptionFile(input: FileValidationInput): FileValidationResult {
  return validateDocumentFile(
    input,
    ALLOWED_JOB_DESCRIPTION_TYPES,
    MAX_JOB_DESCRIPTION_FILE_SIZE_BYTES,
  )
}

/** Validates a CV/cover-letter/reference upload (Build Phase 5 brief §"CV document management": "PDF and DOCX", "Size limits", "MIME validation"). Same rules as a job description, reused rather than duplicated. */
export function validateCandidateDocumentFile(input: FileValidationInput): FileValidationResult {
  return validateDocumentFile(
    input,
    ALLOWED_CANDIDATE_DOCUMENT_TYPES,
    MAX_CANDIDATE_DOCUMENT_FILE_SIZE_BYTES,
  )
}

/**
 * Deterministic, private Storage path for an uploaded document — never
 * guessable from the entity id alone (a random component is included so an
 * enumeration attempt against document_uploads can't be paired with a
 * predictable Storage path), and always prefixed with the owning
 * organization id so storage RLS (supabase/migrations/0014_document_storage.sql)
 * can check tenancy from the path alone via storage.foldername().
 */
export function buildDocumentStoragePath(input: {
  organizationId: string
  ownerType: 'job_description' | 'candidate_document'
  ownerId: string
  fileName: string
  randomComponent: string
}): string {
  const safeFileName = input.fileName
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(-120) // keep the meaningful tail (name + extension) if very long

  return `${input.organizationId}/${input.ownerType}/${input.ownerId}/${input.randomComponent}-${safeFileName}`
}
