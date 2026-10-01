-- 0020_candidate_profile_details.sql
-- docs/07-data-model.md §7.1 (`candidate_experiences`, `candidate_education`,
-- `candidate_certifications`, `candidate_skills`, `candidate_sources`).
-- Build Phase 5 brief §DATABASE / §FUNCTIONAL REQUIREMENTS.
--
-- Every row in these tables is human-entered in this build phase (manual
-- form entry or CSV import) — never AI-extracted. The brief is explicit:
-- "Do not implement AI CV parsing ... yet." A future phase that adds AI CV
-- parsing will populate the same tables via the same shape, distinguished
-- by a `source` value here, not a schema change.

create table if not exists public.candidate_experiences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  company text not null check (char_length(btrim(company)) > 0),
  title text not null check (char_length(btrim(title)) > 0),
  location text,
  start_date date,
  end_date date,
  is_current boolean not null default false,
  description text,
  source text not null default 'manual' check (source in ('manual', 'csv_import')),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint candidate_experiences_date_order check (
    end_date is null or start_date is null or end_date >= start_date
  ),
  constraint candidate_experiences_current_has_no_end check (not is_current or end_date is null)
);

comment on table public.candidate_experiences is
  'Employment history line items, human-entered only in this build phase (docs/07-data-model.md §7.1).';

create index if not exists candidate_experiences_candidate_id_idx
  on public.candidate_experiences (candidate_id, start_date desc);

drop trigger if exists candidate_experiences_set_updated_at on public.candidate_experiences;
create trigger candidate_experiences_set_updated_at
  before update on public.candidate_experiences
  for each row execute function public.set_updated_at();

create table if not exists public.candidate_education (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  institution text not null check (char_length(btrim(institution)) > 0),
  degree text,
  field_of_study text,
  start_date date,
  end_date date,
  source text not null default 'manual' check (source in ('manual', 'csv_import')),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint candidate_education_date_order check (
    end_date is null or start_date is null or end_date >= start_date
  )
);

comment on table public.candidate_education is
  'Education line items, human-entered only in this build phase (docs/07-data-model.md §7.1).';

create index if not exists candidate_education_candidate_id_idx
  on public.candidate_education (candidate_id);

drop trigger if exists candidate_education_set_updated_at on public.candidate_education;
create trigger candidate_education_set_updated_at
  before update on public.candidate_education
  for each row execute function public.set_updated_at();

create table if not exists public.candidate_certifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  name text not null check (char_length(btrim(name)) > 0),
  issuing_body text,
  issued_date date,
  expires_date date,
  source text not null default 'manual' check (source in ('manual', 'csv_import')),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint candidate_certifications_date_order check (
    expires_date is null or issued_date is null or expires_date >= issued_date
  )
);

comment on table public.candidate_certifications is
  'Certifications/licenses, human-entered only in this build phase (docs/07-data-model.md §7.1).';

create index if not exists candidate_certifications_candidate_id_idx
  on public.candidate_certifications (candidate_id);

drop trigger if exists candidate_certifications_set_updated_at on public.candidate_certifications;
create trigger candidate_certifications_set_updated_at
  before update on public.candidate_certifications
  for each row execute function public.set_updated_at();

create table if not exists public.candidate_skills (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  skill_name text not null check (char_length(btrim(skill_name)) > 0),
  proficiency text check (proficiency in ('beginner', 'intermediate', 'advanced', 'expert')),
  years_experience numeric(4, 1) check (years_experience is null or years_experience >= 0),
  source text not null default 'manual' check (source in ('manual', 'csv_import')),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

comment on table public.candidate_skills is
  'Normalized skill tags, human-entered only in this build phase (docs/07-data-model.md §7.1). source will gain an "ai"/"verified" value once AI CV parsing exists — schema is already shaped for that, no migration needed then.';

create index if not exists candidate_skills_candidate_id_idx
  on public.candidate_skills (candidate_id);
create unique index if not exists candidate_skills_unique_per_candidate_idx
  on public.candidate_skills (candidate_id, lower(skill_name));

create table if not exists public.candidate_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  recruitment_project_id uuid references public.recruitment_projects (id) on delete set null,
  channel text not null
    check (channel in ('linkedin', 'referral', 'apollo', 'manual', 'csv_import', 'job_board', 'other')),
  source_detail text,
  sourced_by uuid references auth.users (id),
  sourced_at timestamptz not null default now()
);

comment on table public.candidate_sources is
  'Where/how a candidate entered the pipeline (docs/07-data-model.md §7.1). recruitment_project_id is nullable — a candidate can be sourced generally, before being linked to any project via candidate_project_entries.';

create index if not exists candidate_sources_candidate_id_idx
  on public.candidate_sources (candidate_id, sourced_at desc);

-- ---------------------------------------------------------------------------
-- RLS: agency_admin/read_only_reviewer org-wide for now, on every table in
-- this migration. Recruiter (assigned-project-or-self-sourced) and
-- client_decision_maker (none — these detail tables are never client-
-- visible; the profile summary/notes surfaced to a client reviewer live on
-- candidate_profiles.client_visible_notes instead) policies are deferred to
-- 0021_candidate_pipeline.sql, same convention as 0009 → 0012.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'candidate_experiences', 'candidate_education', 'candidate_certifications',
    'candidate_skills', 'candidate_sources'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format(
      $p$create policy %I_select_agency_admin_readonly
        on public.%I
        for select
        using (
          public.is_platform_admin()
          or public.has_org_role(
            organization_id,
            array['agency_admin', 'read_only_reviewer']::public.app_role[]
          )
        )$p$,
      t, t
    );

    execute format(
      $p$create policy %I_write_agency_admin
        on public.%I
        for all
        using (
          public.is_platform_admin()
          or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
        )
        with check (
          public.is_platform_admin()
          or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
        )$p$,
      t, t
    );
  end loop;
end
$$;
