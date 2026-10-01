-- 0030_poc_benchmarks.sql
-- docs/14-poc-specification.md, docs/07-data-model.md §7.1/§7.2 (`POC_
-- benchmarks`/`POC_results` sketch), Build Phase 10 brief "POC Benchmark
-- and Reporting": "Implement a fair, evidence-backed comparison between the
-- client's current sourcing process and the vendor-assisted process."
--
-- RECONCILING WITH THE EXISTING SKETCH (docs/07-data-model.md §7.2):
--   `recruitment_projects 1─1 POC_benchmarks 1─* POC_results`
-- This migration deliberately does NOT hang a benchmark off a single
-- recruitment_project. docs/14-poc-specification.md §14.2 and the brief
-- both specify a benchmark spans exactly TWO live roles — one "standard"
-- and one "senior_or_difficult" (§14.2/§14.14 point 1: "one standard role +
-- one senior/difficult role" = the two live roles, not four). Those two
-- roles may not share one recruitment_project row (a client may already be
-- tracking them under separate project records). So `poc_benchmarks` is
-- scoped to (organization, client) and each role is its own `poc_roles` row
-- pointing at its own `jobs.id` (which itself carries recruitment_
-- project_id) — see the role-mix trigger below for how "exactly one of
-- each type" is enforced instead of a 1:1 FK.
--
-- NINE new tables, in dependency order:
--
--   metric_definitions  -- GLOBAL (no organization_id), versioned, platform-
--                           owned catalog of the ~15 metrics the brief lists
--                           (time to first qualified candidate, evidence
--                           coverage, etc). Seeded below as version 1 for
--                           every metric. The actual calculation CODE lives
--                           in next-wave TypeScript, keyed by
--                           (metric_key, version) — this table is only the
--                           auditable, versioned definition/description
--                           record that code must reference, per the brief's
--                           "define calculation logic centrally... version
--                           metric definitions" analytics rule. Immutable
--                           once any poc_results row references it (trigger
--                           below) — publishing a revision always inserts a
--                           new version row, never edits one in place.
--   poc_benchmarks       -- one row per client engagement's POC. Shared
--                           start_time + search_boundaries (§14.5) live
--                           here, auditably, as the brief requires.
--   poc_roles             -- exactly the two live roles per benchmark: one
--                           `standard`, one `senior_or_difficult` (§14.2).
--                           Each points at one `jobs.id`; recruitment_
--                           project_id/organization_id are denormalized from
--                           that job at insert time (same pattern as
--                           outreach_sequences in 0029) so RLS never has to
--                           join through jobs. A trigger enforces the
--                           role-mix invariant once the benchmark leaves
--                           'setup' (a benchmark being configured may
--                           legitimately have 0 or 1 roles attached so far).
--   poc_participants      -- the two PROCESSES compared per role: the
--                           client's own current process
--                           (`client_baseline`) vs. this platform's
--                           (`vendor_assisted`). One row per
--                           (poc_role_id, process_type). vendor_assisted may
--                           link to a real `shortlists` row — §14.8/brief
--                           "maximum three candidates per shortlist" is
--                           already enforced by shortlists/shortlist_
--                           candidates' existing max_candidates=3 CHECK +
--                           trigger (0028) — this migration does not
--                           duplicate that cap, it only links to it.
--   poc_baselines          -- the client's self-reported raw inputs for
--                           their OWN process (this platform does not
--                           observe it directly) — candidate counts,
--                           timings, recruiter hours, as Dave (or whoever)
--                           reports them. Append-only: "preserve original
--                           inputs" (brief analytics rule) — a correction is
--                           a NEW row referencing the one it corrects via
--                           correction_of_baseline_id, never an UPDATE.
--   poc_metrics            -- the raw/intermediate data points (from either
--                           side) that a poc_results row is computed FROM,
--                           each tagged to the metric_definitions catalog
--                           entry (key+version) it feeds. Also append-only
--                           for the same "preserve original inputs" reason;
--                           corrections use supersedes_metric_id.
--   poc_exclusions         -- duplicate-candidate and out-of-search-
--                           boundary exclusions (§14.6), each with a
--                           mandatory reason — "explain excluded records,
--                           don't silently drop them" (brief analytics
--                           rule). still_counts_toward_speed defaults true
--                           per §14.6 ("counts toward each side's speed
--                           metric... excluded from the quality-
--                           differentiation comparison").
--   poc_results            -- computed comparison outputs, one row per
--                           (poc_role_id, metric_definition_id+version,
--                           side). status is 'computed' | 'pending' |
--                           'not_available' | 'not_measured'; a CHECK
--                           constraint makes it structurally impossible for
--                           a non-'computed' row to carry a value — the
--                           DB-level enforcement of "do not invent missing
--                           results... use Pending/Not Available/Not
--                           Measured instead of fabricated values."
--   poc_decisions           -- one CURRENT decision per benchmark
--                           ('proceed_to_paid_pilot' | 'extend_poc' |
--                           'do_not_proceed'), append-only history
--                           (mirrors outreach_approvals/client_decisions'
--                           append-only shape). notes is NOT NULL (brief:
--                           "Require decision notes") and approved_by/
--                           approved_at are both NOT NULL, i.e. the row's
--                           very existence IS the recorded authorized
--                           approval (brief: "authorized approval") — see
--                           the permission-matrix decision in packages/
--                           types/src/permissions.ts for WHO holds that
--                           authority.
--
-- "audit_events extensions" (brief §DATABASE) is a TS-level AuditAction
-- union extension in apps/web/lib/audit/log.ts, not a DB migration — same
-- established convention as Build Phases 7/8/9 (no audit_events DB enum
-- exists to extend).
--
-- NOTE ON CORRELATION VS CAUSATION (brief analytics rule "avoid presenting
-- correlation as causation"): this is a presentation/UI-copy concern for the
-- next UI wave, not something a schema or CHECK constraint can enforce —
-- flagged here so it isn't lost by the time that wave writes the report
-- screen.
--
-- Calculation logic itself, the analytics engine that populates poc_metrics
-- /poc_results from live platform data, server actions, and UI are
-- explicitly OUT OF SCOPE for this migration — next-wave work. This
-- migration only lays the schema + deterministic guardrails those waves
-- must operate inside of.

-- ---------------------------------------------------------------------------
-- metric_definitions (global, platform-owned, versioned catalog)
-- ---------------------------------------------------------------------------

create table if not exists public.metric_definitions (
  id uuid primary key default gen_random_uuid(),
  metric_key text not null check (char_length(btrim(metric_key)) > 0),
  version integer not null check (version > 0),
  name text not null check (char_length(btrim(name)) > 0),
  description text not null check (char_length(btrim(description)) > 0),
  -- Human-readable description of HOW this metric is calculated. The actual
  -- calculation code lives in the next wave's TypeScript, keyed by
  -- (metric_key, version); this is the auditable definition record that
  -- code must reference, never a substitute for it.
  calculation_notes text not null check (char_length(btrim(calculation_notes)) > 0),
  category text not null
    check (category in (
      'speed', 'quality', 'evidence', 'human_acceptance', 'candidate_response',
      'progression', 'effort', 'errors'
    )),
  unit text not null check (unit in ('percent', 'hours', 'count', 'ratio', 'boolean')),
  -- Which side(s) this metric is meaningfully collected for. Some metrics
  -- (e.g. evidence_coverage) are structurally vendor-only, since the
  -- client's manual process isn't expected to produce a structured evidence
  -- trail — that absence is itself reportable via poc_results.status =
  -- 'not_available', never fabricated.
  applies_to_side text not null default 'both'
    check (applies_to_side in ('vendor', 'client', 'both')),
  status text not null default 'active' check (status in ('active', 'deprecated')),
  published_by uuid references auth.users (id),
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (metric_key, version)
);

comment on table public.metric_definitions is
  'GLOBAL (no organization_id), versioned, platform-owned catalog of POC comparison metrics (Build Phase 10 brief §METRICS/§ANALYTICS RULES: "Define calculation logic centrally... version metric definitions"). Not tenant data. Immutable once any poc_results row references it (metric_definitions_immutable_once_referenced trigger below) — a revision always inserts a new (metric_key, version) row, never edits one in place.';

create index if not exists metric_definitions_key_idx
  on public.metric_definitions (metric_key, version desc);

-- Immutability once referenced: mirrors scorecard_versions' "immutable once
-- active" pattern (0016), but keyed off external reference (any poc_results
-- row) rather than the row's own status column.
create or replace function public.enforce_metric_definition_immutability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.poc_results pr where pr.metric_definition_id = old.id) then
      raise exception 'metric_definitions: % is referenced by at least one poc_results row and cannot be deleted', old.id
        using errcode = '23514';
    end if;
    return old;
  end if;

  -- UPDATE: status may still flip active <-> deprecated even once
  -- referenced (so a stale definition can be retired without rewriting
  -- history); every other column is frozen the instant any poc_results row
  -- references this definition.
  if exists (select 1 from public.poc_results pr where pr.metric_definition_id = new.id) then
    if new.id <> old.id
      or new.metric_key <> old.metric_key
      or new.version <> old.version
      or new.name <> old.name
      or new.description <> old.description
      or new.calculation_notes <> old.calculation_notes
      or new.category <> old.category
      or new.unit <> old.unit
      or new.applies_to_side <> old.applies_to_side
      or new.published_by is distinct from old.published_by
      or new.published_at <> old.published_at
      or new.created_at <> old.created_at
    then
      raise exception 'metric_definitions: % is referenced by at least one poc_results row and only status may change (revise by publishing a new version instead)', old.id
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

