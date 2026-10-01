-- 0028_human_review_shortlisting.sql
-- docs/07-data-model.md §7.1/§7.9-successor, docs/08-candidate-scoring.md
-- §8.10 (Build Phase 8 brief "Human Review and Shortlisting": "Implement
-- the controlled quality-review process that produces a maximum 2-3
-- candidate shortlist for client approval.").
--
-- WORKFLOW (brief): Candidate Evaluation -> Recruiter Quality Review ->
-- Verification Required or Approved -> Outreach Eligible -> Candidate
-- Interest Confirmed -> Proposed Shortlist -> Internal Approval ->
-- Client Review -> Accepted, Discuss or Rejected.
--
-- Extends two Build Phase 7 tables, then adds six new tables in dependency
-- order:
--
--   human_reviews.decision              -- + 'escalated', 'note_added'
--   candidate_role_matches.review_status -- + 'escalated'
--   verification_requests   -- candidate-level "Request verification"
--                               workflow entity (distinct from the
--                               existing PER-GATE verification_requested_*
--                               columns on mandatory_gate_results, which
--                               stay as-is: a verification_requests row is
--                               the trackable open/resolved workflow object
--                               a reviewer's "Request verification" decision
--                               creates; it may reference a specific gate or
--                               the candidate as a whole).
--   shortlists               -- one row per (job, in-progress-or-decided)
--                               shortlist. Mutable "current state" header;
--                               shortlist_versions below is where the
--                               scorecard_versions-style immutable-snapshot
--                               pattern actually lives.
--   shortlist_versions       -- immutable snapshot per submission-for-
--                               approval cycle (mirrors scorecard_versions,
--                               docs/07-data-model.md §7.1). Preserves
--                               "which candidates, at which evaluation
--                               version" for every version ever sent
--                               anywhere, never overwritten in place.
--   shortlist_candidates     -- candidates on ONE shortlist_versions row.
--                               Freezes matching_run_id/scorecard_version_id
--                               at add-time (brief: "preserve candidate
--                               evaluation version"). UNIQUE(version,
--                               candidate) prevents duplicates; a trigger
--                               enforces the size cap (brief: "default
--                               maximum of three... require an authorized
--                               override to exceed") and the mandatory-gate
--                               exclusion (brief: "never rank failed
--                               mandatory-gate candidates") — both are
--                               cross-row/cross-table rules a CHECK
--                               constraint cannot express alone.
--   client_decisions         -- append-only Accept/Discuss/Reject record
--                               against one shortlist_versions row (brief:
--                               "require rejection or discussion notes").
--   shortlist_activity       -- shortlist-scoped activity feed, mirroring
--                               project_activity's pattern (0013) exactly,
--                               plus a client_visible flag (brief: "Do not
--                               expose private recruiter notes to
--                               clients").
--
-- Also extends candidate_project_entries with a lightweight
-- "Candidate Interest Confirmed" tri-state (brief workflow step), since no
-- existing table tracks candidate interest and the pipeline-stage table is
-- the established home for candidate-journey state (docs/build-phase-5-
-- report.md).

-- ---------------------------------------------------------------------------
-- Extend existing enums (Build Phase 7 tables)
-- ---------------------------------------------------------------------------

alter table public.human_reviews drop constraint if exists human_reviews_decision_check;
alter table public.human_reviews
  add constraint human_reviews_decision_check
  check (decision in (
    'approved_for_outreach', 'rejected', 'requires_verification', 'gate_overridden',
    'escalated', 'note_added'
  ));

comment on column public.human_reviews.decision is
  'Reviewer decision (docs/08-candidate-scoring.md §8.10, Build Phase 8 brief §"Reviewer decisions"). note_added is a pure internal-notes entry: no eligibility/review_status effect, reason holds the note text.';

alter table public.candidate_role_matches drop constraint if exists candidate_role_matches_review_status_check;
alter table public.candidate_role_matches
  add constraint candidate_role_matches_review_status_check
  check (review_status in (
    'pending', 'approved_for_outreach', 'rejected', 'requires_verification', 'escalated'
  ));

-- ---------------------------------------------------------------------------
-- candidate_project_entries: "Candidate Interest Confirmed" workflow step
-- ---------------------------------------------------------------------------

alter table public.candidate_project_entries
  add column if not exists interest_status text not null default 'unknown'
    check (interest_status in ('unknown', 'interested', 'declined'));
alter table public.candidate_project_entries
  add column if not exists interest_confirmed_by uuid references auth.users (id);
alter table public.candidate_project_entries
  add column if not exists interest_confirmed_at timestamptz;
alter table public.candidate_project_entries
  add column if not exists interest_note text;

comment on column public.candidate_project_entries.interest_status is
  'Build Phase 8 brief workflow step "Candidate Interest Confirmed" — recorded by a recruiter from outreach response, never inferred by AI. unknown is the only value that permits building a shortlist entry (a declined candidate cannot be shortlisted; see shortlist_candidates trigger).';

-- ---------------------------------------------------------------------------
-- verification_requests
-- ---------------------------------------------------------------------------

create table if not exists public.verification_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  candidate_role_match_id uuid not null references public.candidate_role_matches (id) on delete cascade,
  human_review_id uuid references public.human_reviews (id) on delete set null,
  -- Optional: a request may be about one specific mandatory requirement's
  -- gate, or about the candidate's evaluation as a whole (null).
  requirement_id uuid references public.job_requirements (id) on delete set null,
  requested_by uuid not null references auth.users (id),
  request_note text not null check (char_length(btrim(request_note)) > 0),
  status text not null default 'open' check (status in ('open', 'resolved', 'cancelled')),
  resolved_by uuid references auth.users (id),
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now(),
  constraint verification_requests_resolution_requires_detail check (
    status = 'open' or (resolved_by is not null and resolved_at is not null)
  )
);

comment on table public.verification_requests is
  'Candidate-level "Request verification" workflow object (Build Phase 8 brief §"Reviewer decisions"/§UI "Verification-request workflow"). Distinct from mandatory_gate_results.verification_requested_* (per-gate flag set at gate-evaluation time) — this is the trackable open/resolved entity a reviewer''s decision creates and a follow-up action resolves.';

create index if not exists verification_requests_match_idx
  on public.verification_requests (candidate_role_match_id, status);

revoke delete on public.verification_requests from authenticated, anon;

-- ---------------------------------------------------------------------------
-- shortlists
-- ---------------------------------------------------------------------------

create table if not exists public.shortlists (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  recruitment_project_id uuid not null references public.recruitment_projects (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete restrict,
  -- Mirrors the brief's workflow tail exactly: Proposed Shortlist ->
  -- Internal Approval -> Client Review -> Accepted/Discuss/Rejected.
  -- 'draft' is the builder state before the first submission.
  status text not null default 'draft'
    check (status in (
      'draft', 'pending_internal_approval', 'internally_approved',
      'sent_to_client', 'accepted', 'discuss', 'rejected'
    )),
  -- Brief: "default maximum of three candidates; require an authorized
  -- override to exceed the limit". The override fields here are the
  -- AUTHORIZATION (who, why); the actual count enforcement is a trigger on
  -- shortlist_candidates below, since only it can see the current count.
  max_candidates int not null default 3 check (max_candidates > 0),
  override_max_candidates boolean not null default false,
  override_by uuid references auth.users (id),
  override_reason text,
  -- Set once the first shortlist_versions row exists; nullable FK added
  -- below via ALTER (shortlist_versions.shortlist_id references this table,
  -- so the reverse pointer cannot be part of the initial CREATE TABLE).
  current_version_id uuid,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shortlists_override_requires_reason check (
    override_max_candidates = false
    or (override_by is not null and override_reason is not null and char_length(btrim(override_reason)) > 0)
  )
);

comment on table public.shortlists is
  'One shortlist header per job (Build Phase 8 brief). Mutable "current state" (status, override authorization, pointer to the current version); shortlist_versions is the immutable-snapshot history.';

create index if not exists shortlists_job_idx on public.shortlists (job_id, status);
create index if not exists shortlists_project_idx on public.shortlists (recruitment_project_id);
create index if not exists shortlists_client_idx on public.shortlists (client_id, status);

drop trigger if exists shortlists_set_updated_at on public.shortlists;
create trigger shortlists_set_updated_at
  before update on public.shortlists
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- shortlist_versions
-- ---------------------------------------------------------------------------

create table if not exists public.shortlist_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  shortlist_id uuid not null references public.shortlists (id) on delete cascade,
  version_number int not null check (version_number > 0),
  -- Independent of shortlists.status: a version freezes at 'submitted' and
  -- is never edited again (docs' scorecard_versions pattern) — later
  -- lifecycle transitions (internal approval, sent to client) are recorded
  -- as timestamps below on the SAME row, not new versions, since the
  -- candidate set itself has not changed; a new version_number is only
  -- created when the candidate set changes after a 'discuss' or 'rejected'
  -- outcome and the recruiter rebuilds the shortlist.
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'internally_approved', 'sent_to_client', 'superseded')),
  submitted_by uuid references auth.users (id),
  submitted_at timestamptz,
  internally_approved_by uuid references auth.users (id),
  internally_approved_at timestamptz,
  sent_to_client_by uuid references auth.users (id),
  sent_to_client_at timestamptz,
  note text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (shortlist_id, version_number)
);

comment on table public.shortlist_versions is
  'Immutable snapshot per shortlist submission cycle (mirrors scorecard_versions, docs/07-data-model.md §7.1). shortlist_candidates rows belong to exactly one version, so a client decision or an internal-approval record always points at a fixed, unchangeable candidate set.';

create index if not exists shortlist_versions_shortlist_idx
  on public.shortlist_versions (shortlist_id, version_number desc);

alter table public.shortlists
  add constraint shortlists_current_version_fk
  foreign key (current_version_id) references public.shortlist_versions (id) on delete set null;

-- ---------------------------------------------------------------------------
-- shortlist_candidates
-- ---------------------------------------------------------------------------

create table if not exists public.shortlist_candidates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  shortlist_version_id uuid not null references public.shortlist_versions (id) on delete cascade,
  candidate_role_match_id uuid not null references public.candidate_role_matches (id) on delete restrict,
  candidate_id uuid not null references public.candidates (id) on delete restrict,
  -- Frozen at add-time (brief: "preserve candidate evaluation version") —
  -- these never follow a later re-score of the same candidate_role_match.
  matching_run_id uuid not null references public.matching_runs (id) on delete restrict,
  scorecard_version_id uuid not null references public.scorecard_versions (id) on delete restrict,
  rank int not null check (rank > 0),
  recruiter_note text,
  added_by uuid references auth.users (id),
  added_at timestamptz not null default now(),
  unique (shortlist_version_id, candidate_id),
  unique (shortlist_version_id, rank)
);

comment on table public.shortlist_candidates is
  'Candidates on one shortlist_versions row (Build Phase 8 brief). recruiter_note is internal-only (never returned to a client_decision_maker caller — enforced at the application layer, mirroring apps/web/lib/candidates/visibility.ts, since RLS is row- not column-scoped).';

create index if not exists shortlist_candidates_version_idx
  on public.shortlist_candidates (shortlist_version_id, rank);
create index if not exists shortlist_candidates_candidate_idx
  on public.shortlist_candidates (candidate_id);

-- Brief: "never rank failed mandatory-gate candidates" + "default maximum
-- of three... require an authorized override to exceed the limit" +
-- "prevent duplicate candidate inclusion" (the UNIQUE constraint above
-- covers duplicates; this trigger covers the two rules a CHECK cannot
-- express, since both require reading OTHER rows/tables).
create or replace function public.enforce_shortlist_candidate_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_eligibility text;
  v_match_org uuid;
  v_match_candidate uuid;
  v_shortlist_id uuid;
  v_max int;
  v_override boolean;
  v_current_count int;
begin
  select crm.eligibility, crm.organization_id, crm.candidate_id
    into v_eligibility, v_match_org, v_match_candidate
    from public.candidate_role_matches crm
    where crm.id = new.candidate_role_match_id;

  if v_eligibility is distinct from 'eligible' then
    raise exception 'shortlist_candidates: candidate_role_match % is not eligible (failed or unresolved mandatory gate) and cannot be shortlisted', new.candidate_role_match_id
      using errcode = '23514';
  end if;

  if v_match_org is distinct from new.organization_id then
    raise exception 'shortlist_candidates: organization_id must match the referenced candidate_role_match''s organization'
      using errcode = '23514';
  end if;

  if v_match_candidate is distinct from new.candidate_id then
    raise exception 'shortlist_candidates: candidate_id must match the referenced candidate_role_match''s candidate_id'
      using errcode = '23514';
  end if;

  select sv.shortlist_id into v_shortlist_id
    from public.shortlist_versions sv
    where sv.id = new.shortlist_version_id;

  select s.max_candidates, s.override_max_candidates into v_max, v_override
    from public.shortlists s
    where s.id = v_shortlist_id;

  select count(*) into v_current_count
    from public.shortlist_candidates sc
    where sc.shortlist_version_id = new.shortlist_version_id;

  -- v_current_count does not yet include NEW (BEFORE INSERT trigger), so
  -- the row being inserted is the (v_current_count + 1)th candidate.
  if not v_override and (v_current_count + 1) > v_max then
    raise exception 'shortlist_candidates: shortlist % already has the maximum % candidates; an authorized override is required to exceed it', v_shortlist_id, v_max
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists shortlist_candidates_enforce_rules on public.shortlist_candidates;
create trigger shortlist_candidates_enforce_rules
  before insert on public.shortlist_candidates
  for each row execute function public.enforce_shortlist_candidate_rules();

revoke update, delete on public.shortlist_candidates from authenticated, anon;

-- ---------------------------------------------------------------------------
-- client_decisions
-- ---------------------------------------------------------------------------

create table if not exists public.client_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  shortlist_id uuid not null references public.shortlists (id) on delete cascade,
  shortlist_version_id uuid not null references public.shortlist_versions (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  decided_by uuid not null references auth.users (id),
  decision text not null check (decision in ('accept', 'discuss', 'reject')),
  notes text,
  created_at timestamptz not null default now(),
  constraint client_decisions_notes_required_unless_accept check (
    decision = 'accept' or (notes is not null and char_length(btrim(notes)) > 0)
  )
);

comment on table public.client_decisions is
  'Append-only client Accept/Discuss/Reject record against one frozen shortlist_versions row (Build Phase 8 brief §"Client decisions"). shortlists.status is derived from the latest row here by the server action that inserts it, never computed ad hoc.';

create index if not exists client_decisions_shortlist_idx
  on public.client_decisions (shortlist_id, created_at desc);

revoke update, delete on public.client_decisions from authenticated, anon;

-- ---------------------------------------------------------------------------
-- shortlist_activity
-- ---------------------------------------------------------------------------

create table if not exists public.shortlist_activity (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  shortlist_id uuid not null references public.shortlists (id) on delete cascade,
  actor_id uuid references auth.users (id),
  action text not null,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  -- Brief: "Do not expose private recruiter notes to clients." Only rows
  -- with client_visible = true are ever readable by client_decision_maker
  -- (see RLS below) — internal recruiter reasoning, overrides, and notes
  -- default to false and stay agency-internal.
  client_visible boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.shortlist_activity is
  'Shortlist-scoped activity feed (mirrors project_activity, 0013_project_activity.sql). Not the compliance audit log — see audit_events for that.';

create index if not exists shortlist_activity_shortlist_idx
  on public.shortlist_activity (shortlist_id, created_at desc);

revoke update, delete on public.shortlist_activity from authenticated, anon;

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Platform Admin: full. Agency Admin: full. Read-Only Reviewer: read-only,
-- org-wide. Recruiter: scoped via can_access_candidate()/
-- is_assigned_to_project() on the underlying job/project/candidate, same as
-- every Phase 7 table. Client Decision-Maker: read-only, own client_id
-- only, AND only once a shortlist has actually reached the client (status
-- in 'sent_to_client'/'accepted'/'discuss'/'rejected' — never 'draft'/
-- 'pending_internal_approval'/'internally_approved'); may INSERT exactly
-- one decision-workflow row (client_decisions) while status = 'sent_to_client'.
-- Column-level redaction (no recruiter_note, no internal-only activity
-- rows) is enforced at the application layer per apps/web/lib/candidates/
-- visibility.ts's established pattern — RLS is row-level only.
-- ---------------------------------------------------------------------------

alter table public.verification_requests enable row level security;
alter table public.shortlists enable row level security;
alter table public.shortlist_versions enable row level security;
alter table public.shortlist_candidates enable row level security;
alter table public.client_decisions enable row level security;
alter table public.shortlist_activity enable row level security;

-- verification_requests: reached via candidate_role_matches, same shape as
-- human_reviews in 0027.
create policy verification_requests_select_scoped
  on public.verification_requests
  for select
  using (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin', 'read_only_reviewer']::public.app_role[])
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and exists (
        select 1 from public.candidate_role_matches crm
        where crm.id = verification_requests.candidate_role_match_id
          and public.can_access_candidate(crm.candidate_id)
          and public.is_assigned_to_project(crm.recruitment_project_id)
      )
    )
  );

create policy verification_requests_insert_scoped
  on public.verification_requests
  for insert
  with check (
    requested_by = auth.uid()
    and (
      public.is_platform_admin()
      or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
      or (
        public.has_org_role(organization_id, array['recruiter']::public.app_role[])
        and exists (
          select 1 from public.candidate_role_matches crm
          where crm.id = verification_requests.candidate_role_match_id
            and public.can_access_candidate(crm.candidate_id)
            and public.is_assigned_to_project(crm.recruitment_project_id)
        )
      )
    )
  );

create policy verification_requests_update_resolve
  on public.verification_requests
  for update
  using (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and exists (
        select 1 from public.candidate_role_matches crm
        where crm.id = verification_requests.candidate_role_match_id
          and public.can_access_candidate(crm.candidate_id)
          and public.is_assigned_to_project(crm.recruitment_project_id)
      )
    )
  )
  with check (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and exists (
        select 1 from public.candidate_role_matches crm
        where crm.id = verification_requests.candidate_role_match_id
          and public.can_access_candidate(crm.candidate_id)
          and public.is_assigned_to_project(crm.recruitment_project_id)
      )
    )
  );

