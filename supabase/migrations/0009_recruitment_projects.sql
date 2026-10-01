-- 0009_recruitment_projects.sql
-- docs/07-data-model.md §7.1 (`recruitment_projects`) — one open-role
-- engagement with a client. Build Phase 3 brief §"Recruitment projects".
--
-- The recruiter-scoped RLS policy ("recruiters access assigned projects
-- only", Build Phase 3 brief §PERMISSIONS) is deferred to 0012, after
-- project_assignments exists — same deferred-policy convention used for
-- is_platform_admin() in 0002→0004 (docs/21-implementation-contract.md
-- §21.7: a migration is never edited after it ships).

create table if not exists public.recruitment_projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete restrict,
  role_title text not null check (char_length(btrim(role_title)) > 0),
  vertical text not null default '',
  status text not null default 'intake'
    check (status in ('intake', 'sourcing', 'shortlisting', 'client_review', 'closed')),
  is_poc boolean not null default false,
  target_shortlist_size smallint not null default 3 check (target_shortlist_size between 1 and 3),
  match_threshold numeric(5, 2) not null default 70 check (match_threshold between 0 and 100),
  is_draft boolean not null default true,
  archived_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.recruitment_projects is
  'One open-role client engagement (docs/07-data-model.md §7.1). is_draft supports "save draft" before a project is formally opened.';

create index if not exists recruitment_projects_organization_id_idx
  on public.recruitment_projects (organization_id);
create index if not exists recruitment_projects_client_id_idx
  on public.recruitment_projects (client_id);
create index if not exists recruitment_projects_status_idx
  on public.recruitment_projects (organization_id, status)
  where archived_at is null;

drop trigger if exists recruitment_projects_set_updated_at on public.recruitment_projects;
create trigger recruitment_projects_set_updated_at
  before update on public.recruitment_projects
  for each row execute function public.set_updated_at();

alter table public.recruitment_projects enable row level security;

create policy recruitment_projects_select_agency_admin_readonly
  on public.recruitment_projects
  for select
  using (
    public.is_platform_admin()
    or public.has_org_role(
      organization_id,
      array['agency_admin', 'read_only_reviewer']::public.app_role[]
    )
  );

create policy recruitment_projects_write_agency_admin
  on public.recruitment_projects
  for all
  using (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
  )
  with check (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
  );

-- Client Decision-Maker: R, only projects for their own client
-- (docs/06-roles-permissions.md §6.2/§6.3 — never org-wide visibility).
create policy recruitment_projects_select_client_decision_maker
  on public.recruitment_projects
  for select
  using (
    public.has_org_role(organization_id, array['client_decision_maker']::public.app_role[])
    and client_id = (
      select m.client_id
      from public.organization_memberships m
      where m.user_id = auth.uid()
        and m.organization_id = recruitment_projects.organization_id
        and m.status = 'active'
      limit 1
    )
  );