-- Deferred until after poc_results exists (see bottom of this file) —
-- forward-declared here in comment form only; the actual CREATE TRIGGER is
-- issued once poc_results is defined, since the function body references
-- it and a trigger can be created before the table it queries so long as
-- creation order at call time is correct (poc_results is created later in
-- this same file, before any row could exist to fire this trigger).

alter table public.metric_definitions enable row level security;

-- Read-only to every authenticated user (a shared, global reference
-- catalog every org's POC report renders against); write restricted to
-- platform_admin only — mirrors the "platform admin, cross-tenant" shape
-- used nowhere else as RLS (ai_prompt_versions in 0017 achieves the same
-- "platform-level asset" intent via NO RLS + NO grants at all, i.e.
-- service-role-only access) but the brief explicitly asks this one be
-- "read-only to all authenticated, write restricted to platform_admin", so
-- real RLS policies are used here instead of the ai_prompt_versions
-- no-grants approach.
create policy metric_definitions_select_all_authenticated
  on public.metric_definitions
  for select
  using (true);

create policy metric_definitions_write_platform_admin
  on public.metric_definitions
  for insert
  with check (public.is_platform_admin());

create policy metric_definitions_update_platform_admin
  on public.metric_definitions
  for update
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- No delete grant/policy at all — deletion is never a supported operation
-- for a published metric definition (deprecate via status instead).

-- ---------------------------------------------------------------------------
-- poc_benchmarks
-- ---------------------------------------------------------------------------

create table if not exists public.poc_benchmarks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  name text not null check (char_length(btrim(name)) > 0),
  status text not null default 'setup'
    check (status in ('setup', 'in_progress', 'completed', 'decided')),
  -- Shared start time both sides source from (docs/14-poc-specification.md
  -- §14.5) — a fair "same conditions" test requires this to be identical
  -- for both processes, so it lives once on the benchmark, not per
  -- participant.
  start_time timestamptz,
  -- "Agreed search boundaries" (§14.5) — geography, source pools, whatever
  -- was explicitly agreed so an unbounded comparison isn't silently unfair.
  -- Kept as jsonb (simple, auditable, next-wave UI can render freeform
  -- structure) rather than a rigid schema, since the brief only asks these
  -- be "agreed", not that they fit a fixed shape.
  search_boundaries jsonb not null default '{}'::jsonb,
  notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.poc_benchmarks is
  'One POC comparison definition per client engagement (Build Phase 10 brief §DATABASE). Deliberately NOT tied to a single recruitment_project — see this migration''s header note reconciling with docs/07-data-model.md §7.2''s original 1:1 sketch. The two live roles being benchmarked are poc_roles rows, each pointing at its own job/project.';

create index if not exists poc_benchmarks_org_idx
  on public.poc_benchmarks (organization_id, status);
create index if not exists poc_benchmarks_client_idx
  on public.poc_benchmarks (client_id);

drop trigger if exists poc_benchmarks_set_updated_at on public.poc_benchmarks;
create trigger poc_benchmarks_set_updated_at
  before update on public.poc_benchmarks
  for each row execute function public.set_updated_at();

-- RLS for poc_benchmarks is enabled further below, once poc_roles exists as
-- a relation (the select policy's recruiter branch queries it) — see the
-- "poc_benchmarks RLS" section immediately after the poc_roles CREATE TABLE.

-- ---------------------------------------------------------------------------
-- poc_roles
-- ---------------------------------------------------------------------------

create table if not exists public.poc_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  poc_benchmark_id uuid not null references public.poc_benchmarks (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete restrict,
  -- Denormalized from jobs.recruitment_project_id at insert time (validated
  -- by trigger below), same pattern as outreach_sequences in 0029, so RLS
  -- never needs a join through jobs.
  recruitment_project_id uuid not null references public.recruitment_projects (id) on delete cascade,
  role_type text not null check (role_type in ('standard', 'senior_or_difficult')),
  label text,
  notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- "Two live roles: one standard, one senior_or_difficult" (docs/14-poc-
  -- specification.md §14.2) — at most one of each type per benchmark. The
  -- "at least one of each once active" half of the invariant is enforced by
  -- the poc_benchmarks role-mix trigger below, since a CHECK/unique
  -- constraint alone can only prevent duplicates, not require presence.
  unique (poc_benchmark_id, role_type)
);

-- ---------------------------------------------------------------------------
-- poc_benchmarks RLS — deferred to here (poc_roles now exists as a
-- relation) since the select policy's recruiter branch queries it.
-- ---------------------------------------------------------------------------

alter table public.poc_benchmarks enable row level security;

create policy poc_benchmarks_select_scoped
  on public.poc_benchmarks
  for select
  using (
    public.is_platform_admin()
    or public.has_org_role(
      organization_id,
      array['agency_admin', 'read_only_reviewer', 'client_decision_maker']::public.app_role[]
    )
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and exists (
        select 1 from public.poc_roles r
        where r.poc_benchmark_id = poc_benchmarks.id
          and public.is_assigned_to_project(r.recruitment_project_id)
      )
    )
  );

-- Write (create/configure a benchmark) is an Agency Admin action — see
-- packages/types/src/permissions.ts poc_reports matrix entry for the
-- reasoning. Recruiters read; they do not configure the benchmark itself.
create policy poc_benchmarks_write_agency_admin
  on public.poc_benchmarks
  for all
  using (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
  )
  with check (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
  );

comment on table public.poc_roles is
  'Exactly the two live roles a benchmark compares: one standard, one senior_or_difficult (docs/14-poc-specification.md §14.2, Build Phase 10 brief §POC RULES "Two live roles... One standard role... One senior or difficult role"). The role-mix invariant is enforced once the parent benchmark leaves status=''setup'' (poc_benchmarks_enforce_role_mix trigger) — during setup, 0 or 1 roles may exist while being configured.';

create index if not exists poc_roles_benchmark_idx
  on public.poc_roles (poc_benchmark_id);
create index if not exists poc_roles_project_idx
  on public.poc_roles (recruitment_project_id);

drop trigger if exists poc_roles_set_updated_at on public.poc_roles;
create trigger poc_roles_set_updated_at
  before update on public.poc_roles
  for each row execute function public.set_updated_at();

create or replace function public.enforce_poc_role_consistency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_org uuid;
  v_job_project uuid;
  v_benchmark_org uuid;
  v_benchmark_status text;
begin
  select j.organization_id, j.recruitment_project_id into v_job_org, v_job_project
    from public.jobs j where j.id = new.job_id;

  if v_job_org is distinct from new.organization_id
    or v_job_project is distinct from new.recruitment_project_id
  then
    raise exception 'poc_roles: organization_id/recruitment_project_id must match the referenced job''s'
      using errcode = '23514';
  end if;

  select b.organization_id, b.status into v_benchmark_org, v_benchmark_status
    from public.poc_benchmarks b where b.id = new.poc_benchmark_id;

  if v_benchmark_org is distinct from new.organization_id then
    raise exception 'poc_roles: organization_id must match the referenced poc_benchmark''s'
      using errcode = '23514';
  end if;

  if tg_op = 'DELETE' and v_benchmark_status <> 'setup' then
    raise exception 'poc_roles: cannot remove a role from benchmark % once it has left setup (status = %)', new.poc_benchmark_id, v_benchmark_status
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists poc_roles_enforce_consistency on public.poc_roles;
create trigger poc_roles_enforce_consistency
  before insert or update on public.poc_roles
  for each row execute function public.enforce_poc_role_consistency();

-- Separate DELETE-only trigger, since the function above reads NEW, which
-- does not exist on DELETE.
create or replace function public.enforce_poc_role_delete_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_benchmark_status text;
begin
  select b.status into v_benchmark_status
    from public.poc_benchmarks b where b.id = old.poc_benchmark_id;

  if v_benchmark_status <> 'setup' then
    raise exception 'poc_roles: cannot remove role % from benchmark % once it has left setup (status = %)', old.id, old.poc_benchmark_id, v_benchmark_status
      using errcode = '23514';
  end if;

  return old;
end;
$$;

drop trigger if exists poc_roles_enforce_delete_lock on public.poc_roles;
create trigger poc_roles_enforce_delete_lock
  before delete on public.poc_roles
  for each row execute function public.enforce_poc_role_delete_lock();

-- Role-mix invariant on the benchmark side: once a benchmark leaves
-- 'setup', it must have exactly one 'standard' and one 'senior_or_difficult'
-- poc_roles row. Fires on poc_benchmarks status transitions, not on
-- poc_roles writes, since that is the one moment the invariant must hold;
-- poc_roles.poc_roles_enforce_delete_lock above prevents removing a role
-- afterward, which would otherwise silently violate it.
create or replace function public.enforce_poc_benchmark_role_mix()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_standard_count integer;
  v_senior_count integer;
begin
  if new.status = 'setup' then
    return new;
  end if;

  select
    count(*) filter (where role_type = 'standard'),
    count(*) filter (where role_type = 'senior_or_difficult')
    into v_standard_count, v_senior_count
    from public.poc_roles
    where poc_benchmark_id = new.id;

  if v_standard_count <> 1 or v_senior_count <> 1 then
    raise exception 'poc_benchmarks: benchmark % must have exactly one standard and one senior_or_difficult poc_roles row before leaving setup (found % standard, % senior_or_difficult)', new.id, v_standard_count, v_senior_count
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists poc_benchmarks_enforce_role_mix on public.poc_benchmarks;
create trigger poc_benchmarks_enforce_role_mix
  before insert or update of status on public.poc_benchmarks
  for each row
  when (new.status <> 'setup')
  execute function public.enforce_poc_benchmark_role_mix();

alter table public.poc_roles enable row level security;

create policy poc_roles_select_scoped
  on public.poc_roles
  for select
  using (
    public.is_platform_admin()
    or public.has_org_role(
      organization_id,
      array['agency_admin', 'read_only_reviewer', 'client_decision_maker']::public.app_role[]
    )
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and public.is_assigned_to_project(recruitment_project_id)
    )
  );