-- shortlists
create policy shortlists_select_scoped
  on public.shortlists
  for select
  using (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin', 'read_only_reviewer']::public.app_role[])
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and public.is_assigned_to_project(recruitment_project_id)
    )
    or (
      public.has_org_role(organization_id, array['client_decision_maker']::public.app_role[])
      and status in ('sent_to_client', 'accepted', 'discuss', 'rejected')
      and client_id = (
        select m.client_id from public.organization_memberships m
        where m.user_id = auth.uid() and m.organization_id = shortlists.organization_id and m.status = 'active'
        limit 1
      )
    )
  );

create policy shortlists_write_internal
  on public.shortlists
  for all
  using (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and public.is_assigned_to_project(recruitment_project_id)
    )
  )
  with check (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and public.is_assigned_to_project(recruitment_project_id)
    )
  );

-- shortlist_versions: reached via parent shortlists row; client sees only
-- versions that have actually reached 'sent_to_client' or later, and only
-- on a shortlist already visible to them.
create policy shortlist_versions_select_scoped
  on public.shortlist_versions
  for select
  using (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin', 'read_only_reviewer']::public.app_role[])
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and exists (
        select 1 from public.shortlists s
        where s.id = shortlist_versions.shortlist_id and public.is_assigned_to_project(s.recruitment_project_id)
      )
    )
    or (
      public.has_org_role(organization_id, array['client_decision_maker']::public.app_role[])
      and shortlist_versions.status in ('sent_to_client', 'superseded')
      and exists (
        select 1 from public.shortlists s
        where s.id = shortlist_versions.shortlist_id
          and s.status in ('sent_to_client', 'accepted', 'discuss', 'rejected')
          and s.client_id = (
            select m.client_id from public.organization_memberships m
            where m.user_id = auth.uid() and m.organization_id = shortlist_versions.organization_id and m.status = 'active'
            limit 1
          )
      )
    )
  );

