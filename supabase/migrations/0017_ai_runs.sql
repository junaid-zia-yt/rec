-- 0017_ai_runs.sql
-- docs/07-data-model.md §7.1, docs/09-ai-architecture.md, packages/types/
-- src/index.ts `AIRunSchema` / `AIPromptVersionSchema` /
-- `RequirementExtractionResultSchema` (Build Phase 4 brief §"AI workflow" /
-- §"AI operations").
--
-- ai_runs is the complete, append-only execution record for every AI call
-- in the system (today: requirement extraction only — ai_workflow_type is
-- an enum-like check constraint, extended by a future migration, never
-- edited here, as new workflow types are added in later phases). Every
-- field the project's AI safety rules require is captured: model, prompt
-- version, full input/output, confidence, token/cost/latency metadata, and
-- a retry chain — never just a pass/fail flag.
--
-- ai_prompt_versions is the versioned prompt-template store referenced by
-- ai_runs.prompt_version, so "which exact prompt produced this output" is
-- always answerable (docs/09-ai-architecture.md's prompt-versioning
-- requirement).
--
-- requirement_extraction_results is the workflow-specific outcome record a
-- UI polls/reads to know whether an extraction succeeded, is still running,
-- or failed validation — kept separate from the generic ai_runs table so
-- future AI workflows (candidate matching, outreach drafting, etc.) can add
-- their own result tables without overloading this one's shape.

create table if not exists public.ai_prompt_versions (
  id uuid primary key default gen_random_uuid(),
  workflow_type text not null check (workflow_type in ('requirement_extraction')),
  version text not null,
  template text not null,
  status text not null default 'active' check (status in ('active', 'deprecated')),
  created_at timestamptz not null default now(),
  unique (workflow_type, version)
);

comment on table public.ai_prompt_versions is
  'Versioned prompt template store (docs/09-ai-architecture.md). Not tenant data — prompts are a platform-level asset, not owned by an organization, so no organization_id/RLS here (mirrors 0001''s helper-function convention of no RLS on non-tenant tables).';

