-- Build Phase 6 fix: narrow the "one in-flight job per document" partial
-- unique index (0022) to the statuses that represent genuinely ACTIVE
-- work, not every non-terminal status.
--
-- 0022 originally blocked on ('queued', 'extracting_text', 'needs_ocr',
-- 'parsing', 'awaiting_review'). On reflection this over-blocks: a job
-- resting at 'needs_ocr' (no OCR provider configured — see
-- lib/candidates/ocr-adapter.ts) or 'awaiting_review' (a completed
-- proposal, waiting on a human) is stopped and waiting for a human
-- decision, not doing active work — and the brief's "Reprocess with
-- reason" UI state must be able to start a fresh attempt from either of
-- those states without first mutating the old job's own history (which
-- would misrepresent what actually happened during that attempt).
--
-- Only 'queued', 'extracting_text', and 'parsing' now count as in-flight:
-- those are the states where a second concurrent attempt against the same
-- document would be a genuine duplicate/race, which is exactly what this
-- index exists to prevent (brief §SECURITY: "Make jobs idempotent").

drop index if exists public.candidate_document_processing_jobs_one_inflight_idx;

create unique index candidate_document_processing_jobs_one_inflight_idx
  on public.candidate_document_processing_jobs (candidate_document_id)
  where status in ('queued', 'extracting_text', 'parsing');