create policy poc_roles_write_agency_admin
  on public.poc_roles
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
-- poc_participants
-- ---------------------------------------------------------------------------

create table if not exists public.poc_participants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  poc_benchmark_id uuid not null references public.poc_benchmarks (id) on delete cascade,
  poc_role_id uuid not null references public.poc_roles (id) on delete cascade,
  process_type text not null check (process_type in ('client_baseline', 'vendor_assisted')),
  -- Only meaningful for the vendor_assisted side, which is expected to
  -- (eventually) produce a real shortlist through the existing shortlisting
  -- system (0028) — shortlists.max_candidates already defaults to 3 with an
  -- authorized-override trigger, so the brief's "maximum three candidates
  -- per shortlist" is enforced there, not duplicated here.
  shortlist_id uuid references public.shortlists (id) on delete set null,
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'completed')),
  started_at timestamptz,
  completed_at timestamptz,
  notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (poc_role_id, process_type),
  constraint poc_participants_shortlist_only_for_vendor check (
    shortlist_id is null or process_type = 'vendor_assisted'
  )
);

comment on table public.poc_participants is
  'The two processes compared per role: the client''s own current process (client_baseline) vs. this platform''s (vendor_assisted) — docs/14-poc-specification.md §14.3. shortlist_id links the vendor_assisted side to a real shortlists row (0028) once one exists; the existing max_candidates=3 cap there is reused, not duplicated (see this migration''s header note).';