create table if not exists public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  workflow_type text not null check (workflow_type in ('requirement_extraction')),
  model text not null,
  prompt_version text not null,
  status text not null check (status in ('success', 'error', 'rejected_by_validation')),
  -- Opaque reference to the input this run processed (e.g. a
  -- job_descriptions.id) — never the raw untrusted document text itself,
  -- which is never duplicated into this audit table (docs/09-ai-
  -- architecture.md trust-boundary requirement: untrusted content is
  -- referenced, not re-embedded, outside its one protected storage location).
  input_ref text not null,
  -- The full structured model output (validated RequirementExtractionOutput
  -- on success; whatever the model returned, for forensic review, when
  -- status = rejected_by_validation). Never populated with anything on a
  -- plain 'error' (e.g. timeout, network failure before any response).
  output_json jsonb,
  -- Safe, non-sensitive error message only (Build Phase 4 brief §"AI
  -- operations": "Safe error messages... No sensitive prompt logging
  -- outside protected storage") — never a raw provider exception body.
  error_message text,
  confidence numeric(4, 3) check (confidence is null or confidence between 0 and 1),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  cost_usd numeric(10, 6) check (cost_usd is null or cost_usd >= 0),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  retry_of_run_id uuid references public.ai_runs (id) on delete set null,
  -- Idempotency: a caller-supplied key (e.g. hash of job_description_id +
  -- prompt_version) so a retried request never double-runs the model or
  -- double-writes requirements (Build Phase 4 brief §"AI operations":
  -- "Idempotency"). Null is allowed for callers that don't supply one, but
  -- when present it must be unique per organization.
  idempotency_key text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

comment on table public.ai_runs is
  'Complete, append-only execution record for every AI call (docs/09-ai-architecture.md, project core rule #10: every AI action must be auditable). Never updated after insert except by a fresh row referencing it via retry_of_run_id.';

comment on column public.ai_runs.output_json is
  'The full structured model output. Human-reviewed edits to the resulting job_requirements rows are tracked on job_requirements itself, never by mutating this historical record.';

create unique index if not exists ai_runs_org_idempotency_key_idx
  on public.ai_runs (organization_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists ai_runs_organization_id_idx
  on public.ai_runs (organization_id, created_at desc);
create index if not exists ai_runs_input_ref_idx
  on public.ai_runs (input_ref);

create table if not exists public.requirement_extraction_results (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  job_description_id uuid not null references public.job_descriptions (id) on delete cascade,
  ai_run_id uuid references public.ai_runs (id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'failed_validation', 'error')),
  requirement_count integer not null default 0 check (requirement_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.requirement_extraction_results is
  'Workflow-facing outcome record the UI reads to render the AI processing / extraction failure states (Build Phase 4 brief §UI). One row per extraction attempt against a job_description version.';

create index if not exists requirement_extraction_results_job_description_id_idx
  on public.requirement_extraction_results (job_description_id, created_at desc);

drop trigger if exists requirement_extraction_results_set_updated_at on public.requirement_extraction_results;
create trigger requirement_extraction_results_set_updated_at
  before update on public.requirement_extraction_results
  for each row execute function public.set_updated_at();

alter table public.ai_runs enable row level security;
alter table public.requirement_extraction_results enable row level security;

-- ai_runs / requirement_extraction_results: same access shape as
-- job_requirements — Agency Admin + Read-Only Reviewer org-wide, Recruiter
-- scoped to their assigned projects (reached via job_description ->
-- job -> recruitment_project), Client Decision-Maker never (AI-run
-- internals, including cost/token metadata, are never client-visible —
-- docs/06-roles-permissions.md §6.3).

create policy ai_runs_select_agency_admin_readonly
  on public.ai_runs
  for select
  using (
    public.is_platform_admin()
    or public.has_org_role(
      organization_id,
      array['agency_admin', 'read_only_reviewer']::public.app_role[]
    )
  );

create policy ai_runs_recruiter_assigned
  on public.ai_runs
  for select
  using (
    public.has_org_role(organization_id, array['recruiter']::public.app_role[])
    and exists (
      select 1
      from public.job_descriptions jd
      join public.jobs j on j.id = jd.job_id
      where jd.id::text = ai_runs.input_ref
        and public.is_assigned_to_project(j.recruitment_project_id)
    )
  );

-- Writes happen exclusively via the server-side AI-orchestration action,
-- authenticated as the acting user and enforcing the same assigned-project
-- scope in application code before it ever calls the model. RLS still gates
-- inserts so a compromised client could never write a fabricated AI-run
-- audit row for a project it has no access to.
create policy ai_runs_insert_agency_admin_or_assigned_recruiter
  on public.ai_runs
  for insert
  with check (
    created_by = auth.uid()
    and (
      public.is_platform_admin()
      or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
      or (
        public.has_org_role(organization_id, array['recruiter']::public.app_role[])
        and exists (
          select 1
          from public.job_descriptions jd
          join public.jobs j on j.id = jd.job_id
          where jd.id::text = ai_runs.input_ref
            and public.is_assigned_to_project(j.recruitment_project_id)
        )
      )
    )
  );

-- Append-only: an AI run's history is never edited or deleted, only
-- superseded by a new row referencing it via retry_of_run_id.
revoke update, delete on public.ai_runs from authenticated, anon;

create policy requirement_extraction_results_select_agency_admin_readonly
  on public.requirement_extraction_results
  for select
  using (
    public.is_platform_admin()
    or public.has_org_role(
      organization_id,
      array['agency_admin', 'read_only_reviewer']::public.app_role[]
    )
  );

create policy requirement_extraction_results_recruiter_assigned
  on public.requirement_extraction_results
  for all
  using (
    public.has_org_role(organization_id, array['recruiter']::public.app_role[])
    and exists (
      select 1 from public.jobs j
      where j.id = (
        select jd.job_id from public.job_descriptions jd
        where jd.id = requirement_extraction_results.job_description_id
      )
      and public.is_assigned_to_project(j.recruitment_project_id)
    )
  )
  with check (
    public.has_org_role(organization_id, array['recruiter']::public.app_role[])
    and exists (
      select 1 from public.jobs j
      where j.id = (
        select jd.job_id from public.job_descriptions jd
        where jd.id = requirement_extraction_results.job_description_id
      )
      and public.is_assigned_to_project(j.recruitment_project_id)
    )
  );

create policy requirement_extraction_results_write_agency_admin
  on public.requirement_extraction_results
  for all
  using (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
  )
  with check (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
  );
