-- 0013_project_activity.sql
-- docs/07-data-model.md §7.1 (`project_activity`) — a project-scoped
-- activity feed (distinct from audit_events: this is the user-facing
-- "what happened on this project" timeline shown on the Project Activity
-- screen; audit_events remains the compliance-grade, immutable, append-only
-- log of every state-changing action across the whole system). A row here
-- is written by the same server action that performs the underlying change,
-- alongside (not instead of) its audit_events insert.

create table if not exists public.project_activity (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  recruitment_project_id uuid not null references public.recruitment_projects (id) on delete cascade,
  actor_id uuid references auth.users (id),
  action text not null,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.project_activity is
  'Project-scoped activity feed shown on the Project Activity screen (docs/07-data-model.md §7.1). Not the compliance audit log — see audit_events for that.';

create index if not exists project_activity_project_id_idx
  on public.project_activity (recruitment_project_id, created_at desc);

alter table public.project_activity enable row level security;

-- Read access mirrors recruitment_projects: whoever can see the project can
-- see its activity feed. Client Decision-Maker gets the same "own client's
-- project only" scope; recruiter gets the same assigned-project scope.
create policy project_activity_select_scoped
  on public.project_activity
  for select
  using (
    public.is_platform_admin()
    or public.has_org_role(
      organization_id,
      array['agency_admin', 'read_only_reviewer']::public.app_role[]
    )
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and public.is_assigned_to_project(recruitment_project_id)
    )
    or (
      public.has_org_role(organization_id, array['client_decision_maker']::public.app_role[])
      and exists (
        select 1
        from public.recruitment_projects p
        join public.organization_memberships m
          on m.organization_id = p.organization_id
          and m.user_id = auth.uid()
          and m.status = 'active'
        where p.id = project_activity.recruitment_project_id
          and p.client_id = m.client_id
      )
    )
  );

-- Inserts happen via the server-side helper, authenticated as the acting
-- user — actor_id is never spoofable, matching the audit_events convention.
create policy project_activity_insert_scoped
  on public.project_activity
  for insert
  with check (
    actor_id = auth.uid()
    and (
      public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
      or (
        public.has_org_role(organization_id, array['recruiter']::public.app_role[])
        and public.is_assigned_to_project(recruitment_project_id)
      )
    )
  );

-- Append-only at the database-role level, same rationale as audit_events
-- (docs/07-data-model.md §7.7).
revoke update, delete on public.project_activity from authenticated, anon;
