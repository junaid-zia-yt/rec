# Build Phase 6 report — AI candidate document processing

Per docs/21-implementation-contract.md §21.14 and the Build Phase 6
completion gate ("I approve the AI Candidate Document Processing
build... Apply the Mandatory Completion Gate"). Covers exactly what this
phase implements: secure CV parsing, deterministic-first text extraction
with documented OCR routing, an evidence-grounded AI extraction pipeline
that treats CV content as untrusted data, per-field human verification,
and applying accepted fields into the candidate's real record without
touching the source document. Candidate-to-job match scoring is
explicitly out of scope for this phase, per the brief ("Do not implement
candidate-to-job scoring in this build"), and is untouched.

**The same two blockers carried into every prior phase's report remain
unchanged in kind, plus one new one specific to this phase**:

1. No live Supabase project is connected to this repository's
   environment (no `apps/web/.env.local`, no `SUPABASE_*` env vars) — the
   full schema and RLS policy set were instead functionally verified
   against a real local PostgreSQL 16 instance (§1.1, §2.2).
2. No `ANTHROPIC_API_KEY` is configured — this phase's entire AI-parsing
   path (`AnthropicCandidateProvider`) has never been exercised against
   the real API; its behavior is verified via the deterministic
   `TestCandidateAIProvider` double instead, run against real generated
   CV fixtures through the actual orchestration/validation code
   (§1.3, §2).
3. **New this phase:** no OCR provider is configured or has been chosen
   as a business decision. `NotConfiguredOcrAdapter`
   (`apps/web/lib/candidates/ocr-adapter.ts`) is the only `OcrAdapter`
   implementation present — a scanned CV routes to a real, persisted,
   reviewable `needs_ocr` state rather than a fake success or a silent
   failure. Choosing and configuring a real OCR vendor is a business/
   credentials decision this build phase does not make (project
   engineering rule: "Stop and report blockers when required credentials,
   business decisions or source data are missing").

Everything below is code-complete, typechecked, linted, and tested at
every layer that does not require a live backend or a real AI/OCR
provider, and — going further than static review — the full schema and
its Row Level Security policies were functionally verified against a
real local PostgreSQL 16 instance, including live role-switching RLS
tests specific to the two new tables (§2.2).

## 0. Pre-build verification

The full existing test/typecheck/lint/build suite was confirmed green
before any Phase 6 code was written (230 tests, matching the Phase 5
report's final count after that phase's close-out).

## 1. What was implemented

### 1.1 Database schema + RLS (migrations `0022`, `0023`, `0024`, `0025`, `0026`)

| Migration                                             | Adds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0022_candidate_document_processing.sql`              | `candidate_document_processing_jobs` (one row per processing attempt: status state machine, text_extraction_method, extracted_text/char_count, error_kind, ai_run_id, prompt_version, model, retried, idempotency_key + partial unique in-flight index, attempt_no, reprocess_of_job_id/_reason) and `candidate_extracted_fields` (one evidence row per field: field_group/field_key/item_index, extracted_value jsonb, has_evidence, source_document_id/location/excerpt, confidence, verification_status, edited_value, reviewer_id/reviewed_at, applied_at) with three CHECK constraints enforcing the review-pair invariant, the edited-value invariant, and the "unknown means no value/excerpt/confidence" invariant. RLS: jobs table never client-visible (matches `candidate_documents`); evidence table client-visible per the matrix's `candidate_evidence: read`. |
| `0023_candidate_profile_details_ai_source.sql`        | Widens `candidate_experiences`/`candidate_education`/`candidate_certifications`/`candidate_skills`' `source` CHECK to also allow `'ai'` — Build Phase 5's own schema comment had already anticipated this; this migration is the small change that comment promised.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `0024_candidate_profiles_ai_fields.sql`               | Adds `candidate_profiles.leadership_scope`, `.pnl_responsibility`, `.compensation_notes` — three brief §EXTRACT fields with no existing structured home.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `0025_candidate_document_processing_inflight_fix.sql` | **Self-correction, found during this phase's own build, not by a later review.** `0022`'s original "one in-flight job" partial index blocked on `needs_ocr`/`awaiting_review` in addition to the genuinely active states — which would have made "Reprocess with reason" impossible from either of those resting states without first mutating the old job's history. Narrowed to `queued`/`extracting_text`/`parsing` only.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `0026_candidate_document_processing_error_kinds.sql`  | Adds `ai_not_configured` and `network` to `error_kind` — two real outcomes (`AIProviderError` kinds mirrored from Build Phase 4's `lib/ai/provider.ts`) `0022`'s original enum was missing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

All six migrations (`0022`–`0026`, plus a from-scratch replay of `0001`–`0021`) were applied to a freshly created local PostgreSQL 16 database in strict numeric order with zero errors — a real functional check, not a syntax review.

### 1.2 Deterministic text extraction + OCR routing

`apps/web/lib/candidates/document-text-extraction.ts` — `extractDocumentText(bytes, mimeType)`, using `pdf-parse` (PDF) and `mammoth` (DOCX), both smoke-tested against real generated fixtures before any production code was written. Returns a discriminated `extracted | needs_ocr | error` result:

- **Scanned/unreadable detection**: extracted text below `MIN_CHARS_PER_PAGE_FOR_TEXT_LAYER` (40) per page routes to `needs_ocr` rather than a false "extracted nothing" success — calibrated against a real image-only PDF fixture whose page-marker boilerplate alone runs to roughly a dozen characters per page.
- **Size/processing limits**: re-checked independently of the upload-time validator (`MAX_PROCESSABLE_SIZE_BYTES`, 10 MB), and extracted text is truncated at `MAX_EXTRACTED_TEXT_CHARS` (60,000) before being handed to the AI step.
- **Corrupted-file handling**: a typed `corrupted_file` result, with a fixed, safe message — never the raw parser exception, which could echo document bytes/structure.
- **A real bug found by testing, not review**: `pdf-parse`/pdf.js detaches or otherwise consumes the `Uint8Array` buffer it is given, so re-parsing the same in-memory buffer a second time silently produced a false `corrupted_file` result. Fixed by copying the buffer before every parse (`new Uint8Array(bytes)`), documented at the call site.

`apps/web/lib/candidates/ocr-adapter.ts` — a typed `OcrAdapter` interface (brief: "Route OCR-required documents to a documented adapter") with the one implementation this build ships, `NotConfiguredOcrAdapter`, which always reports `not_configured` and never fabricates text — mirroring the `AnthropicProvider`/`anthropicConfigured` honest-failure pattern Build Phase 4 established for a missing API key.

### 1.3 AI parsing pipeline

Mirrors Build Phase 4's requirement-extraction pattern field-for-field, as a parallel set of candidate-specific files rather than a generic abstraction (the two request/response shapes and prompts are different enough that forcing a shared interface would have obscured more than it saved):

- `packages/types/src/index.ts` — `CandidateExtractionOutputSchema` (the brief's full §EXTRACT field list), each scalar wrapped by a private `extractedScalarField()` helper whose `.refine()` rejects `hasEvidence: false` carrying any value/excerpt/confidence — the schema-level enforcement of "if evidence is absent, return unknown." Each repeated-group item (contact, employment history, skill, education, certification, industry exposure) carries its own excerpt/location/confidence; array presence itself is the evidence signal for those.
- `apps/web/lib/ai/candidate-prompt.ts` — system prompt encoding the trust boundary (CV text is DATA inside `<candidate_document>` tags, never instructions) and the evidence rules verbatim, with explicit extra emphasis that work authorization/compensation/availability must never be inferred from indirect signals (nationality-sounding names, job seniority, employment dates) — the fields most likely to carry improperly-inferred sensitive eligibility information if a model over-reaches.
- `apps/web/lib/ai/candidate-provider.ts` / `anthropic-candidate-provider.ts` / `candidate-test-adapter.ts` — the typed provider interface, the real (never-exercised-here) Anthropic implementation with a hand-maintained tool-use JSON schema mirroring the Zod schema field-for-field, and a deterministic line-prefix-driven offline test double.
- `apps/web/lib/ai/parse-candidate-document.ts` — `runCandidateDocumentExtraction()`: the same not_configured → call → validate → retry-once-on-invalid → success/rejected_by_validation/error state machine as `extract-requirements.ts`, reused as a pattern rather than as shared code.
- `apps/web/lib/candidates/document-processing-pipeline.ts` — `runCandidateDocumentProcessingPipeline()`, the pure, database-free orchestration tying extraction → OCR routing → AI parsing into one function, fully unit-testable against real fixture files without a database (§2).
- `apps/web/lib/candidates/document-processing.ts` — `mapExtractionOutputToFieldRows()`, the pure mapping from one validated AI output to the flat list of `candidate_extracted_fields` rows a job proposes.

### 1.4 Server actions

`apps/web/lib/candidates/document-processing-actions.ts`:

- `startCandidateDocumentProcessingAction` / `reprocessCandidateDocumentAction` — create a job row and run the full pipeline inline and synchronously (this environment has no background job queue configured; a future phase can move the pipeline body into a real worker without changing these actions' contract). Reprocess requires a non-empty reason.
- `verifyExtractedFieldAction` / `rejectExtractedFieldAction` / `editExtractedFieldAction` — the per-field human review actions; an edit stores the correction in `edited_value`, never overwriting the model's original `extracted_value`.
- `acceptAllVerifiedFieldsAction` — applies every verified/edited, not-yet-applied field for a job into the real candidate record (§7.8 of docs/07-data-model.md has the full column-routing table) and stamps `applied_at`.

Every write action is gated on the `candidate_documents` permission resource, not `candidate_evidence` — an explicit, documented interpretation (docs/06-roles-permissions.md §6.2.4, docs/07-data-model.md §7.8) rather than a silent choice.

### 1.5 UI

`apps/web/components/domain/candidates/candidate-document-processing-panel.tsx`, wired into the candidate detail page as a new "AI Processing" tab: document picker, start/reprocess controls, a processing-progress indicator, the `needs_ocr`/`failed` states with a reason-required reprocess form, and — once `awaiting_review` — one card per extracted field showing its source excerpt (the "original-document evidence viewer," short of a full PDF page viewer, which would need a live Storage-backed signed-URL preview this environment cannot exercise), a confidence badge, and Verify/Edit/Reject controls, plus an "Accept all verified fields" action. One responsive component rather than a separate mobile implementation — the stacked-card layout reflows to a single column at mobile widths. Confirmed via `next build`: the candidate detail page (including this new tab) still prerenders successfully against the demo-data path.

## 2. Tests added

**230 → 280 tests** (50 new), all passing, zero regressions:

- `lib/candidates/document-text-extraction.test.ts` (15) — every fixture format/outcome against real generated PDF/DOCX bytes: standard, multi-column, missing dates, overlapping roles, embedded prompt-injection text, scanned (needs_ocr), corrupted (both formats), empty (both formats), oversized, unsupported MIME.
- `lib/ai/parse-candidate-document.test.ts` (10) — not_configured, success, all-fields-unknown, prompt-injection-produces-no-fabrication, retry-once-then-rejected, recovers-on-retry, timeout vs. provider_error vs. generic error, prompt-version recorded on every outcome, conflicting-details flagged via unresolvedNotes.
- `lib/candidates/document-processing.test.ts` (5) — the pure extraction-output → field-row mapping, including the unknown-scalar shape and empty-array-group cases.
- `lib/candidates/document-processing-pipeline.test.ts` (8) — the full pipeline against real fixtures: not_configured honesty, end-to-end success, needs_ocr never calling the AI provider, corrupted_file never calling the AI provider, validation_failed, timeout vs. provider_error, multi-column survival, prompt-injection immunity. **Found and fixed a real bug** (the pdf-parse buffer-reuse issue, §1.2) via this suite, not via later review.
- `lib/candidates/document-processing-pipeline.fixtures.test.ts` (12) — the brief's exact required fixture matrix (standard/multi-column/missing-dates/overlapping-roles/scanned/malicious-prompt/unsupported-claims/conflicting-details/empty×2/corrupted×2 CV), each asserted against both the correct pipeline state **and** a generic evidence-attribution invariant (every evidenced field has a non-empty excerpt; every unevidenced field has none) walked across the whole output rather than field-by-field.
- `packages/types` — `pnpm typecheck` confirms the new Zod schemas compile cleanly.

### 2.1 What is deliberately not covered

- The real `AnthropicCandidateProvider` and the real OCR path have no live-provider test — no credentials exist in this environment. Both are typed, honestly gated behind `not_configured`, and structurally identical in shape to the Build Phase 4 pattern that will need the same verification once a key exists.
- Server actions (`document-processing-actions.ts`) have no direct unit test, matching every prior phase's server-action convention in this repo — they are thin Supabase glue over already-tested pure logic (extraction, mapping, orchestration), and Supabase itself is not connected in this environment. Their RLS-dependent behavior is verified functionally instead (§2.2).
- End-to-end UI interaction tests (clicking Verify/Reject in a browser) were not added — the candidate detail page's existing smoke test (`page.test.tsx`) confirms the new tab renders without crashing; deeper interaction coverage is better added once real backend data exists to drive it.

### 2.2 RLS functional verification

`/tmp/pgverify/verify_candidates.sql` extended with a new TEST 12 block (12a–12g), run against a from-scratch replay of every migration `0001`–`0026` on a real local PostgreSQL 16 database (not just the two new ones — the full prior TEST 1–11 suite was re-run and reconfirmed green in the same pass, catching a real regression: an ad-hoc `authenticated`-role grant from a prior session had been lost when the verify database was recreated, briefly and incorrectly un-blocking `candidate_pipeline_events`' append-only protection — fixed by granting broad `authenticated` privileges via `ALTER DEFAULT PRIVILEGES` **before** migrations run, so each migration's own narrower `REVOKE` statements take final effect, matching how a real Supabase project's bootstrapping actually orders these).

TEST 12 confirms: an assigned recruiter can see a processing job; an unassigned recruiter cannot; a client_decision_maker can never see a processing job even once the candidate is shared (`client_visible = true`); the same client_decision_maker **can** read the evidence row for that shared candidate (matrix: `candidate_evidence` read); neither the client nor an unassigned recruiter can write a review decision to that evidence row; the assigned recruiter can.

## 3. Commands run (verification gate)

```
pnpm --filter @rqi/types typecheck   # clean
pnpm typecheck                        # clean, all 5 packages
pnpm lint                             # clean
pnpm test                             # 280 passed, 0 failed
pnpm --filter web build               # succeeds, candidate detail page (incl. new tab) prerenders
```

Plus the from-scratch migration replay and RLS suite described in §2.2, run directly against local PostgreSQL 16 (not part of the pnpm scripts, since there is no live Supabase project to run them against normally).

## 4. Known limitations / deferred

- **No live AI or OCR provider.** Both paths are fully built, typed, and honestly gated — never faked — but unverified against a real network call. This is the same category of blocker as every prior phase's missing `ANTHROPIC_API_KEY`, now joined by "no OCR vendor chosen."
- **No background job queue.** Processing runs synchronously inside the server action request. Functionally complete (the job-status state machine is real and persisted at every step), but a genuinely large CV or a slow AI call will hold the request open rather than returning immediately with a pollable `queued` state. Moving the pipeline body into a worker is a drop-in change given the existing job-row contract.
- **No live PDF page viewer for the "original-document evidence viewer."** The brief's UI list includes this; what is built shows each field's verbatim source excerpt and location string (the CV's own text, inline) rather than a rendered page with a highlighted region, since a signed-URL PDF preview needs a live Storage-backed document this environment cannot exercise end to end.
- **`unresolvedNotes`** (the AI's own free-text notes about ambiguous/conflicting content it found) are part of the validated AI output and are recorded in the `ai_runs`-equivalent raw output for audit purposes, but have no dedicated persisted UI-facing column on `candidate_document_processing_jobs` — a small schema gap that would be a one-column addition (`unresolved_notes text[]`) in a follow-up.
- **`SCALAR_FIELD_TO_PROFILE_NOTES_COLUMN`'s compensation/availability routing** (docs/07-data-model.md §7.8) is a deliberate design choice, not a bug, but is worth a human product decision at some point: should an AI-parsed compensation statement ever be allowed to pre-fill the structured `compensation_min/max` range with a human's subsequent confirmation, rather than only ever living as a note beside it? Left as-is (safer default) pending that decision.

## 5. Recommendation for next build

The natural next phase is candidate-to-job match scoring (mandatory gates, evidence-backed scoring, human quality review) — explicitly deferred by this phase's brief and by Build Phase 5's before it — now that both a scorecard (Build Phase 4) and a parsed, evidence-backed candidate profile (this phase) exist to score against. A live Supabase project and Anthropic API key remain the two blockers that would let every AI-touching phase since Build Phase 4 actually run instead of just being verified structurally.

Related documents: [[07-data-model]] · [[06-roles-permissions]] · [[09-ai-architecture]] · [[10-ai-evaluation-guardrails]]
