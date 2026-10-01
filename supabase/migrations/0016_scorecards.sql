-- 0016_scorecards.sql
-- docs/07-data-model.md §7.1, packages/types/src/index.ts `ScorecardSchema` /
-- `ScorecardVersionSchema` / `ScorecardApprovalSchema` (Build Phase 4 brief
-- §"Scoring validation" / §"AI workflow" / §"Permissions").
--
-- Three tables:
--   scorecards          — one per job, a stable id that owns a version history.
--   scorecard_versions  — every draft/approval cycle. Approval is the ONLY
--                          way a version's status becomes 'active', and once
--                          active a version (and its requirement_snapshot) is
--                          immutable — enforced by the trigger below, not
--                          just application code, so a bug can never mutate
--                          approved history. Editing after approval always
--                          creates a NEW draft version; it never rewrites one.
--   scorecard_approvals — an audit-grade record of every approve / reject /
--                          request-changes decision, one row per decision
--                          (append-only, same convention as audit_events).
--
-- Mandatory-requirement weight totals, "preferred weights must sum to 100%",
-- and "cannot approve with invalid totals" are enforced in application code
-- (apps/web/lib/scoring/validate-weights.ts, task #22) against the
-- requirement_snapshot at the moment a version is submitted for approval —
-- deterministic business rules are never delegated to the database or to AI
-- (project AI safety rule: "Use deterministic logic for mandatory gates and
-- final score calculations"). The database's job here is immutability and
-- tenant isolation, not scoring arithmetic.

create table if not exists public.scorecards (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  name text not null default '',
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'archived')),
  current_version_id uuid,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id)
);

comment on table public.scorecards is
  'One per job — the stable parent of a scorecard version history (docs/07-data-model.md §7.1). current_version_id points at the active version, if any; see scorecard_versions for the FK (added after that table exists, below).';

create index if not exists scorecards_organization_id_idx
  on public.scorecards (organization_id);

drop trigger if exists scorecards_set_updated_at on public.scorecards;
create trigger scorecards_set_updated_at
  before update on public.scorecards
  for each row execute function public.set_updated_at();

create table if not exists public.scorecard_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  scorecard_id uuid not null references public.scorecards (id) on delete cascade,
  version_no integer not null check (version_no > 0),
  status text not null default 'draft'
    check (status in ('draft', 'pending_approval', 'active', 'superseded')),
  -- Snapshot of requirement ids + type + weight at the moment this version
  -- was submitted for approval. Immutable once status = 'active' (trigger
  -- below). This is what candidate_matches.scorecard_version_id will pin to
  -- later, so historical candidate evaluations never shift under a later
  -- scorecard edit (Build Phase 4 brief §"Scoring validation").
  requirement_snapshot jsonb not null default '[]'::jsonb,
  approved_by uuid references auth.users (id),
  approved_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scorecard_id, version_no)
);

comment on table public.scorecard_versions is
  'Every draft/approval cycle of a scorecard (docs/07-data-model.md §7.1). Once status = active, this row (including requirement_snapshot) is immutable — see scorecard_versions_immutable_once_active trigger. Editing after approval always inserts a new draft version, never rewrites this one.';

comment on column public.scorecard_versions.requirement_snapshot is
  'Array of {requirementId, type, weight} at approval time. The source of truth for a candidate evaluation''s scoring rules is always this frozen snapshot, never the live job_requirements rows, which may have changed since.';

create index if not exists scorecard_versions_scorecard_id_idx
  on public.scorecard_versions (scorecard_id, version_no desc);

alter table public.scorecards
  add constraint scorecards_current_version_fk
  foreign key (current_version_id) references public.scorecard_versions (id) on delete set null;

drop trigger if exists scorecard_versions_set_updated_at on public.scorecard_versions;
create trigger scorecard_versions_set_updated_at
  before update on public.scorecard_versions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Immutability: once a version has ever been active, it can never change
-- again (not even to move to 'superseded' with different content — the
-- status transition to 'superseded' is allowed, but every other column is
-- frozen the instant status first becomes 'active'). This is enforced at the
-- database level, independent of application code, per the project's AI
-- safety rule that irreversible-record integrity must never rely on a
-- single application-layer check alone.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_scorecard_version_immutability()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'active' then
    if new.id <> old.id
      or new.scorecard_id <> old.scorecard_id
      or new.organization_id <> old.organization_id
      or new.version_no <> old.version_no
      or new.requirement_snapshot is distinct from old.requirement_snapshot
      or new.approved_by is distinct from old.approved_by
      or new.approved_at is distinct from old.approved_at
      or new.created_by is distinct from old.created_by
      or new.created_at <> old.created_at
      or new.status not in ('active', 'superseded')
    then
      raise exception 'scorecard_versions: an active version is immutable except for a transition to superseded'
        using errcode = 'raise_exception';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists scorecard_versions_immutable_once_active on public.scorecard_versions;
