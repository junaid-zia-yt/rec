import { describe, expect, it } from 'vitest'
import {
  buildDocumentStoragePath,
  MAX_JOB_DESCRIPTION_FILE_SIZE_BYTES,
  MAX_CANDIDATE_DOCUMENT_FILE_SIZE_BYTES,
  validateJobDescriptionFile,
  validateCandidateDocumentFile,
} from './validate'

const PDF = {
  fileName: 'job-description.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 1024,
}

const DOCX = {
  fileName: 'job-description.docx',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  sizeBytes: 2048,
}

describe('validateJobDescriptionFile — Build Phase 3 brief §"File security"', () => {
  it('accepts a well-formed PDF', () => {
    expect(validateJobDescriptionFile(PDF)).toEqual({ valid: true })
  })

  it('accepts a well-formed DOCX', () => {
    expect(validateJobDescriptionFile(DOCX)).toEqual({ valid: true })
  })

  it('rejects an empty file', () => {
    const result = validateJobDescriptionFile({ ...PDF, sizeBytes: 0 })
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('empty_file')
  })

  it('rejects a file over the size limit', () => {
    const result = validateJobDescriptionFile({
      ...PDF,
      sizeBytes: MAX_JOB_DESCRIPTION_FILE_SIZE_BYTES + 1,
    })
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('file_too_large')
  })

  it('rejects an unapproved format even with a plausible name (e.g. .txt)', () => {
    const result = validateJobDescriptionFile({
      fileName: 'notes.txt',
      mimeType: 'text/plain',
      sizeBytes: 100,
    })
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('extension_not_allowed')
  })

  it('rejects an executable disguised with an allowed-looking size', () => {
    const result = validateJobDescriptionFile({
      fileName: 'resume_opener.exe',
      mimeType: 'application/x-msdownload',
      sizeBytes: 1024,
    })
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('blocked_extension')
  })

  it('rejects a script file (.js) even if the caller lies about the MIME type', () => {
    const result = validateJobDescriptionFile({
      fileName: 'payload.js',
      mimeType: 'application/pdf',
      sizeBytes: 100,
    })
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('blocked_extension')
  })

  it('rejects a .pdf extension paired with a non-PDF MIME type (spoofing attempt)', () => {
    const result = validateJobDescriptionFile({
      fileName: 'resume.pdf',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: 100,
    })
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('extension_mime_mismatch')
  })

  it('rejects a MIME type that is not on the allow-list at all', () => {
    const result = validateJobDescriptionFile({
      fileName: 'job.doc',
      mimeType: 'application/msword',
      sizeBytes: 100,
    })
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('extension_not_allowed')
  })

  it('is case-insensitive on the extension', () => {
    expect(validateJobDescriptionFile({ ...PDF, fileName: 'JOB.PDF' }).valid).toBe(true)
  })
})

describe('buildDocumentStoragePath', () => {
  it('always prefixes the path with the organization id (what storage RLS checks)', () => {
    const path = buildDocumentStoragePath({
      organizationId: 'org-123',
      ownerType: 'job_description',
      ownerId: 'jd-1',
      fileName: 'job.pdf',
      randomComponent: 'random-uuid',
    })
    expect(path.startsWith('org-123/job_description/jd-1/')).toBe(true)
  })

  it('strips path separators and shell metacharacters out of the file name (no traversal, no injection)', () => {
    const path = buildDocumentStoragePath({
      organizationId: 'org-123',
      ownerType: 'job_description',
      ownerId: 'jd-1',
      fileName: '../../etc/passwd; rm -rf.pdf',
      randomComponent: 'r1',
    })
    // The path has exactly the 4 separators this function itself inserts
    // (org/ownerType/ownerId/random-filename) — none contributed by the
    // untrusted file name, so no extra path segment can be smuggled in.
    expect(path.split('/')).toHaveLength(4)
    expect(path).not.toMatch(/;/)
  })

  it('includes a random component so the path is not guessable from ids alone', () => {
    const base = {
      organizationId: 'org-123',
      ownerType: 'job_description' as const,
      ownerId: 'jd-1',
      fileName: 'job.pdf',
    }
    const pathA = buildDocumentStoragePath({ ...base, randomComponent: 'aaa' })
    const pathB = buildDocumentStoragePath({ ...base, randomComponent: 'bbb' })
    expect(pathA).not.toBe(pathB)
  })

  it('candidate_document owner type produces a path with candidate_document as its second segment', () => {
    const path = buildDocumentStoragePath({
      organizationId: 'org-123',
      ownerType: 'candidate_document',
      ownerId: 'cand-1',
      fileName: 'resume.pdf',
      randomComponent: 'rand',
    })
    expect(path.split('/')[1]).toBe('candidate_document')
  })
})

describe('validateCandidateDocumentFile — Build Phase 5 brief §"CV document management"', () => {
  const CV_PDF = { fileName: 'jane-doe-cv.pdf', mimeType: 'application/pdf', sizeBytes: 4096 }
  const CV_DOCX = {
    fileName: 'jane-doe-cv.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    sizeBytes: 4096,
  }

  it('accepts a well-formed CV PDF', () => {
    expect(validateCandidateDocumentFile(CV_PDF)).toEqual({ valid: true })
  })

  it('accepts a well-formed CV DOCX', () => {
    expect(validateCandidateDocumentFile(CV_DOCX)).toEqual({ valid: true })
  })

  it('rejects an oversized CV', () => {
    const result = validateCandidateDocumentFile({
      ...CV_PDF,
      sizeBytes: MAX_CANDIDATE_DOCUMENT_FILE_SIZE_BYTES + 1,
    })
    expect(result).toEqual({
      valid: false,
      reason: 'file_too_large',
      message: expect.stringContaining('MB or smaller'),
    })
  })

  it('rejects a renamed-executable CV (extension/MIME mismatch)', () => {
    const result = validateCandidateDocumentFile({
      fileName: 'cv.pdf',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: 1024,
    })
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('extension_mime_mismatch')
  })

  it('rejects an unsupported format (e.g. plain text CV)', () => {
    const result = validateCandidateDocumentFile({
      fileName: 'cv.txt',
      mimeType: 'text/plain',
      sizeBytes: 1024,
    })
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('extension_not_allowed')
  })

  it('rejects a blocked executable extension outright, even with a spoofed document MIME type', () => {
    const result = validateCandidateDocumentFile({
      fileName: 'cv.exe',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    })
    expect(result).toEqual({
      valid: false,
      reason: 'blocked_extension',
      message: 'Executable files are not allowed.',
    })
  })
})
