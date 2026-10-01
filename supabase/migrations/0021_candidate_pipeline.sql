-- 0021_candidate_pipeline.sql
-- docs/07-data-model.md §7.1 (`candidate_project_entries`,
-- `candidate_pipeline_events`, `candidate_consents`). Build Phase 5 brief
-- §"Pipeline stages" / §PRIVACY.
--
-- Defines public.can_access_candidate() — the row-level scoping helper every
-- candidate-* table needs — and only now, because it depends on
-- candidate_project_entries existing (same deferred-policy convention as
-- is_assigned_to_project() in 0012_project_assignments.sql). Retrofits the
-- recruiter and client_decision_maker policies deferred from 0018/0019/0020.

-- ---------------------------------------------------------------------------
-- candidate_pipeline_stage values, brief-exact:
-- Discovered, Eligibility Check, Scored, Quality Review, Outreach,
-- Shortlisted, Rejected, Withdrawn.
--
-- Deliberately NOT the same enum as packages/types' existing `PipelineStage`
-- ('sourced'|'gated'|'reviewed'|'shortlisted'|'submitted'|'rejected'), which
-- docs/07-data-model.md §7.1 defines for the not-yet-built
-- `candidate_role_matches` table (a candidate×job AI-scoring instance, out
-- of scope this phase per the brief: "Do not implement AI CV parsing or
-- match scoring yet"). This phase's stage tracks the CANDIDATE's overall
-- journey through a project, independent of any score — see
-- docs/build-phase-5-report.md for the full explanation of why these are
-- two intentionally separate concepts, not a redesign of the existing one.
-- ---------------------------------------------------------------------------

create table if not exists public.candidate_project_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  recruitment_project_id uuid not null references public.recruitment_projects (id) on delete cascade,
  job_id uuid references public.jobs (id) on delete set null,
  current_stage text not null default 'discovered'
    check (current_stage in (
      'discovered', 'eligibility_check', 'scored', 'quality_review',
      'outreach', 'shortlisted', 'rejected', 'withdrawn'
    )),
  -- Brief §PRIVACY: "Restrict client reviewers to shortlisted or explicitly
  -- shared candidates." client_visible defaults false; it is set true either
  -- explicitly by a recruiter/admin, or automatically once current_stage
  -- reaches 'shortlisted' (enforced in apps/web/lib/candidates/pipeline.ts,
  -- applied by the stage-transition server action — never by RLS, which
  -- cannot run application-level "also flip this other column" logic).
  client_visible boolean not null default false,
  added_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (candidate_id, recruitment_project_id)
);

comment on table public.candidate_project_entries is
  'Which project(s) a candidate is linked to, and their current pipeline stage there (docs/07-data-model.md §7.1). The queryable "current state"; candidate_pipeline_events below is the append-only history of how it got there.';

create index if not exists candidate_project_entries_candidate_id_idx
  on public.candidate_project_entries (candidate_id);
create index if not exists candidate_project_entries_project_id_idx
  on public.candidate_project_entries (recruitment_project_id, current_stage);

drop trigger if exists candidate_project_entries_set_updated_at on public.candidate_project_entries;
create trigger candidate_project_entries_set_updated_at
  before update on public.candidate_project_entries
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- can_access_candidate() — the single row-level scoping rule every
-- candidate-* table's recruiter/client_decision_maker policy uses.
--
--   agency_admin / read_only_reviewer / platform_admin : org-wide (already
--     granted directly in 0018-0020; repeated here so the function is a
--     complete, reusable single source of truth some tables — this one
--     included — rely on exclusively).
--   recruiter : candidates they sourced themselves (created_by), OR any
--     candidate with a candidate_project_entries row for a project they are
--     assigned to (public.is_assigned_to_project(), from 0012).
--   client_decision_maker : only a candidate with a candidate_project_entries
--     row that is BOTH client_visible = true AND for a project belonging to
--     their own client — brief §PRIVACY's "shortlisted or explicitly shared"
--     rule, enforced here rather than trusted to the application layer alone.
-- ---------------------------------------------------------------------------