create policy shortlist_versions_write_internal
  on public.shortlist_versions
  for all
  using (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and exists (
        select 1 from public.shortlists s
        where s.id = shortlist_versions.shortlist_id and public.is_assigned_to_project(s.recruitment_project_id)
      )
    )
  )
  with check (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and exists (
        select 1 from public.shortlists s
        where s.id = shortlist_versions.shortlist_id and public.is_assigned_to_project(s.recruitment_project_id)
      )
    )
  );

-- shortlist_candidates: same shape, client read scope matches
-- shortlist_versions' (client-safe field redaction, i.e. no
-- recruiter_note, happens at the application layer, not here).
create policy shortlist_candidates_select_scoped
  on public.shortlist_candidates
  for select
  using (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin', 'read_only_reviewer']::public.app_role[])
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and exists (
        select 1 from public.shortlist_versions sv
        join public.shortlists s on s.id = sv.shortlist_id
        where sv.id = shortlist_candidates.shortlist_version_id and public.is_assigned_to_project(s.recruitment_project_id)
      )
    )
    or (
      public.has_org_role(organization_id, array['client_decision_maker']::public.app_role[])
      and exists (
        select 1 from public.shortlist_versions sv
        join public.shortlists s on s.id = sv.shortlist_id
        where sv.id = shortlist_candidates.shortlist_version_id
          and sv.status in ('sent_to_client', 'superseded')
          and s.status in ('sent_to_client', 'accepted', 'discuss', 'rejected')
          and s.client_id = (
            select m.client_id from public.organization_memberships m
            where m.user_id = auth.uid() and m.organization_id = shortlist_candidates.organization_id and m.status = 'active'
            limit 1
          )
      )
    )
  );

