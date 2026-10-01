-- 0011_job_descriptions.sql
-- docs/07-data-model.md §7.1 (`job_descriptions`) + §7.5 (document
-- versioning strategy). Build Phase 3 brief §"Job-description intake".
--
-- Original file and extracted plain text are stored SEPARATELY per the
-- brief: `file_storage_path` points at the private Storage object (the
-- untouched original — never parsed or mutated), `raw_text` holds either
-- the pasted text or, for an uploaded file, text extracted by a step
-- outside this migration. No AI extraction happens in this build phase
-- (Build Phase 3 brief: "Do not implement AI extraction yet") — raw_text
-- for an upload is populated by a deterministic text-layer extraction only,
-- never an LLM, and may be null until that step runs.
--
-- Also defines document_uploads: the shared, polymorphic file-metadata
-- table used by job_descriptions today and candidate_documents later
-- (docs/07-data-model.md §7.1), so file-security bookkeeping (checksum,
-- MIME, size, private path) is centralized in one place.

create table if not exists public.job_descriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  source text not null check (source in ('pasted', 'uploaded_pdf', 'uploaded_docx')),
  raw_text text,
  file_storage_path text,
  file_name text,
  file_mime_type text,
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes >= 0),
  file_checksum_sha256 text,
  version_no integer not null default 1 check (version_no > 0),
  status text not null default 'draft' check (status in ('draft', 'parsed', 'reviewed')),
  superseded_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_descriptions_has_content check (
    raw_text is not null or file_storage_path is not null
  )
);

comment on table public.job_descriptions is
  'Uploaded/pasted JD, one row per version (docs/07-data-model.md §7.1/§7.5). Prior versions are retained (superseded_at set), never deleted, so evidence citations stay resolvable.';

create index if not exists job_descriptions_job_id_idx
  on public.job_descriptions (job_id, version_no desc);

drop trigger if exists job_descriptions_set_updated_at on public.job_descriptions;
create trigger job_descriptions_set_updated_at
  before update on public.job_descriptions
  for each row execute function public.set_updated_at();

alter table public.job_descriptions enable row level security;

create policy job_descriptions_select_agency_admin_readonly
  on public.job_descriptions
  for select
  using (
    public.is_platform_admin()
    or public.has_org_role(
      organization_id,
      array['agency_admin', 'read_only_reviewer']::public.app_role[]
    )
  );

create policy job_descriptions_write_agency_admin
  on public.job_descriptions
  for all
  using (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
  )
  with check (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
  );

create policy job_descriptions_select_client_decision_maker
  on public.job_descriptions
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
      where j.id = job_descriptions.job_id
        and p.client_id = m.client_id
    )
  );

-- ---------------------------------------------------------------------------
-- document_uploads — shared file-security bookkeeping. Only approved MIME
-- types and extensions ever reach this table (enforced in the server action
-- before any Storage write — apps/web/lib/files/validate.ts — RLS cannot
-- validate a file's byte content, only gate rows). Executable content types
-- (application/x-msdownload, etc.) are rejected by that same validator, not
-- by a database check, since the set of dangerous MIME/extension pairs
-- changes more often than a migration should.
-- ---------------------------------------------------------------------------

create table if not exists public.document_uploads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  owner_type text not null check (owner_type in ('job_description', 'candidate_document')),
  owner_id uuid not null,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  checksum_sha256 text not null,
  status text not null default 'active' check (status in ('active', 'superseded', 'rejected')),
  uploaded_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

comment on table public.document_uploads is
  'Polymorphic file-metadata record (docs/07-data-model.md §7.1). storage_path is a private Storage object path, never publicly listable — access is always via a short-lived signed URL (apps/web/lib/files/storage.ts).';

create index if not exists document_uploads_owner_idx
  on public.document_uploads (owner_type, owner_id);
create index if not exists document_uploads_organization_id_idx
  on public.document_uploads (organization_id);

alter table public.document_uploads enable row level security;

create policy document_uploads_select_agency_admin_readonly
  on public.document_uploads
  for select
  using (
    public.is_platform_admin()
    or public.has_org_role(
      organization_id,
      array['agency_admin', 'read_only_reviewer']::public.app_role[]
    )
  );

create policy document_uploads_write_agency_admin
  on public.document_uploads
  for all
  using (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
  )
  with check (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
  );
