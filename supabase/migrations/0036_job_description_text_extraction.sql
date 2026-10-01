-- 0036_job_description_text_extraction.sql
-- Build Phase 17A, Wave 3, Part A: closes the documented uploaded-JD
-- extraction gap (docs/release-readiness.md GO/NO-GO item 6 — "today only
-- the paste path reaches requirement extraction"). Adds extraction-
-- provenance columns to `job_descriptions` (0011) so an uploaded PDF/DOCX
-- can carry the same deterministic-extraction record the candidate-
-- document pipeline already keeps on `candidate_document_processing_jobs`
-- (0022) — which library/method was used, and, on failure, a safe,
-- non-sensitive error kind/message (never raw document content, per the
-- project AI-safety rule).
--
-- `raw_text` and `status` (0011) already carry the *result* (populated text
-- + 'parsed', or left null + 'draft'); these columns explain the *how*, for
-- audit and for a future "reprocess" action to know what was already tried.

alter table public.job_descriptions
  add column if not exists text_extraction_status text
    check (text_extraction_status in ('extracted', 'needs_ocr', 'error')),
  add column if not exists text_extraction_method text
    check (text_extraction_method in ('deterministic')),
  add column if not exists text_extraction_library text,
  add column if not exists text_extraction_error_kind text
    check (text_extraction_error_kind in (
      'corrupted_file', 'unsupported_format', 'size_limit_exceeded'
    )),
  add column if not exists text_extraction_error_message text,
  add column if not exists text_extraction_attempted_at timestamptz;

comment on column public.job_descriptions.text_extraction_status is
  'Outcome of deterministic text-layer extraction for an uploaded file (null for a pasted JD, which needs no extraction). "needs_ocr" means the document has no usable text layer (e.g. a scanned/image-only PDF) — OCR is not wired for job descriptions in this build, so this is a terminal, human-actionable state (paste the text manually), same honest-gap framing as the original build-phase-3 comment this migration supersedes.';
comment on column public.job_descriptions.text_extraction_library is
  'Library@version actually used, e.g. "pdf-parse@2.4.5" or "mammoth@1.12.3" — extraction provenance for audit, matching the project rule that every AI/automated step be auditable (this step is deterministic, not AI, but the same discipline applies).';
comment on column public.job_descriptions.text_extraction_error_message is
  'Always a safe, fixed diagnostic string — never a raw parser exception or document content (project AI-safety rule: uploaded documents are untrusted; see lib/candidates/document-text-extraction.ts, whose extractDocumentText this module reuses, for the identical discipline on the candidate-CV side).';