create index if not exists poc_participants_role_idx
  on public.poc_participants (poc_role_id);
create index if not exists poc_participants_benchmark_idx
  on public.poc_participants (poc_benchmark_id);

drop trigger if exists poc_participants_set_updated_at on public.poc_participants;
create trigger poc_participants_set_updated_at
  before update on public.poc_participants
  for each row execute function public.set_updated_at();

create or replace function public.enforce_poc_participant_consistency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role_org uuid;
  v_role_benchmark uuid;
begin
  select r.organization_id, r.poc_benchmark_id into v_role_org, v_role_benchmark
    from public.poc_roles r where r.id = new.poc_role_id;

  if v_role_org is distinct from new.organization_id
    or v_role_benchmark is distinct from new.poc_benchmark_id
  then
    raise exception 'poc_participants: organization_id/poc_benchmark_id must match the referenced poc_role''s'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists poc_participants_enforce_consistency on public.poc_participants;
create trigger poc_participants_enforce_consistency
  before insert or update on public.poc_participants
  for each row execute function public.enforce_poc_participant_consistency();

alter table public.poc_participants enable row level security;

create policy poc_participants_select_scoped
  on public.poc_participants
  for select
  using (
    public.is_platform_admin()
    or public.has_org_role(
      organization_id,
      array['agency_admin', 'read_only_reviewer', 'client_decision_maker']::public.app_role[]
    )
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and exists (
        select 1 from public.poc_roles r
        where r.id = poc_participants.poc_role_id
          and public.is_assigned_to_project(r.recruitment_project_id)
      )
    )
  );

create policy poc_participants_write_internal
  on public.poc_participants
  for all
  using (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and exists (
        select 1 from public.poc_roles r
        where r.id = poc_participants.poc_role_id
          and public.is_assigned_to_project(r.recruitment_project_id)
      )
    )
  )
  with check (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and exists (
        select 1 from public.poc_roles r
        where r.id = poc_participants.poc_role_id
          and public.is_assigned_to_project(r.recruitment_project_id)
      )
    )
  );

-- ---------------------------------------------------------------------------
-- poc_baselines — client's self-reported raw inputs for their OWN process.
-- Append-only: "preserve original inputs" (brief analytics rule). A
-- correction is a new row referencing the one it corrects, never an UPDATE.
-- ---------------------------------------------------------------------------

create table if not exists public.poc_baselines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  poc_benchmark_id uuid not null references public.poc_benchmarks (id) on delete cascade,
  poc_role_id uuid not null references public.poc_roles (id) on delete cascade,
  poc_participant_id uuid not null references public.poc_participants (id) on delete cascade,
  candidates_sourced_count integer check (candidates_sourced_count is null or candidates_sourced_count >= 0),
  candidates_reviewed_count integer check (candidates_reviewed_count is null or candidates_reviewed_count >= 0),
  shortlist_candidate_count integer check (shortlist_candidate_count is null or shortlist_candidate_count >= 0),
  time_to_first_qualified_hours numeric(10, 2) check (time_to_first_qualified_hours is null or time_to_first_qualified_hours >= 0),
  time_to_shortlist_hours numeric(10, 2) check (time_to_shortlist_hours is null or time_to_shortlist_hours >= 0),
  recruiter_hours_spent numeric(10, 2) check (recruiter_hours_spent is null or recruiter_hours_spent >= 0),
  -- The client (or agency staff on the client's behalf) who reported this —
  -- a client contact frequently has no platform account, so this is a free
  -- text label, not a strict FK; reported_by_user_id captures the
  -- recruiter/admin who recorded it, when applicable.
  reported_by_user_id uuid references auth.users (id),
  reported_by_label text,
  notes text,
  -- Preserve-original-inputs: a correction is a NEW row pointing back at
  -- the row it corrects, never a mutation of the original.
  correction_of_baseline_id uuid references public.poc_baselines (id) on delete set null,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

comment on table public.poc_baselines is
  'Client''s self-reported raw inputs for their own (client_baseline) process — candidate counts, timings, recruiter hours (docs/14-poc-specification.md, Build Phase 10 brief §DATABASE). Append-only (no update/delete grant below): "preserve original inputs" — a correction is a new row via correction_of_baseline_id, never an in-place edit.';

create index if not exists poc_baselines_participant_idx
  on public.poc_baselines (poc_participant_id, created_at desc);

create or replace function public.enforce_poc_baseline_consistency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_participant_org uuid;
  v_participant_benchmark uuid;
  v_participant_role uuid;
  v_participant_process text;
begin
  select p.organization_id, p.poc_benchmark_id, p.poc_role_id, p.process_type
    into v_participant_org, v_participant_benchmark, v_participant_role, v_participant_process
    from public.poc_participants p where p.id = new.poc_participant_id;

  if v_participant_process <> 'client_baseline' then
    raise exception 'poc_baselines: poc_participant % is not the client_baseline process for its role', new.poc_participant_id
      using errcode = '23514';
  end if;

  if v_participant_org is distinct from new.organization_id
    or v_participant_benchmark is distinct from new.poc_benchmark_id
    or v_participant_role is distinct from new.poc_role_id
  then
    raise exception 'poc_baselines: organization_id/poc_benchmark_id/poc_role_id must match the referenced poc_participant''s'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists poc_baselines_enforce_consistency on public.poc_baselines;
create trigger poc_baselines_enforce_consistency
  before insert on public.poc_baselines
  for each row execute function public.enforce_poc_baseline_consistency();

revoke update, delete on public.poc_baselines from authenticated, anon;

alter table public.poc_baselines enable row level security;

create policy poc_baselines_select_scoped
  on public.poc_baselines
  for select
  using (
    public.is_platform_admin()
    or public.has_org_role(
      organization_id,
      array['agency_admin', 'read_only_reviewer']::public.app_role[]
    )
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and exists (
        select 1 from public.poc_roles r
        where r.id = poc_baselines.poc_role_id
          and public.is_assigned_to_project(r.recruitment_project_id)
      )
    )
  );

