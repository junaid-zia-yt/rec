-- 0015_job_requirements.sql
-- docs/07-data-model.md §7.1, packages/types/src/index.ts `JobRequirementSchema`
-- (Build Phase 4 brief §"Requirement types" / §"AI workflow"). One row per
-- extracted-or-manually-added job requirement. AI never writes final truth
-- directly: every AI-proposed row lands here with ai_generated = true and
-- status = 'proposed', and only a human edit/approval (via the scorecard
-- approval flow in 0016) promotes it into an active scorecard version.
--
-- is_assigned_to_project() already exists (0012), so the recruiter row-level
-- policy ships inline here rather than being deferred.

create table if not exists public.job_requirements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  job_description_id uuid references public.job_descriptions (id) on delete set null,
  name text not null check (char_length(btrim(name)) > 0),
  description text not null default '',
  category text not null default '',
  type text not null
    check (type in ('mandatory', 'preferred', 'informational', 'disqualifying', 'requires_clarification')),
  -- Percentage weight (0-100), preferred requirements only. Mandatory,
  -- disqualifying, informational, and requires_clarification requirements
  -- are pass/fail gates or non-scored and must never carry a weight — see
  -- packages/types' UNWEIGHTED_REQUIREMENT_TYPES and 0016's approval check.
  weight numeric(5, 2) check (weight is null or weight between 0 and 100),
  evidence_expected text not null default '',
  -- A verbatim quote from the source JD text, never a paraphrase, so a
  -- reviewer can Ctrl-F it against the original document (Build Phase 4
  -- brief §AI WORKFLOW: "Quote or reference supporting source text").
  source_text text,
  source_location text,
  confidence numeric(4, 3) check (confidence is null or confidence between 0 and 1),
  verification_status text not null default 'unverified'
    check (verification_status in ('verified', 'unverified', 'disputed')),
  reviewer_notes text,
  -- proposed: as extracted/added, not yet reviewed by a human.
  -- reviewed: a human has looked at and, if needed, edited this row.
  -- manually_added: created by a human with no AI involvement at all.
  status text not null default 'proposed'
    check (status in ('proposed', 'reviewed', 'manually_added')),
  ai_generated boolean not null default false,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_requirements_weight_only_when_preferred check (
    weight is null or type = 'preferred'
  ),
  constraint job_requirements_manual_never_ai_generated check (
    status <> 'manually_added' or ai_generated = false
  )
);

comment on table public.job_requirements is
  'One extracted-or-manually-added job requirement (docs/07-data-model.md §7.1). AI may only ever insert rows with ai_generated = true and status = proposed; human edit/review is required before a requirement can enter an approved scorecard version (0016).';

comment on column public.job_requirements.source_text is
  'Verbatim quote from the source job description — never a paraphrase, so a human reviewer can verify it against the original document (Build Phase 4 core rule: AI must never invent candidate/job requirement evidence).';

create index if not exists job_requirements_job_id_idx
  on public.job_requirements (job_id);
create index if not exists job_requirements_organization_id_idx
  on public.job_requirements (organization_id);
create index if not exists job_requirements_job_description_id_idx
  on public.job_requirements (job_description_id);

drop trigger if exists job_requirements_set_updated_at on public.job_requirements;
create trigger job_requirements_set_updated_at
  before update on public.job_requirements
  for each row execute function public.set_updated_at();

alter table public.job_requirements enable row level security;

-- Agency Admin: F. Read-Only Reviewer: R. Both org-wide
-- (docs/06-roles-permissions.md §6.2 "Scorecards" row covers requirements
-- as part of the scorecard-building workflow).
create policy job_requirements_select_agency_admin_readonly
  on public.job_requirements
  for select
  using (
    public.is_platform_admin()
    or public.has_org_role(
      organization_id,
      array['agency_admin', 'read_only_reviewer']::public.app_role[]
    )
  );

create policy job_requirements_write_agency_admin
  on public.job_requirements
  for all
  using (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
  )
  with check (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
  );

-- Recruiter: F, but only for requirements on jobs within their assigned
-- projects (Build Phase 4 brief §PERMISSIONS: "Recruiters may draft and
-- edit where assigned"), mirroring 0012's jobs_recruiter_assigned policy.
create policy job_requirements_recruiter_assigned
  on public.job_requirements
  for all
  using (
    public.has_org_role(organization_id, array['recruiter']::public.app_role[])
    and exists (
      select 1 from public.jobs j
      where j.id = job_requirements.job_id
        and public.is_assigned_to_project(j.recruitment_project_id)
    )
  )
  with check (
    public.has_org_role(organization_id, array['recruiter']::public.app_role[])
    and exists (
      select 1 from public.jobs j
      where j.id = job_requirements.job_id
        and public.is_assigned_to_project(j.recruitment_project_id)
    )
  );

-- Client Decision-Maker has no access to raw requirement rows or AI
-- extraction internals (docs/06-roles-permissions.md §6.2 "Scorecards: –"
-- and §6.3 "internal recruiter notes, override reasons, or scoring
-- weights/methodology internals" must never reach a client). They see only
-- the immutable, approved scorecard-version snapshot via 0016's
-- scorecard_versions read policy, never this table.
