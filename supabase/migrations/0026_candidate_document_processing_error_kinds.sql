-- Build Phase 6 fix: candidate_document_processing_jobs.error_kind (0022)
-- was missing two real outcomes the orchestration layer
-- (apps/web/lib/candidates/document-processing-pipeline.ts) can produce:
--
--   ai_not_configured — no ANTHROPIC_API_KEY is set (this environment's
--     actual state today — see docs/build-phase-4-report.md /
--     docs/build-phase-5-report.md's carried-forward blocker). Distinct
--     from ocr_not_configured, which is about the separate OCR adapter.
--   network — the AI provider request could not reach the network at all
--     (AIProviderError kind: 'network' — lib/ai/provider.ts), distinct
--     from a timeout (the request reached the provider but didn't
--     complete in time) and from provider_error (the provider responded
--     with an error).

alter table public.candidate_document_processing_jobs
  drop constraint if exists candidate_document_processing_jobs_error_kind_check;
alter table public.candidate_document_processing_jobs
  add constraint candidate_document_processing_jobs_error_kind_check check (
    error_kind is null or error_kind in (
      'corrupted_file', 'unsupported_format', 'size_limit_exceeded',
      'ocr_not_configured', 'ai_not_configured', 'timeout', 'network',
      'provider_error', 'validation_failed'
    )
  );