create trigger scorecard_versions_immutable_once_active
  before update on public.scorecard_versions
  for each row execute function public.enforce_scorecard_version_immutability();

create table if not exists public.scorecard_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  scorecard_version_id uuid not null references public.scorecard_versions (id) on delete cascade,
  approver_id uuid not null references auth.users (id),
  approver_name text not null,
  decision text not null check (decision in ('approved', 'rejected', 'changes_requested')),
  reason text,
  created_at timestamptz not null default now()
);

comment on table public.scorecard_approvals is
  'Append-only audit-grade record of every approve/reject/request-changes decision on a scorecard version (docs/07-data-model.md §7.1). One row per decision, never updated — approver_id is set server-side from the authenticated session, never client-supplied.';

create index if not exists scorecard_approvals_version_id_idx
  on public.scorecard_approvals (scorecard_version_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Client-reviewer scorecard-approval opt-in (Build Phase 4 brief
-- §PERMISSIONS: "Client reviewers may approve only if explicitly
-- permitted"). docs/06-roles-permissions.md §6.2 gives Client Decision-Maker
-- "–" on Scorecards by default; this is a narrow, per-project opt-in on top
-- of that default, never a change to the base resource-level matrix — same
-- pattern as 0012's row-level narrowing of the Recruiter grant.
-- ---------------------------------------------------------------------------
alter table public.recruitment_projects
  add column if not exists client_can_approve_scorecards boolean not null default false;

comment on column public.recruitment_projects.client_can_approve_scorecards is
  'Explicit per-project opt-in: when true, the client_decision_maker representing this project''s client may record a scorecard_approvals decision. Default false — the docs/06-roles-permissions.md §6.2 base grant. Only an agency_admin may set this (see scorecards RLS below).';

alter table public.scorecards enable row level security;
alter table public.scorecard_versions enable row level security;
alter table public.scorecard_approvals enable row level security;

-- ---------------------------------------------------------------------------
-- scorecards
-- ---------------------------------------------------------------------------

create policy scorecards_select_agency_admin_readonly
  on public.scorecards
  for select
  using (
    public.is_platform_admin()
    or public.has_org_role(
      organization_id,
      array['agency_admin', 'read_only_reviewer']::public.app_role[]
    )
  );

create policy scorecards_write_agency_admin
  on public.scorecards
  for all
  using (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
  )
  with check (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
  );

create policy scorecards_recruiter_assigned
  on public.scorecards
  for all
  using (
    public.has_org_role(organization_id, array['recruiter']::public.app_role[])
    and exists (
      select 1 from public.jobs j
      where j.id = scorecards.job_id
        and public.is_assigned_to_project(j.recruitment_project_id)
    )
  )
  with check (
    public.has_org_role(organization_id, array['recruiter']::public.app_role[])
    and exists (
      select 1 from public.jobs j
      where j.id = scorecards.job_id
        and public.is_assigned_to_project(j.recruitment_project_id)
    )
  );

-- Client Decision-Maker: read only the scorecard row itself (name/status),
-- for their own client's jobs, whether or not client_can_approve_scorecards
-- is set — they may need to see "a scorecard exists and is approved" even
-- when they cannot approve it themselves.
create policy scorecards_select_client_decision_maker
  on public.scorecards
  for select
  using (
    public.has_org_role(organization_id, array['client_decision_maker']::public.app_role[])
    and exists (
      select 1
      from public.jobs j
      join public.recruitment_projects p on p.id = j.recruitment_project_id
      join public.organization_memberships m
        on m.organization_id = p.organization_id
        and m.user_id = auth.uid()
        and m.status = 'active'
      where j.id = scorecards.job_id
        and p.client_id = m.client_id
    )
  );

-- ---------------------------------------------------------------------------
-- scorecard_versions
-- ---------------------------------------------------------------------------

create policy scorecard_versions_select_agency_admin_readonly
  on public.scorecard_versions
  for select
  using (
    public.is_platform_admin()
    or public.has_org_role(
      organization_id,
      array['agency_admin', 'read_only_reviewer']::public.app_role[]
    )
  );

create policy scorecard_versions_write_agency_admin
  on public.scorecard_versions
  for all
  using (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
  )
  with check (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
  );

create policy scorecard_versions_recruiter_assigned
  on public.scorecard_versions
  for all
  using (
    public.has_org_role(organization_id, array['recruiter']::public.app_role[])
    and exists (
      select 1
      from public.scorecards s
      join public.jobs j on j.id = s.job_id
      where s.id = scorecard_versions.scorecard_id
        and public.is_assigned_to_project(j.recruitment_project_id)
    )
  )
  with check (
    public.has_org_role(organization_id, array['recruiter']::public.app_role[])
    and exists (
      select 1
      from public.scorecards s
      join public.jobs j on j.id = s.job_id
      where s.id = scorecard_versions.scorecard_id
        and public.is_assigned_to_project(j.recruitment_project_id)
    )
  );

-- Client Decision-Maker: read only, and only a version that has reached
-- pending_approval or later (draft internals stay hidden), for their own
-- client's jobs. This is the row they read to approve/reject when
-- client_can_approve_scorecards is set, and the row they read to see
-- "what was approved" when it is not.
create policy scorecard_versions_select_client_decision_maker
  on public.scorecard_versions
  for select
  using (
    public.has_org_role(organization_id, array['client_decision_maker']::public.app_role[])
    and status in ('pending_approval', 'active', 'superseded')
    and exists (
      select 1
      from public.scorecards s
      join public.jobs j on j.id = s.job_id
      join public.recruitment_projects p on p.id = j.recruitment_project_id
      join public.organization_memberships m
        on m.organization_id = p.organization_id
        and m.user_id = auth.uid()
        and m.status = 'active'
      where s.id = scorecard_versions.scorecard_id
        and p.client_id = m.client_id
    )
  );

-- ---------------------------------------------------------------------------
-- scorecard_approvals
-- ---------------------------------------------------------------------------

create policy scorecard_approvals_select_agency_admin_readonly
  on public.scorecard_approvals
  for select
  using (
    public.is_platform_admin()
    or public.has_org_role(
      organization_id,
      array['agency_admin', 'read_only_reviewer', 'recruiter']::public.app_role[]
    )
  );

-- Agency Admin approves (docs/06-roles-permissions.md §6.2 "Scorecards: F
-- (approve)"). approver_id must always be the authenticated caller.
create policy scorecard_approvals_insert_agency_admin
  on public.scorecard_approvals
  for insert
  with check (
    approver_id = auth.uid()
    and (
      public.is_platform_admin()
      or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
    )
  );

-- Client Decision-Maker approves only when client_can_approve_scorecards is
-- set on the recruitment project for that scorecard's job (Build Phase 4
-- brief §PERMISSIONS), and only for their own client.
create policy scorecard_approvals_insert_client_decision_maker
  on public.scorecard_approvals
  for insert
  with check (
    approver_id = auth.uid()
    and public.has_org_role(organization_id, array['client_decision_maker']::public.app_role[])
    and exists (
      select 1
      from public.scorecard_versions v
      join public.scorecards s on s.id = v.scorecard_id
      join public.jobs j on j.id = s.job_id
      join public.recruitment_projects p on p.id = j.recruitment_project_id
      join public.organization_memberships m
        on m.organization_id = p.organization_id
        and m.user_id = auth.uid()
        and m.status = 'active'
      where v.id = scorecard_approvals.scorecard_version_id
        and p.client_id = m.client_id
        and p.client_can_approve_scorecards = true
    )
  );

create policy scorecard_approvals_select_client_decision_maker
  on public.scorecard_approvals
  for select
  using (
    public.has_org_role(organization_id, array['client_decision_maker']::public.app_role[])
    and exists (
      select 1
      from public.scorecard_versions v
      join public.scorecards s on s.id = v.scorecard_id
      join public.jobs j on j.id = s.job_id
      join public.recruitment_projects p on p.id = j.recruitment_project_id
      join public.organization_memberships m
        on m.organization_id = p.organization_id
        and m.user_id = auth.uid()
        and m.status = 'active'
      where v.id = scorecard_approvals.scorecard_version_id
        and p.client_id = m.client_id
    )
  );

-- Append-only at the database-role level, same rationale as audit_events
-- (docs/07-data-model.md §7.7) — a decision is never edited or withdrawn,
-- only superseded by a new one.
revoke update, delete on public.scorecard_approvals from authenticated, anon;
