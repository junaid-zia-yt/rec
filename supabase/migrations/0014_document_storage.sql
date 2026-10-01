-- 0014_document_storage.sql
-- Private Storage bucket for job-description and (later) candidate-document
-- originals. Build Phase 3 brief §"File security". No public bucket, no
-- public URLs — every read goes through a short-lived signed URL minted
-- server-side (apps/web/lib/files/storage.ts), so these policies exist only
-- to gate direct Storage API access (upload, and the signed-URL mint step
-- itself, which runs under the caller's own session, not the service role).
--
-- Path convention (enforced by apps/web/lib/files/storage.ts, not just
-- documented here): <organization_id>/<owner_type>/<owner_id>/<uuid>-<filename>
-- so `(storage.foldername(name))[1]` is always the owning organization id
-- and RLS can check tenancy without a join back to an app table.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,
  15728640, -- 15 MB — comfortably above a typical CV/JD PDF or DOCX, per apps/web/lib/files/validate.ts's own (stricter, format-specific) limits
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Agency Admin/Recruiter may upload into their own org's folder.
create policy documents_insert_own_org
  on storage.objects
  for insert
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_org_id()::text
    and public.has_org_role(
      public.current_org_id(),
      array['agency_admin', 'recruiter']::public.app_role[]
    )
  );

-- Read access mirrors document_uploads' application-level RLS: agency_admin,
-- recruiter and read_only_reviewer may read their own org's folder. Signed
-- URLs are minted server-side under the caller's session, so this policy is
-- also what gates that mint step, not just a hypothetical direct-download
-- attempt.
create policy documents_select_own_org
  on storage.objects
  for select
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_org_id()::text
    and public.has_org_role(
      public.current_org_id(),
      array['agency_admin', 'recruiter', 'read_only_reviewer']::public.app_role[]
    )
  );

-- No update/delete policy: a re-upload creates a new versioned object and
-- document_uploads row (status: superseded on the old one) rather than
-- mutating or removing the original, per docs/07-data-model.md §7.5/§7.6.

comment on column public.audit_events.action is
  'Verb-first action name. Build Phase 2: auth.sign_in, auth.sign_in_failed, auth.sign_out, auth.password_reset_requested, auth.password_updated, invitation.created, invitation.accepted, membership.role_changed, membership.disabled. Build Phase 3 adds: client.created, client.updated, client.archived, project.created, project.updated, project.archived, project.assignment_changed, job.created, job.updated, job_description.uploaded, job_description.superseded, document.rejected.';