create or replace function public.can_access_candidate(target_candidate uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.candidates c
    where c.id = target_candidate
      and (
        public.is_platform_admin()
        or public.has_org_role(
          c.organization_id,
          array['agency_admin', 'read_only_reviewer']::public.app_role[]
        )
        or (
          public.has_org_role(c.organization_id, array['recruiter']::public.app_role[])
          and (
            c.created_by = auth.uid()
            or exists (
              select 1
              from public.candidate_project_entries pe
              where pe.candidate_id = c.id
                and public.is_assigned_to_project(pe.recruitment_project_id)
            )
          )
        )
        or (
          public.has_org_role(c.organization_id, array['client_decision_maker']::public.app_role[])
          and exists (
            select 1
            from public.candidate_project_entries pe
            join public.recruitment_projects p on p.id = pe.recruitment_project_id
            join public.organization_memberships m
              on m.organization_id = p.organization_id
              and m.user_id = auth.uid()
              and m.status = 'active'
            where pe.candidate_id = c.id
              and pe.client_visible = true
              and p.client_id = m.client_id
          )
        )
      )
  );
$$;

comment on function public.can_access_candidate(uuid) is
  'Row-level candidate visibility: org-wide for admin/reviewer, assigned-project-or-self-sourced for recruiter, shortlisted-or-explicitly-shared-only for client_decision_maker (docs/build-phase-5-report.md, brief §PRIVACY).';

alter table public.candidate_project_entries enable row level security;

create policy candidate_project_entries_select_scoped
  on public.candidate_project_entries
  for select
  using (public.can_access_candidate(candidate_id));

create policy candidate_project_entries_write_admin_recruiter
  on public.candidate_project_entries
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

-- ---------------------------------------------------------------------------
-- candidate_pipeline_events — append-only stage-transition audit trail
-- (distinct from the compliance-grade audit_events, same relationship as
-- project_activity has to audit_events — docs/07-data-model.md §7.1). Never
-- client-visible: a client reviewer sees a candidate's current_stage via
-- candidate_project_entries, never the internal reasons/actors behind how
-- it got there.
-- ---------------------------------------------------------------------------

create table if not exists public.candidate_pipeline_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  recruitment_project_id uuid not null references public.recruitment_projects (id) on delete cascade,
  from_stage text,
  to_stage text not null
    check (to_stage in (
      'discovered', 'eligibility_check', 'scored', 'quality_review',
      'outreach', 'shortlisted', 'rejected', 'withdrawn'
    )),
  actor_id uuid references auth.users (id),
  reason text,
  created_at timestamptz not null default now()
);

comment on table public.candidate_pipeline_events is
  'Append-only stage-transition history (docs/07-data-model.md §7.1). Internal only — never exposed to client_decision_maker, unlike candidate_project_entries.current_stage.';

create index if not exists candidate_pipeline_events_candidate_id_idx
  on public.candidate_pipeline_events (candidate_id, created_at desc);
create index if not exists candidate_pipeline_events_project_id_idx
  on public.candidate_pipeline_events (recruitment_project_id, created_at desc);

alter table public.candidate_pipeline_events enable row level security;

create policy candidate_pipeline_events_select_internal
  on public.candidate_pipeline_events
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
  );

create policy candidate_pipeline_events_insert_internal
  on public.candidate_pipeline_events
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

revoke update, delete on public.candidate_pipeline_events from authenticated, anon;

-- ---------------------------------------------------------------------------
-- candidate_consents — consent status + deletion-request tracking (brief
-- §FUNCTIONAL REQUIREMENTS "Support archive and deletion-request status").
-- Never client-visible; not append-only (a consent/deletion-request record
-- is updated in place as its status changes — the *change itself* is what
-- audit_events captures, per the standard convention).
-- ---------------------------------------------------------------------------

create table if not exists public.candidate_consents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  candidate_id uuid not null unique references public.candidates (id) on delete cascade,
  consent_status text not null default 'unknown'
    check (consent_status in ('granted', 'withdrawn', 'unknown')),
  consent_recorded_at timestamptz,
  consent_recorded_by uuid references auth.users (id),
  deletion_requested boolean not null default false,
  deletion_requested_at timestamptz,
  deletion_requested_by uuid references auth.users (id),
  deletion_reason text,
  updated_at timestamptz not null default now(),
  constraint candidate_consents_deletion_fields_together check (
    deletion_requested = (deletion_requested_at is not null)
  )
);

