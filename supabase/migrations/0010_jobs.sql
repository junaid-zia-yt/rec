-- 0010_jobs.sql
-- docs/07-data-model.md §7.1 (`jobs`) — canonical role record for a
-- recruitment project (may span multiple JD versions). Build Phase 3 brief
-- §"Job intake". organization_id is denormalized from the parent project
-- so RLS never has to join through recruitment_projects to check tenancy.
--
-- Recruiter-scoped policy deferred to 0012 (see 0009's header note).

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  recruitment_project_id uuid not null references public.recruitment_projects (id) on delete cascade,
  title text not null check (char_length(btrim(title)) > 0),
  department text,
  industry text,
  employment_type text not null default 'full_time'
    check (employment_type in ('full_time', 'part_time', 'contract', 'temporary', 'seasonal')),
  workplace_arrangement text not null default 'on_site'
    check (workplace_arrangement in ('on_site', 'hybrid', 'remote')),
  location text not null default '',
  commuting_radius_miles integer check (commuting_radius_miles is null or commuting_radius_miles >= 0),
  salary_min numeric(12, 2) check (salary_min is null or salary_min >= 0),
  salary_max numeric(12, 2) check (salary_max is null or salary_max >= 0),
  currency text not null default 'USD' check (char_length(currency) = 3),
  work_authorization_required text,
  sponsorship_available boolean not null default false,
  target_start_date date,
  hiring_manager_notes text,
  max_shortlist_size smallint not null default 3 check (max_shortlist_size between 1 and 3),
  min_match_threshold numeric(5, 2) not null default 70 check (min_match_threshold between 0 and 100),
  status text not null default 'open' check (status in ('open', 'filled', 'cancelled')),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jobs_salary_range_valid check (
    salary_min is null or salary_max is null or salary_min <= salary_max
  )
);

comment on table public.jobs is
  'Canonical role record within a recruitment project (docs/07-data-model.md §7.1).';

create index if not exists jobs_organization_id_idx on public.jobs (organization_id);
create index if not exists jobs_recruitment_project_id_idx on public.jobs (recruitment_project_id);

drop trigger if exists jobs_set_updated_at on public.jobs;
create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

alter table public.jobs enable row level security;

create policy jobs_select_agency_admin_readonly
  on public.jobs
  for select
  using (
    public.is_platform_admin()
    or public.has_org_role(
      organization_id,
      array['agency_admin', 'read_only_reviewer']::public.app_role[]
    )
  );

create policy jobs_write_agency_admin
  on public.jobs
  for all
  using (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
  )
  with check (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
  );

create policy jobs_select_client_decision_maker
  on public.jobs
  for select
  using (
    public.has_org_role(organization_id, array['client_decision_maker']::public.app_role[])
    and exists (
      select 1
      from public.recruitment_projects p
      join public.organization_memberships m
        on m.organization_id = p.organization_id
        and m.user_id = auth.uid()
        and m.status = 'active'
      where p.id = jobs.recruitment_project_id
        and p.client_id = m.client_id
    )
  );