create policy poc_baselines_insert_scoped
  on public.poc_baselines
  for insert
  with check (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and exists (
        select 1 from public.poc_roles r
        where r.id = poc_baselines.poc_role_id
          and public.is_assigned_to_project(r.recruitment_project_id)
      )
    )
  );

-- ---------------------------------------------------------------------------
-- poc_metrics — raw/intermediate data points (either side) that a
-- poc_results row is computed FROM. Append-only for the same
-- preserve-original-inputs reason as poc_baselines.
-- ---------------------------------------------------------------------------

create table if not exists public.poc_metrics (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  poc_benchmark_id uuid not null references public.poc_benchmarks (id) on delete cascade,
  poc_role_id uuid not null references public.poc_roles (id) on delete cascade,
  poc_participant_id uuid not null references public.poc_participants (id) on delete cascade,
  metric_definition_id uuid not null references public.metric_definitions (id) on delete restrict,
  -- Pinned explicitly rather than re-derived, so a later metric_definitions
  -- revision never silently reinterprets a historical raw data point.
  metric_definition_version integer not null check (metric_definition_version > 0),
  data_point_key text not null check (char_length(btrim(data_point_key)) > 0),
  value_numeric numeric,
  value_text text,
  value_jsonb jsonb,
  unit text check (unit is null or unit in ('percent', 'hours', 'count', 'ratio', 'boolean')),
  source text not null
    check (source in ('platform_computed', 'client_reported', 'manual_recruiter_entry', 'ai_derived')),
  -- Preserve-original-inputs: a correction is a new row, never an UPDATE.
  supersedes_metric_id uuid references public.poc_metrics (id) on delete set null,
  notes text,
  recorded_by uuid references auth.users (id),
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint poc_metrics_value_required check (
    value_numeric is not null or value_text is not null or value_jsonb is not null
  )
);

comment on table public.poc_metrics is
  'Raw/intermediate data points (either side) that a poc_results row is computed from (Build Phase 10 brief §ANALYTICS RULES: "preserve original inputs"). Tagged to the metric_definitions catalog entry (key+version) it feeds. Append-only (no update/delete grant below) — a correction is a new row via supersedes_metric_id.';

create index if not exists poc_metrics_role_metric_idx
  on public.poc_metrics (poc_role_id, metric_definition_id, recorded_at desc);
create index if not exists poc_metrics_participant_idx
  on public.poc_metrics (poc_participant_id);

create or replace function public.enforce_poc_metric_consistency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_participant_org uuid;
  v_participant_benchmark uuid;
  v_participant_role uuid;
  v_def_exists boolean;
begin
  select p.organization_id, p.poc_benchmark_id, p.poc_role_id
    into v_participant_org, v_participant_benchmark, v_participant_role
    from public.poc_participants p where p.id = new.poc_participant_id;

  if v_participant_org is distinct from new.organization_id
    or v_participant_benchmark is distinct from new.poc_benchmark_id
    or v_participant_role is distinct from new.poc_role_id
  then
    raise exception 'poc_metrics: organization_id/poc_benchmark_id/poc_role_id must match the referenced poc_participant''s'
      using errcode = '23514';
  end if;

  select exists (
    select 1 from public.metric_definitions md
    where md.id = new.metric_definition_id and md.version = new.metric_definition_version
  ) into v_def_exists;

  if not v_def_exists then
    raise exception 'poc_metrics: metric_definition_id %/version % does not match any metric_definitions row', new.metric_definition_id, new.metric_definition_version
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists poc_metrics_enforce_consistency on public.poc_metrics;
create trigger poc_metrics_enforce_consistency
  before insert on public.poc_metrics
  for each row execute function public.enforce_poc_metric_consistency();

revoke update, delete on public.poc_metrics from authenticated, anon;

alter table public.poc_metrics enable row level security;

create policy poc_metrics_select_scoped
  on public.poc_metrics
  for select
  using (
    public.is_platform_admin()
    or public.has_org_role(
      organization_id,
      array['agency_admin', 'read_only_reviewer']::public.app_role[]
    )
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and exists (
        select 1 from public.poc_roles r
        where r.id = poc_metrics.poc_role_id
          and public.is_assigned_to_project(r.recruitment_project_id)
      )
    )
  );

create policy poc_metrics_insert_scoped
  on public.poc_metrics
  for insert
  with check (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and exists (
        select 1 from public.poc_roles r
        where r.id = poc_metrics.poc_role_id
          and public.is_assigned_to_project(r.recruitment_project_id)
      )
    )
  );

-- ---------------------------------------------------------------------------
-- poc_exclusions — duplicate-candidate / out-of-search-boundary exclusions
-- (docs/14-poc-specification.md §14.6), each with a mandatory reason.
-- Append-only; a reversal is a new row referencing the one it reverses.
-- ---------------------------------------------------------------------------

