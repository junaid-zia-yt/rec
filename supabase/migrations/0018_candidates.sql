-- 0018_candidates.sql
-- docs/07-data-model.md §7.1 (`candidates`, `candidate_profiles`) and §7.4
-- (dedup strategy). Build Phase 5 brief "Candidate Foundation".
--
-- Splits identity/dedup/status (candidates) from the normalized, extended
-- profile (candidate_profiles) — matching docs/07-data-model.md's existing
-- "organizations 1─* candidates 1─1 candidate_profiles" design, not a new
-- decision made here.
--
-- Recruiter and client_decision_maker row-level policies are DEFERRED to
-- 0021_candidate_pipeline.sql, once candidate_project_entries and
-- is_assigned_to_project() both exist and public.can_access_candidate() can
-- be defined — the same deferred-policy convention used for
-- recruitment_projects (0009 → 0012). Until 0021 ships, only agency_admin/
-- platform_admin/read_only_reviewer policies exist below.

create table if not exists public.candidates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) > 0),
  primary_email text,
  primary_phone text,
  -- Deterministic dedup keys (docs/07-data-model.md §7.4's "deterministic
  -- first pass"). Generated columns so every insert/update keeps them in
  -- sync with primary_email/primary_phone without relying on application
  -- code to remember to normalize — the fuzzy pgvector-similarity pass
  -- §7.4 also describes is explicitly deferred to a later AI-enabled phase
  -- (this phase implements only the deterministic exact-match + configurable
  -- fuzzy-heuristic passes — see apps/web/lib/candidates/dedup.ts).
  normalized_email text generated always as (nullif(lower(btrim(primary_email)), '')) stored,
  normalized_phone text generated always as (
    nullif(regexp_replace(coalesce(primary_phone, ''), '[^0-9]', '', 'g'), '')
  ) stored,
  status text not null default 'active'
    check (status in ('active', 'archived', 'merged', 'deletion_requested')),
  -- Set only when status = 'merged'. The losing record's row and id are
  -- kept (never deleted) so any historical reference to it still resolves —
  -- docs/07-data-model.md §7.4: "A confirmed merge ... keeps the losing
  -- record's id as an alias for referential integrity."
  merged_into_candidate_id uuid references public.candidates (id),
  -- Soft-delete marker reserved for an actual, executed data-deletion
  -- request (docs/07-data-model.md §7.6) — deliberately never set by any
  -- code path in this build phase. candidate_consents.deletion_requested
  -- records the *request*; fulfilling it (setting deleted_at, or a real
  -- hard delete) is a separate, explicitly audited admin action that
  -- depends on a data-retention policy decision this phase does not make
  -- (project rule: "Stop and report blockers when required ... business
  -- decisions ... are missing" — see docs/build-phase-5-report.md).
  deleted_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint candidates_merge_target_not_self check (merged_into_candidate_id is distinct from id),
  constraint candidates_merged_has_target check (status <> 'merged' or merged_into_candidate_id is not null)
);

comment on table public.candidates is
  'Person-level candidate identity + dedup keys + lifecycle status (docs/07-data-model.md §7.1). Never hard-deleted by ordinary application code — see deleted_at comment.';

create index if not exists candidates_organization_id_idx
  on public.candidates (organization_id)
  where deleted_at is null;
create index if not exists candidates_normalized_email_idx
  on public.candidates (organization_id, normalized_email)
  where normalized_email is not null and deleted_at is null;
create index if not exists candidates_normalized_phone_idx
  on public.candidates (organization_id, normalized_phone)
  where normalized_phone is not null and deleted_at is null;
create index if not exists candidates_status_idx
  on public.candidates (organization_id, status);

drop trigger if exists candidates_set_updated_at on public.candidates;
create trigger candidates_set_updated_at
  before update on public.candidates
  for each row execute function public.set_updated_at();

alter table public.candidates enable row level security;

create policy candidates_select_agency_admin_readonly
  on public.candidates
  for select
  using (
    public.is_platform_admin()
    or public.has_org_role(
      organization_id,
      array['agency_admin', 'read_only_reviewer']::public.app_role[]
    )
  );

create policy candidates_write_agency_admin
  on public.candidates
  for all
  using (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
  )
  with check (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
  );

-- ---------------------------------------------------------------------------
-- candidate_profiles — normalized, extended profile (1:1 with candidates).
-- Brief field list: current title/company, location, contact data (lives in
-- candidate_contact_points below, not here), work authorization,
-- compensation, availability, notice period, workplace preference, skills
-- (candidate_skills), employment history (candidate_experiences), education
-- (candidate_education), certifications (candidate_certifications),
-- recruiter notes.
--
-- recruiter_notes vs client_visible_notes: two distinct columns, never one
-- column with a visibility flag, so a masking bug can never leak internal
-- notes by flipping a flag on the wrong row. RLS is row-level only —
-- excluding recruiter_notes from what a client_decision_maker caller
-- actually receives is an application-layer serialization rule
-- (apps/web/lib/candidates/visibility.ts), documented there.
-- ---------------------------------------------------------------------------

create table if not exists public.candidate_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  candidate_id uuid not null unique references public.candidates (id) on delete cascade,
  current_title text,
  current_company text,
  summary text,
  location text,
  work_authorization text,
  compensation_min numeric(12, 2) check (compensation_min is null or compensation_min >= 0),
  compensation_max numeric(12, 2) check (compensation_max is null or compensation_max >= 0),
  compensation_currency text not null default 'USD',
  compensation_period text check (compensation_period in ('annual', 'hourly', 'daily', 'monthly')),
  availability_date date,
  availability_notes text,
  notice_period_days integer check (notice_period_days is null or notice_period_days >= 0),
  workplace_preference text
    check (workplace_preference in ('remote', 'hybrid', 'onsite', 'flexible')),
  years_experience numeric(4, 1) check (years_experience is null or years_experience >= 0),
  recruiter_notes text,
  client_visible_notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint candidate_profiles_compensation_range check (
    compensation_min is null or compensation_max is null or compensation_max >= compensation_min
  )
);

