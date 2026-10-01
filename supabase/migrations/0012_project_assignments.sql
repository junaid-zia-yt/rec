-- 0012_project_assignments.sql
-- docs/07-data-model.md §7.1 (`project_assignments`) — which recruiters are
-- assigned to which project. Build Phase 3 brief §PERMISSIONS: "Recruiters
-- can access assigned projects" — narrower than docs/06-roles-permissions.md
-- §6.2's org-wide "F" for Recruiter on recruitment_projects, which this
-- migration's policies now supersede at the RLS layer (the application-
-- layer permission matrix in packages/types/src/permissions.ts still says
-- "full" for the resource — assignment is a row-level scope on top of that
-- resource-level grant, the same way Client Decision-Maker's "R (own
-- client's)" already narrows recruitment_projects for that role).
--
-- Adds is_assigned_to_project() and then retrofits the recruiter policies
-- deferred from 0009/0010/0011 (same append-only-migration convention as
-- 0002→0004).

create table if not exists public.project_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  recruitment_project_id uuid not null references public.recruitment_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  assignment_role text not null default 'recruiter'
    check (assignment_role in ('lead_recruiter', 'recruiter')),
  assigned_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (recruitment_project_id, user_id)
);

comment on table public.project_assignments is
  'Which recruiters may access which project (docs/07-data-model.md §7.1). The sole source of truth for "assigned project" row-level scoping.';

create index if not exists project_assignments_user_id_idx
  on public.project_assignments (user_id);
create index if not exists project_assignments_project_id_idx
  on public.project_assignments (recruitment_project_id);

create or replace function public.is_assigned_to_project(target_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.project_assignments a
    where a.user_id = auth.uid()
      and a.recruitment_project_id = target_project
  );
$$;

comment on function public.is_assigned_to_project(uuid) is
  'True only when the caller has a project_assignments row for target_project. Row-level scope layered under the resource-level Recruiter grant.';

alter table public.project_assignments enable row level security;

-- Agency Admin manages assignments. A recruiter may read their own
-- assignment rows (to know which projects they can see) but never another
-- recruiter's.
create policy project_assignments_admin_write
  on public.project_assignments
  for all
  using (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
  )
  with check (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
  );

create policy project_assignments_select_own
  on public.project_assignments
  for select
  using (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin', 'read_only_reviewer']::public.app_role[])
    or user_id = auth.uid()
  );

-- ---------------------------------------------------------------------------
-- Deferred recruiter row-level policies (now that is_assigned_to_project()
-- exists).
-- ---------------------------------------------------------------------------

create policy recruitment_projects_recruiter_assigned
  on public.recruitment_projects
  for all
  using (
    public.has_org_role(organization_id, array['recruiter']::public.app_role[])
    and public.is_assigned_to_project(id)
  )
  with check (
    public.has_org_role(organization_id, array['recruiter']::public.app_role[])
    and public.is_assigned_to_project(id)
  );

create policy jobs_recruiter_assigned
  on public.jobs
  for all
  using (
    public.has_org_role(organization_id, array['recruiter']::public.app_role[])
    and public.is_assigned_to_project(recruitment_project_id)
  )
  with check (
    public.has_org_role(organization_id, array['recruiter']::public.app_role[])
    and public.is_assigned_to_project(recruitment_project_id)
  );

create policy job_descriptions_recruiter_assigned
  on public.job_descriptions
  for all
  using (
    public.has_org_role(organization_id, array['recruiter']::public.app_role[])
    and exists (
      select 1 from public.jobs j
      where j.id = job_descriptions.job_id
        and public.is_assigned_to_project(j.recruitment_project_id)
    )
  )
  with check (
    public.has_org_role(organization_id, array['recruiter']::public.app_role[])
    and exists (
      select 1 from public.jobs j
      where j.id = job_descriptions.job_id
        and public.is_assigned_to_project(j.recruitment_project_id)
    )
  );

-- document_uploads for a job_description: same assigned-project scope,
-- reached via job_descriptions -> jobs.
create policy document_uploads_recruiter_assigned
  on public.document_uploads
  for all
  using (
    public.has_org_role(organization_id, array['recruiter']::public.app_role[])
    and (
      owner_type <> 'job_description'
      or exists (
        select 1
        from public.job_descriptions jd
        join public.jobs j on j.id = jd.job_id
        where jd.id = document_uploads.owner_id
          and public.is_assigned_to_project(j.recruitment_project_id)
      )
    )
  )
  with check (
    public.has_org_role(organization_id, array['recruiter']::public.app_role[])
    and (
      owner_type <> 'job_description'
      or exists (
        select 1
        from public.job_descriptions jd
        join public.jobs j on j.id = jd.job_id
        where jd.id = document_uploads.owner_id
          and public.is_assigned_to_project(j.recruitment_project_id)
      )
    )
  );