create table if not exists public.poc_exclusions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  poc_benchmark_id uuid not null references public.poc_benchmarks (id) on delete cascade,
  poc_role_id uuid not null references public.poc_roles (id) on delete cascade,
  -- A candidate on the client's side may never exist in our `candidates`
  -- table at all (Dave's own process, not observed by this platform), so
  -- candidate_id is nullable and candidate_reference_label is a free-text
  -- fallback identifier — at least one of the two must be present.
  candidate_id uuid references public.candidates (id) on delete set null,
  candidate_reference_label text,
  -- Which side(s) this exclusion affects the quality-differentiation
  -- comparison for.
  side text not null check (side in ('vendor', 'client', 'both')),
  exclusion_type text not null
    check (exclusion_type in ('duplicate_across_sides', 'out_of_search_boundary', 'other')),
  reason text not null check (char_length(btrim(reason)) > 0),
  -- docs/14-poc-specification.md §14.6: a duplicate still counts toward
  -- each side's SPEED metric even while excluded from the quality-
  -- differentiation comparison.
  still_counts_toward_speed boolean not null default true,
  reverses_exclusion_id uuid references public.poc_exclusions (id) on delete set null,
  excluded_by uuid not null references auth.users (id),
  excluded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint poc_exclusions_candidate_identified check (
    candidate_id is not null or candidate_reference_label is not null
  )
);

comment on table public.poc_exclusions is
  'Duplicate-candidate / out-of-search-boundary exclusions, each with a mandatory reason (docs/14-poc-specification.md §14.6, Build Phase 10 brief §ANALYTICS RULES: "explain excluded records" — never silently dropped). Append-only (no update/delete grant below) — a reversal is a new row via reverses_exclusion_id.';

create index if not exists poc_exclusions_role_idx
  on public.poc_exclusions (poc_role_id);
create index if not exists poc_exclusions_candidate_idx
  on public.poc_exclusions (candidate_id) where candidate_id is not null;

create or replace function public.enforce_poc_exclusion_consistency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role_org uuid;
  v_role_benchmark uuid;
begin
  select r.organization_id, r.poc_benchmark_id into v_role_org, v_role_benchmark
    from public.poc_roles r where r.id = new.poc_role_id;

  if v_role_org is distinct from new.organization_id
    or v_role_benchmark is distinct from new.poc_benchmark_id
  then
    raise exception 'poc_exclusions: organization_id/poc_benchmark_id must match the referenced poc_role''s'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists poc_exclusions_enforce_consistency on public.poc_exclusions;
create trigger poc_exclusions_enforce_consistency
  before insert on public.poc_exclusions
  for each row execute function public.enforce_poc_exclusion_consistency();

revoke update, delete on public.poc_exclusions from authenticated, anon;

alter table public.poc_exclusions enable row level security;

create policy poc_exclusions_select_scoped
  on public.poc_exclusions
  for select
  using (
    public.is_platform_admin()
    or public.has_org_role(
      organization_id,
      array['agency_admin', 'read_only_reviewer']::public.app_role[]
    )
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and exists (
        select 1 from public.poc_roles r
        where r.id = poc_exclusions.poc_role_id
          and public.is_assigned_to_project(r.recruitment_project_id)
      )
    )
  );

create policy poc_exclusions_insert_scoped
  on public.poc_exclusions
  for insert
  with check (
    excluded_by = auth.uid()
    and (
      public.is_platform_admin()
      or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
      or (
        public.has_org_role(organization_id, array['recruiter']::public.app_role[])
        and exists (
          select 1 from public.poc_roles r
          where r.id = poc_exclusions.poc_role_id
            and public.is_assigned_to_project(r.recruitment_project_id)
        )
      )
    )
  );

-- ---------------------------------------------------------------------------
-- poc_results — computed comparison outputs. The CHECK constraint below is
-- the DB-level enforcement of "do not invent missing results... use
-- Pending/Not Available/Not Measured instead of fabricated values."
-- ---------------------------------------------------------------------------

create table if not exists public.poc_results (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  poc_benchmark_id uuid not null references public.poc_benchmarks (id) on delete cascade,
  poc_role_id uuid not null references public.poc_roles (id) on delete cascade,
  metric_definition_id uuid not null references public.metric_definitions (id) on delete restrict,
  -- Pinned explicitly so a result computed under an earlier metric
  -- definition revision stays interpretable even after that revision is
  -- superseded by a newer version (brief §ANALYTICS RULES "version metric
  -- definitions... historical results remain interpretable").
  metric_definition_version integer not null check (metric_definition_version > 0),
  side text not null check (side in ('vendor', 'client')),
  status text not null default 'pending'
    check (status in ('computed', 'pending', 'not_available', 'not_measured')),
  value numeric,
  value_unit text check (value_unit is null or value_unit in ('percent', 'hours', 'count', 'ratio', 'boolean')),
  -- References into poc_metrics/poc_baselines rows this value was computed
  -- from (an array of ids) — never the calculation formula itself, which
  -- lives in the next wave's TypeScript, not in this table.
  calculation_input_ref jsonb not null default '[]'::jsonb,
  computed_at timestamptz,
  computed_by uuid references auth.users (id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (poc_role_id, metric_definition_id, metric_definition_version, side),
  -- The structural guarantee: a non-'computed' status can never carry a
  -- fabricated numeric value, and a 'computed' status always carries one.
  constraint poc_results_value_matches_status check (
    (status = 'computed' and value is not null)
    or (status <> 'computed' and value is null)
  )
);

comment on table public.poc_results is
  'Computed comparison outputs per (role, metric, side) (Build Phase 10 brief §DATABASE). poc_results_value_matches_status is the DB-level enforcement of "do not invent missing results... use Pending/Not Available/Not Measured instead of fabricated values" (brief §METRICS). Note: correlation shown here (e.g. a metric moving alongside another) must never be presented as causation in the report UI this feeds — a presentation-layer concern the next UI wave must honor, not something this schema can enforce.';

create index if not exists poc_results_role_idx
  on public.poc_results (poc_role_id, side);
create index if not exists poc_results_benchmark_idx
  on public.poc_results (poc_benchmark_id);

drop trigger if exists poc_results_set_updated_at on public.poc_results;
create trigger poc_results_set_updated_at
  before update on public.poc_results
  for each row execute function public.set_updated_at();

create or replace function public.enforce_poc_result_consistency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role_org uuid;
  v_role_benchmark uuid;
  v_def_exists boolean;
begin
  select r.organization_id, r.poc_benchmark_id into v_role_org, v_role_benchmark
    from public.poc_roles r where r.id = new.poc_role_id;

  if v_role_org is distinct from new.organization_id
    or v_role_benchmark is distinct from new.poc_benchmark_id
  then
    raise exception 'poc_results: organization_id/poc_benchmark_id must match the referenced poc_role''s'
      using errcode = '23514';
  end if;

  select exists (
    select 1 from public.metric_definitions md
    where md.id = new.metric_definition_id and md.version = new.metric_definition_version
  ) into v_def_exists;

  if not v_def_exists then
    raise exception 'poc_results: metric_definition_id %/version % does not match any metric_definitions row', new.metric_definition_id, new.metric_definition_version
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists poc_results_enforce_consistency on public.poc_results;
create trigger poc_results_enforce_consistency
  before insert or update on public.poc_results
  for each row execute function public.enforce_poc_result_consistency();

-- Now that poc_results exists, wire up the metric_definitions immutability
-- trigger declared earlier in this file.
drop trigger if exists metric_definitions_immutable_once_referenced on public.metric_definitions;
create trigger metric_definitions_immutable_once_referenced
  before update or delete on public.metric_definitions
  for each row execute function public.enforce_metric_definition_immutability();

alter table public.poc_results enable row level security;

create policy poc_results_select_scoped
  on public.poc_results
  for select
  using (
    public.is_platform_admin()
    or public.has_org_role(
      organization_id,
      array['agency_admin', 'read_only_reviewer', 'client_decision_maker']::public.app_role[]
    )
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and exists (
        select 1 from public.poc_roles r
        where r.id = poc_results.poc_role_id
          and public.is_assigned_to_project(r.recruitment_project_id)
      )
    )
  );

create policy poc_results_write_internal
  on public.poc_results
  for all
  using (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and exists (
        select 1 from public.poc_roles r
        where r.id = poc_results.poc_role_id
          and public.is_assigned_to_project(r.recruitment_project_id)
      )
    )
  )
  with check (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and exists (
        select 1 from public.poc_roles r
        where r.id = poc_results.poc_role_id
          and public.is_assigned_to_project(r.recruitment_project_id)
      )
    )
  );