comment on table public.candidate_profiles is
  'Normalized extended candidate profile, 1:1 with candidates (docs/07-data-model.md §7.1). recruiter_notes is never client-visible — see table comment above.';

create index if not exists candidate_profiles_candidate_id_idx
  on public.candidate_profiles (candidate_id);

drop trigger if exists candidate_profiles_set_updated_at on public.candidate_profiles;
create trigger candidate_profiles_set_updated_at
  before update on public.candidate_profiles
  for each row execute function public.set_updated_at();

alter table public.candidate_profiles enable row level security;

create policy candidate_profiles_select_agency_admin_readonly
  on public.candidate_profiles
  for select
  using (
    public.is_platform_admin()
    or public.has_org_role(
      organization_id,
      array['agency_admin', 'read_only_reviewer']::public.app_role[]
    )
  );

create policy candidate_profiles_write_agency_admin
  on public.candidate_profiles
  for all
  using (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
  )
  with check (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
  );

-- ---------------------------------------------------------------------------
-- candidate_contact_points — multiple contact channels per candidate
-- (supersedes the "outreach_contacts" name docs/07-data-model.md originally
-- sketched for this concept; same shape, brief-specified name). "Mask
-- contact information for unauthorized roles" (brief §PRIVACY) is, like
-- recruiter_notes above, an application-layer serialization rule
-- (apps/web/lib/candidates/visibility.ts) — RLS gates the row, masking
-- shapes the value returned from it.
-- ---------------------------------------------------------------------------

create table if not exists public.candidate_contact_points (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  type text not null check (type in ('email', 'phone', 'linkedin', 'other')),
  value text not null check (char_length(btrim(value)) > 0),
  normalized_value text,
  is_primary boolean not null default false,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

comment on table public.candidate_contact_points is
  'Candidate contact channels (docs/07-data-model.md §7.1, was sketched there as outreach_contacts). PII — high sensitivity.';

create index if not exists candidate_contact_points_candidate_id_idx
  on public.candidate_contact_points (candidate_id);
create unique index if not exists candidate_contact_points_one_primary_per_type_idx
  on public.candidate_contact_points (candidate_id, type)
  where is_primary;

alter table public.candidate_contact_points enable row level security;

create policy candidate_contact_points_select_agency_admin_readonly
  on public.candidate_contact_points
  for select
  using (
    public.is_platform_admin()
    or public.has_org_role(
      organization_id,
      array['agency_admin', 'read_only_reviewer']::public.app_role[]
    )
  );

create policy candidate_contact_points_write_agency_admin
  on public.candidate_contact_points
  for all
  using (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
  )
  with check (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
  );
