-- 0019_candidate_documents.sql
-- docs/07-data-model.md §7.1 (`candidate_documents`) + §7.5 (versioning
-- strategy, extended to candidates: "The same pattern now governs...").
-- Build Phase 5 brief §"CV document management".
--
-- Reuses document_uploads (supabase/migrations/0011_job_descriptions.sql),
-- which already anticipated a 'candidate_document' owner_type — file
-- checksum/MIME/size/private-path bookkeeping is centralized there rather
-- than duplicated here, per the project's "create reusable components
-- instead of duplicating" engineering rule. document_uploads' existing RLS
-- (admin write, admin/read-only-reviewer select) already applies to every
-- owner_type without a row here, since it does not filter by owner_type;
-- the recruiter/client policies deferred below in 0021 cover
-- candidate_documents' own row, which is what a screen actually queries.

create table if not exists public.candidate_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  document_upload_id uuid not null references public.document_uploads (id),
  doc_type text not null default 'cv'
    check (doc_type in ('cv', 'cover_letter', 'reference', 'other')),
  version_no integer not null default 1 check (version_no > 0),
  status text not null default 'active' check (status in ('active', 'superseded', 'rejected')),
  superseded_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (candidate_id, doc_type, version_no)
);

comment on table public.candidate_documents is
  'CV/reference-document versions for a candidate (docs/07-data-model.md §7.1/§7.5). Prior versions are retained (status=superseded), never deleted, so evidence citations from an old score remain resolvable — same pattern as job_descriptions.';

create index if not exists candidate_documents_candidate_id_idx
  on public.candidate_documents (candidate_id, doc_type, version_no desc);
create index if not exists candidate_documents_organization_id_idx
  on public.candidate_documents (organization_id);

alter table public.candidate_documents enable row level security;

create policy candidate_documents_select_agency_admin_readonly
  on public.candidate_documents
  for select
  using (
    public.is_platform_admin()
    or public.has_org_role(
      organization_id,
      array['agency_admin', 'read_only_reviewer']::public.app_role[]
    )
  );

create policy candidate_documents_write_agency_admin
  on public.candidate_documents
  for all
  using (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
  )
  with check (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
  );

-- Per docs/06-roles-permissions.md §6.2's permission matrix
-- (candidate_documents: client_decision_maker = none), a client reviewer
-- never gets a policy on this table at all, in 0021 or anywhere else — CV
-- files are never client-visible in this build, only what the profile/
-- evidence layer explicitly surfaces in a later phase.