-- ---------------------------------------------------------------------------
-- poc_decisions — one CURRENT decision per benchmark, append-only history.
-- The row's very existence IS the recorded authorized approval: notes,
-- approved_by and approved_at are all required at insert time.
-- ---------------------------------------------------------------------------

create table if not exists public.poc_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  poc_benchmark_id uuid not null references public.poc_benchmarks (id) on delete cascade,
  decision text not null
    check (decision in ('proceed_to_paid_pilot', 'extend_poc', 'do_not_proceed')),
  -- Brief: "Require decision notes."
  notes text not null check (char_length(btrim(notes)) > 0),
  -- Brief: "...and authorized approval." Both required together, at insert
  -- time — see packages/types/src/permissions.ts for which role(s) the
  -- insert RLS policy below restricts this to.
  approved_by uuid not null references auth.users (id),
  approved_at timestamptz not null default now(),
  is_current boolean not null default true,
  supersedes_decision_id uuid references public.poc_decisions (id) on delete set null,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

comment on table public.poc_decisions is
  'One CURRENT decision per benchmark (proceed_to_paid_pilot / extend_poc / do_not_proceed), append-only history — mirrors client_decisions/outreach_approvals'' append-only shape (0028/0029). The row''s existence IS the recorded authorized approval (notes/approved_by/approved_at all required at insert). poc_decisions_flip_current below keeps exactly one is_current=true row per benchmark as new decisions are recorded.';

create index if not exists poc_decisions_benchmark_idx
  on public.poc_decisions (poc_benchmark_id, created_at desc);
create unique index if not exists poc_decisions_one_current_per_benchmark_idx
  on public.poc_decisions (poc_benchmark_id) where is_current;

create or replace function public.enforce_poc_decision_current()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_current then
    update public.poc_decisions
      set is_current = false
      where poc_benchmark_id = new.poc_benchmark_id
        and is_current = true;

    if new.supersedes_decision_id is null then
      select id into new.supersedes_decision_id
        from public.poc_decisions
        where poc_benchmark_id = new.poc_benchmark_id
          and id <> new.id
        order by created_at desc
        limit 1;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists poc_decisions_flip_current on public.poc_decisions;
create trigger poc_decisions_flip_current
  before insert on public.poc_decisions
  for each row execute function public.enforce_poc_decision_current();

revoke update, delete on public.poc_decisions from authenticated, anon;

alter table public.poc_decisions enable row level security;

create policy poc_decisions_select_scoped
  on public.poc_decisions
  for select
  using (
    public.is_platform_admin()
    or public.has_org_role(
      organization_id,
      array['agency_admin', 'read_only_reviewer', 'client_decision_maker']::public.app_role[]
    )
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and exists (
        select 1 from public.poc_benchmarks b
        join public.poc_roles r on r.poc_benchmark_id = b.id
        where b.id = poc_decisions.poc_benchmark_id
          and public.is_assigned_to_project(r.recruitment_project_id)
      )
    )
  );

-- Only Agency Admin (or platform_admin) holds decision-approval authority —
-- see packages/types/src/permissions.ts poc_reports matrix comment for the
-- full reasoning (internal sign-off on which process to proceed with is an
-- agency decision, even though it is normally discussed with the client
-- first per docs/14-poc-specification.md §14.16/§14.17).
create policy poc_decisions_insert_agency_admin
  on public.poc_decisions
  for insert
  with check (
    approved_by = auth.uid()
    and (
      public.is_platform_admin()
      or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
    )
  );

-- ---------------------------------------------------------------------------
-- Seed: metric_definitions version 1 — the ~15 metrics the brief lists
-- (§METRICS). calculation CODE lives in the next wave's TypeScript; these
-- rows are only the auditable, versioned definition/description record.
-- ---------------------------------------------------------------------------

insert into public.metric_definitions
  (metric_key, version, name, description, calculation_notes, category, unit, applies_to_side)