create policy shortlist_candidates_insert_scoped
  on public.shortlist_candidates
  for insert
  with check (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and exists (
        select 1 from public.shortlist_versions sv
        join public.shortlists s on s.id = sv.shortlist_id
        where sv.id = shortlist_candidates.shortlist_version_id and public.is_assigned_to_project(s.recruitment_project_id)
      )
    )
  );

-- client_decisions
create policy client_decisions_select_scoped
  on public.client_decisions
  for select
  using (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin', 'read_only_reviewer']::public.app_role[])
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and exists (
        select 1 from public.shortlists s
        where s.id = client_decisions.shortlist_id and public.is_assigned_to_project(s.recruitment_project_id)
      )
    )
    or (
      public.has_org_role(organization_id, array['client_decision_maker']::public.app_role[])
      and client_id = (
        select m.client_id from public.organization_memberships m
        where m.user_id = auth.uid() and m.organization_id = client_decisions.organization_id and m.status = 'active'
        limit 1
      )
    )
  );

create policy client_decisions_insert_client
  on public.client_decisions
  for insert
  with check (
    decided_by = auth.uid()
    and public.has_org_role(organization_id, array['client_decision_maker']::public.app_role[])
    and client_id = (
      select m.client_id from public.organization_memberships m
      where m.user_id = auth.uid() and m.organization_id = client_decisions.organization_id and m.status = 'active'
      limit 1
    )
    and exists (
      select 1 from public.shortlists s
      where s.id = client_decisions.shortlist_id
        and s.status = 'sent_to_client'
        and s.client_id = client_decisions.client_id
    )
  );

