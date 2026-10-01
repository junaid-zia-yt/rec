-- 0022_candidate_document_processing.sql
-- Build Phase 6 brief ("AI Candidate Document Processing"): secure CV
-- parsing, structured candidate normalization, evidence extraction and
-- human verification. Implements docs/09-ai-architecture.md workflow #4
-- (CV parsing) and #9 (evidence extraction) — the two AI workflows this
-- schema exists for — plus docs/07-data-model.md's not-yet-built
-- `requirement_evidence`-style entity, specialized for candidates.
--
-- Two new tables:
--   candidate_document_processing_jobs — one row per processing ATTEMPT
--     against one candidate_documents row (queued/extracting/needs_ocr/
--     parsing/awaiting_review/completed/failed). Never client-visible,
--     same reasoning as candidate_documents itself (0019's comment):
--     internal pipeline bookkeeping, not candidate-facing evidence.
--   candidate_extracted_fields — one row per extracted (or explicitly
--     unknown) candidate field, carrying every column the brief's
--     §EVIDENCE RULES requires verbatim: document id, page/section, source
--     excerpt, extraction confidence, verification status, reviewer,
--     review timestamp. Client-visible (per docs/06-roles-permissions.md
--     §6.2's `candidate_evidence: client_decision_maker = read`) — a client
--     reviewer may see the evidence excerpt behind a shortlisted
--     candidate's profile even though they can never fetch the original
--     file (candidate_documents stays client: none).
--
-- Both tables use can_access_candidate() (0021) directly for their
-- row-level scoping, since no earlier deferral is needed here — that
-- function already exists by this migration.

create table if not exists public.candidate_document_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  candidate_document_id uuid not null references public.candidate_documents (id) on delete cascade,

  status text not null default 'queued'
    check (status in (
      'queued', 'extracting_text', 'needs_ocr', 'parsing', 'awaiting_review', 'completed', 'failed'
    )),

  -- AI PIPELINE step 2/3/4: deterministic parser first; only a document
  -- correctly detected as unreadable/scanned is ever routed to OCR.
  text_extraction_method text
    check (text_extraction_method in ('deterministic', 'ocr')),
  -- The document's own extracted text, once obtained. Treated as untrusted
  -- content from the moment it exists (AI PIPELINE step 5) and never
  -- written to application logs (brief §SECURITY) — only to this
  -- RLS-protected, org-scoped, never-client-visible row.
  extracted_text text,
  extracted_char_count integer,

  error_kind text
    check (error_kind in (
      'corrupted_file', 'unsupported_format', 'size_limit_exceeded',
      'ocr_not_configured', 'timeout', 'provider_error', 'validation_failed'
    )),
  -- Always a safe, non-sensitive message — never a raw parser/provider
  -- exception (brief §SECURITY: same "no sensitive prompt logging" rule
  -- Build Phase 4 established for ai_runs error messages).
  error_message text,

  ai_run_id uuid references public.ai_runs (id),
  prompt_version text,
  model text,
  -- Bounded retries (brief §SECURITY): at most one AI retry on invalid
  -- structured output, mirroring extract-requirements.ts's policy exactly.
  retried boolean not null default false,

  -- Idempotency (brief §SECURITY: "Make jobs idempotent"). Application code
  -- computes this as `<candidate_document_id>:<attempt_no>` before insert;
  -- the unique index below is the enforced backstop, and the partial index
  -- further guarantees at most one IN-FLIGHT job per document at a time —
  -- calling "process" again while a job is already running returns the
  -- existing job rather than starting a second one.
  idempotency_key text not null,
  attempt_no integer not null default 1 check (attempt_no > 0),
  reprocess_of_job_id uuid references public.candidate_document_processing_jobs (id),
  -- UI "Reprocess with reason" (brief §UI). Required by the server action
  -- for every attempt after the first — enforced in application code, not
  -- a NOT NULL here, since attempt 1 legitimately has no reason yet.
  reprocess_reason text,

  requested_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,

  unique (idempotency_key)
);

comment on table public.candidate_document_processing_jobs is
  'One row per AI-document-processing attempt (docs/09-ai-architecture.md workflow #4). Internal pipeline state — never client-visible, same as candidate_documents (0019).';

create unique index if not exists candidate_document_processing_jobs_one_inflight_idx
  on public.candidate_document_processing_jobs (candidate_document_id)
  where status in ('queued', 'extracting_text', 'needs_ocr', 'parsing', 'awaiting_review');

create index if not exists candidate_document_processing_jobs_candidate_id_idx
  on public.candidate_document_processing_jobs (candidate_id, created_at desc);
create index if not exists candidate_document_processing_jobs_document_id_idx
  on public.candidate_document_processing_jobs (candidate_document_id, created_at desc);
create index if not exists candidate_document_processing_jobs_organization_id_idx
  on public.candidate_document_processing_jobs (organization_id);

drop trigger if exists candidate_document_processing_jobs_set_updated_at
  on public.candidate_document_processing_jobs;
create trigger candidate_document_processing_jobs_set_updated_at
  before update on public.candidate_document_processing_jobs
  for each row execute function public.set_updated_at();

alter table public.candidate_document_processing_jobs enable row level security;

-- Never client-visible (no can_access_candidate()-based policy at all for
-- client_decision_maker — same exclusion pattern as candidate_documents,
-- 0021's comment above candidate_documents_write_recruiter).
create policy candidate_document_processing_jobs_select_internal
  on public.candidate_document_processing_jobs
  for select
  using (
    public.is_platform_admin()
    or public.has_org_role(
      organization_id,
      array['agency_admin', 'read_only_reviewer']::public.app_role[]
    )
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and public.can_access_candidate(candidate_id)
    )
  );

create policy candidate_document_processing_jobs_write_internal
  on public.candidate_document_processing_jobs
  for all
  using (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and public.can_access_candidate(candidate_id)
    )
  )
  with check (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and public.can_access_candidate(candidate_id)
    )
  );