comment on table public.candidate_consents is
  'Data-processing consent + deletion-request tracking, 1:1 with candidates (docs/07-data-model.md §7.1/§7.6). Recording deletion_requested=true does not itself erase data — see candidates.deleted_at comment (0018).';

drop trigger if exists candidate_consents_set_updated_at on public.candidate_consents;
create trigger candidate_consents_set_updated_at
  before update on public.candidate_consents
  for each row execute function public.set_updated_at();

alter table public.candidate_consents enable row level security;

create policy candidate_consents_select_internal
  on public.candidate_consents
  for select
  using (
    public.is_platform_admin()
    or public.has_org_role(
      organization_id,
      array['agency_admin', 'read_only_reviewer']::public.app_role[]
    )
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and public.can_access_candidate(candidate_id)
    )
  );

create policy candidate_consents_write_internal
  on public.candidate_consents
  for all
  using (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and public.can_access_candidate(candidate_id)
    )
  )
  with check (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and public.can_access_candidate(candidate_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Deferred recruiter + client_decision_maker policies (now that
-- can_access_candidate() exists) for every table created in 0018-0020.
-- Same append-only-migration convention as 0012.
-- ---------------------------------------------------------------------------

create policy candidates_select_scoped
  on public.candidates
  for select
  using (public.can_access_candidate(id));

create policy candidates_write_recruiter
  on public.candidates
  for all
  using (
    public.has_org_role(organization_id, array['recruiter']::public.app_role[])
    and public.can_access_candidate(id)
  )
  with check (
    public.has_org_role(organization_id, array['recruiter']::public.app_role[])
    and (created_by = auth.uid() or public.can_access_candidate(id))
  );

create policy candidate_profiles_select_scoped
  on public.candidate_profiles
  for select
  using (public.can_access_candidate(candidate_id));

create policy candidate_profiles_write_recruiter
  on public.candidate_profiles
  for all
  using (
    public.has_org_role(organization_id, array['recruiter']::public.app_role[])
    and public.can_access_candidate(candidate_id)
  )
  with check (
    public.has_org_role(organization_id, array['recruiter']::public.app_role[])
    and public.can_access_candidate(candidate_id)
  );

create policy candidate_contact_points_select_scoped
  on public.candidate_contact_points
  for select
  using (public.can_access_candidate(candidate_id));

create policy candidate_contact_points_write_recruiter
  on public.candidate_contact_points
  for all
  using (
    public.has_org_role(organization_id, array['recruiter']::public.app_role[])
    and public.can_access_candidate(candidate_id)
  )
  with check (
    public.has_org_role(organization_id, array['recruiter']::public.app_role[])
    and public.can_access_candidate(candidate_id)
  );

-- candidate_documents: agency_admin/recruiter(assigned-or-self-sourced) only
-- — no client_decision_maker policy, per docs/06-roles-permissions.md §6.2
-- (candidate_documents: client_decision_maker = none — see 0019's comment).
create policy candidate_documents_write_recruiter
  on public.candidate_documents
  for all
  using (
    public.has_org_role(organization_id, array['recruiter']::public.app_role[])
    and public.can_access_candidate(candidate_id)
  )
  with check (
    public.has_org_role(organization_id, array['recruiter']::public.app_role[])
    and public.can_access_candidate(candidate_id)
  );

create policy candidate_documents_select_recruiter
  on public.candidate_documents
  for select
  using (
    public.has_org_role(organization_id, array['recruiter']::public.app_role[])
    and public.can_access_candidate(candidate_id)
  );

do $$
declare
  t text;
begin
  foreach t in array array[
    'candidate_experiences', 'candidate_education', 'candidate_certifications',
    'candidate_skills', 'candidate_sources'
  ]
  loop
    -- No client_decision_maker policy on these detail tables (0020's
    -- comment) — only recruiter is deferred here.
    execute format(
      $p$create policy %I_write_recruiter
        on public.%I
        for all
        using (
          public.has_org_role(organization_id, array['recruiter']::public.app_role[])
          and public.can_access_candidate(candidate_id)
        )
        with check (
          public.has_org_role(organization_id, array['recruiter']::public.app_role[])
          and public.can_access_candidate(candidate_id)
        )$p$,
      t, t
    );
  end loop;
end
$$;