values
  ('time_to_first_qualified_candidate', 1,
   'Time to First Qualified Candidate',
   'Wall-clock time from the benchmark''s shared start_time until the first candidate that passes all mandatory gates is identified on this side.',
   'Computed deterministically from timestamped pipeline events (vendor side) or poc_baselines.time_to_first_qualified_hours (client side, self-reported). Never estimated by AI.',
   'speed', 'hours', 'both'),
  ('time_to_completed_shortlist', 1,
   'Time to Completed Shortlist',
   'Wall-clock time from the benchmark''s shared start_time until a 2-3 candidate shortlist is ready for review on this side.',
   'Vendor side: timestamp of the shortlist reaching a submitted-for-approval state (0028). Client side: poc_baselines.time_to_shortlist_hours (self-reported).',
   'speed', 'hours', 'both'),
  ('candidates_discovered', 1,
   'Candidates Discovered',
   'Total distinct candidates surfaced by this side during the benchmark window, before any gate or dedup exclusion.',
   'Vendor side: count of candidate_project_entries for the linked role/project within the benchmark window. Client side: poc_baselines.candidates_sourced_count.',
   'progression', 'count', 'both'),
  ('candidates_reviewed', 1,
   'Candidates Reviewed',
   'Candidates that received a substantive human or platform review on this side.',
   'Vendor side: count of human_reviews rows for the role. Client side: poc_baselines.candidates_reviewed_count.',
   'progression', 'count', 'both'),
  ('mandatory_gate_pass_rate', 1,
   'Mandatory-Gate Pass Rate',
   'Share of reviewed candidates that pass every mandatory requirement gate.',
   'Vendor side only by default (structural — mandatory_gate_results, 0027): passed / reviewed. Client side reported as not_available unless the client tracks an equivalent pass/fail decision explicitly.',
   'quality', 'percent', 'both'),
  ('candidates_scoring_90_or_higher', 1,
   'Candidates Scoring 90% or Higher',
   'Count of candidates reaching or exceeding a 90% overall match score, used as the POC''s agreed ranking-consideration cutoff (docs/14-poc-specification.md §14.14 point 3 — an operating parameter for this benchmark, not a claim the two methodologies are equivalent).',
   'Vendor side: count from candidate_role_matches.overall_score >= 90 among eligible candidates. Client side: not_available unless Dave''s own scoring exposes a comparable percentage.',
   'quality', 'count', 'both'),
  ('evidence_coverage', 1,
   'Evidence Coverage',
   'Percentage of a shortlisted candidate''s claims backed by cited, verifiable evidence.',
   'Vendor side: structural guarantee from requirement_evidence / scoring_breakdowns (0027) — target 100%. Client side: not_available by default (the client''s manual process is not expected to produce a structured evidence trail) — never fabricated to make the comparison look symmetric.',
   'evidence', 'percent', 'both'),
  ('shortlist_acceptance_rate', 1,
   'Shortlist Acceptance Rate',
   'Share of this side''s shortlisted candidates the client accepts (vs. rejects/discusses).',
   'Vendor side: derived from client_decisions rows (0028) for the linked shortlist. Client side: poc_baselines-reported or not_measured if the client does not track this distinctly.',
   'human_acceptance', 'percent', 'both'),
  ('candidate_response_rate', 1,
   'Candidate Response Rate',
   'Share of contacted candidates who respond at all (any classification).',
   'Vendor side: candidate_responses rows / outreach_messages sent (0029). Client side: poc_baselines-reported or not_available.',
   'candidate_response', 'percent', 'both'),
  ('candidate_interest_rate', 1,
   'Candidate Interest Rate',
   'Share of contacted candidates who respond with interested / needs_more_info (not a decline or opt-out).',
   'Vendor side: candidate_responses.confirmed_classification in (''interested'',''needs_more_info'') / responses received. Client side: poc_baselines-reported or not_available.',
   'candidate_response', 'percent', 'both'),
  ('interview_progression', 1,
   'Interview Progression',
   'Share of shortlisted candidates on this side who reach at least one scheduled interview.',
   'Vendor side: interviews rows linked via candidate_role_matches. Client side: poc_baselines-reported or not_measured if the follow-up window does not allow observing this.',
   'progression', 'percent', 'both'),
  ('offer_progression', 1,
   'Offer Progression (where available)',
   'Share of interviewed candidates on this side who receive an offer, where the POC timeline allows a follow-up check (docs/14-poc-specification.md §14.9).',
   'Not structurally tracked yet on the vendor side as of this migration (no offer-stage table exists) — always not_measured or not_available until that data exists; never inferred or estimated. Client side likewise reported, not computed.',
   'progression', 'percent', 'both'),
  ('recruiter_hours', 1,
   'Recruiter Hours',
   'Total human recruiter hours actually spent running this side''s process during the benchmark window.',
   'Vendor side: manual_recruiter_entry poc_metrics rows (no automatic time-tracking exists) unless a future phase adds one. Client side: poc_baselines.recruiter_hours_spent.',
   'effort', 'hours', 'both'),
  ('critical_errors', 1,
   'Critical Errors',
   'Count of structural failures this side produced during the benchmark — e.g. a shortlisted candidate who failed a mandatory gate reaching client review (docs/14-poc-specification.md §14.15 failure criteria).',
   'Vendor side: derived from audit_events / gate-override records flagged as structural violations, reviewed by a human, never an automatic AI judgment. Client side: reported by the reviewing recruiter with a documented reason.',
   'errors', 'count', 'both'),
  ('unsupported_claims', 1,
   'Unsupported Claims',
   'Count of candidate claims in the shortlisted pool found to lack verifiable evidence (docs/14-poc-specification.md §14.15 failure criteria; core rule: AI must never invent candidate evidence).',
   'Vendor side: structural target is zero, verified by a human reviewer against requirement_evidence citations. Client side: not_available unless the client''s process is independently audited for this.',
   'evidence', 'count', 'both')
on conflict (metric_key, version) do nothing;

-- ---------------------------------------------------------------------------
-- Grants (roles created in 0001; RLS above is the real gate, these mirror
-- the existing table-privilege baseline established across every prior
-- migration). Append-only tables (poc_baselines, poc_metrics,
-- poc_exclusions, poc_decisions) deliberately receive no update/delete
-- grant — see the revokes above. metric_definitions receives select to
-- everyone and insert/update (never delete) gated by RLS to platform_admin.
-- ---------------------------------------------------------------------------

grant select on public.metric_definitions to authenticated;
grant insert, update on public.metric_definitions to authenticated;
grant select, insert, update on public.poc_benchmarks to authenticated;
grant select, insert, update, delete on public.poc_roles to authenticated;
grant select, insert, update on public.poc_participants to authenticated;
grant select, insert on public.poc_baselines to authenticated;
grant select, insert on public.poc_metrics to authenticated;
grant select, insert on public.poc_exclusions to authenticated;
grant select, insert, update on public.poc_results to authenticated;
grant select, insert on public.poc_decisions to authenticated;