-- ---------------------------------------------------------------------------
-- candidate_extracted_fields — the evidence table. Brief §EVIDENCE RULES,
-- verbatim: "Document ID, Page or section, Source excerpt, Extraction
-- confidence, Verification status, Reviewer, Review timestamp." One row per
-- field (or, for a repeated group like employment history, one row per
-- item per field) proposed by a processing job.
-- ---------------------------------------------------------------------------

create table if not exists public.candidate_extracted_fields (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  processing_job_id uuid not null references public.candidate_document_processing_jobs (id) on delete cascade,

  field_group text not null
    check (field_group in ('contact', 'profile', 'experience', 'education', 'certification', 'skill')),
  field_key text not null,
  -- Position within a repeated group (e.g. the 2nd employment-history
  -- entry) — null for a singular field like fullName.
  item_index integer check (item_index is null or item_index >= 0),

  -- The AI's proposed value, verbatim — never edited in place (edited_value
  -- below holds a human correction instead), so what the model actually
  -- proposed remains inspectable even after a reviewer changes it.
  extracted_value jsonb,
  -- Brief §EVIDENCE RULES: "If evidence is absent, return unknown." A field
  -- with has_evidence = false represents exactly that — no value, no
  -- excerpt, no confidence, never a guessed placeholder.
  has_evidence boolean not null default false,

  -- "Document ID"
  source_document_id uuid references public.candidate_documents (id),
  -- "Page or section"
  source_location text,
  -- "Source excerpt"
  source_excerpt text,
  -- "Extraction confidence"
  confidence numeric(3, 2) check (confidence is null or (confidence >= 0 and confidence <= 1)),

  -- "Verification status" — AI-extracted data stays 'pending' until a
  -- human reviews it (brief §HUMAN CONTROL). 'edited' means a reviewer
  -- corrected the value before accepting it.
  verification_status text not null default 'pending'
    check (verification_status in ('pending', 'verified', 'rejected', 'edited')),
  edited_value jsonb,
  -- "Reviewer" / "Review timestamp"
  reviewer_id uuid references auth.users (id),
  reviewed_at timestamptz,
  -- When an accepted/edited field's value was actually written into the
  -- real candidate_profiles/candidate_experiences/etc. row (AI PIPELINE
  -- step 10: "Apply approved changes without destroying the original
  -- document" — the original candidate_documents row/file is never
  -- touched by this).
  applied_at timestamptz,

  created_at timestamptz not null default now(),

  -- A reviewed field always has both a reviewer and a timestamp, or
  -- neither (still pending) — never one without the other.
  constraint candidate_extracted_fields_review_pair check (
    (verification_status = 'pending' and reviewer_id is null and reviewed_at is null)
    or (verification_status <> 'pending' and reviewer_id is not null and reviewed_at is not null)
  ),
  -- 'edited' always carries the human's replacement value.
  constraint candidate_extracted_fields_edited_has_value check (
    verification_status <> 'edited' or edited_value is not null
  ),
  -- "return unknown" is represented by the absence of a value/excerpt/
  -- confidence together, never a partial guess.
  constraint candidate_extracted_fields_unknown_shape check (
    has_evidence = true
    or (extracted_value is null and source_excerpt is null and confidence is null)
  )
);

comment on table public.candidate_extracted_fields is
  'One evidence row per AI-extracted (or explicitly unknown) candidate field (docs/07-data-model.md-style evidence entity, specialized for candidates; brief §EVIDENCE RULES). Client-visible per docs/06-roles-permissions.md §6.2 (candidate_evidence: read for client_decision_maker) even though the source document itself is not.';

create index if not exists candidate_extracted_fields_job_id_idx
  on public.candidate_extracted_fields (processing_job_id);
create index if not exists candidate_extracted_fields_candidate_id_idx
  on public.candidate_extracted_fields (candidate_id, field_group, field_key);
create index if not exists candidate_extracted_fields_organization_id_idx
  on public.candidate_extracted_fields (organization_id);
create index if not exists candidate_extracted_fields_pending_idx
  on public.candidate_extracted_fields (candidate_id)
  where verification_status = 'pending';

alter table public.candidate_extracted_fields enable row level security;

-- Client-visible: the single select policy is built directly on
-- can_access_candidate(), which already encodes the
-- shortlisted-or-explicitly-shared rule for client_decision_maker
-- (0021) — the same pattern candidates_select_scoped/
-- candidate_profiles_select_scoped use, deliberately NOT the
-- admin/reviewer/recruiter-only shape candidate_documents and
-- candidate_document_processing_jobs use above.
create policy candidate_extracted_fields_select_scoped
  on public.candidate_extracted_fields
  for select
  using (public.can_access_candidate(candidate_id));

-- Writes (AI proposing a field, or a human reviewing one) are
-- agency_admin/recruiter only — matches candidate_evidence's matrix row
-- exactly (recruiter: "R (system-generated)" for the AI-write path, which
-- happens through the service layer under the recruiter/admin who
-- triggered processing; a reviewer's verify/reject/edit is the human half
-- of that same "R" — read plus the review columns, never inventing new
-- evidence text themselves).
create policy candidate_extracted_fields_write_internal
  on public.candidate_extracted_fields
  for all
  using (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and public.can_access_candidate(candidate_id)
    )
  )
  with check (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and public.can_access_candidate(candidate_id)
    )
  );