-- shortlist_activity: client only sees client_visible = true rows, and
-- only once the shortlist has actually reached them.
create policy shortlist_activity_select_scoped
  on public.shortlist_activity
  for select
  using (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin', 'read_only_reviewer']::public.app_role[])
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and exists (
        select 1 from public.shortlists s
        where s.id = shortlist_activity.shortlist_id and public.is_assigned_to_project(s.recruitment_project_id)
      )
    )
    or (
      public.has_org_role(organization_id, array['client_decision_maker']::public.app_role[])
      and shortlist_activity.client_visible = true
      and exists (
        select 1 from public.shortlists s
        where s.id = shortlist_activity.shortlist_id
          and s.status in ('sent_to_client', 'accepted', 'discuss', 'rejected')
          and s.client_id = (
            select m.client_id from public.organization_memberships m
            where m.user_id = auth.uid() and m.organization_id = shortlist_activity.organization_id and m.status = 'active'
            limit 1
          )
      )
    )
  );

create policy shortlist_activity_insert_scoped
  on public.shortlist_activity
  for insert
  with check (
    actor_id = auth.uid()
    and (
      public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
      or (
        public.has_org_role(organization_id, array['recruiter']::public.app_role[])
        and exists (
          select 1 from public.shortlists s
          where s.id = shortlist_activity.shortlist_id and public.is_assigned_to_project(s.recruitment_project_id)
        )
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Grants (roles created in 0001; RLS above is the real gate, these mirror
-- the existing table-privilege baseline established across every prior
-- migration).
-- ---------------------------------------------------------------------------

grant select, insert, update on public.verification_requests to authenticated;
grant select, insert on public.shortlists to authenticated;
grant update on public.shortlists to authenticated;
grant select, insert on public.shortlist_versions to authenticated;
grant update on public.shortlist_versions to authenticated;
grant select, insert on public.shortlist_candidates to authenticated;
grant select, insert on public.client_decisions to authenticated;
grant select, insert on public.shortlist_activity to authenticated;
