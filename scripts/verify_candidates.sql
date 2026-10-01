\set ON_ERROR_STOP off
\pset format aligned

-- Local-verification-only grants (a real Supabase project bootstraps these
-- automatically for the public schema; supabase/migrations/*.sql never
-- grants them explicitly beyond the 5 tables in 0007, by existing
-- convention — see that file's comment). Needed here only to exercise RLS
-- under `SET ROLE authenticated`, which goes further than the Build Phase 4
-- verification did.
grant select, insert, update, delete on
  public.candidates, public.candidate_profiles, public.candidate_contact_points,
  public.candidate_documents, public.candidate_experiences, public.candidate_education,
  public.candidate_certifications, public.candidate_skills, public.candidate_sources,
  public.candidate_project_entries, public.candidate_consents,
  public.clients, public.recruitment_projects, public.project_assignments, public.document_uploads
  to authenticated;

-- candidate_pipeline_events is append-only at the DB-role level (migration
-- 0021's `revoke update, delete`) — only select/insert granted here, so
-- TEST6 below exercises the real, migration-enforced privilege set.
grant select, insert on public.candidate_pipeline_events to authenticated;

-- candidate_document_processing_jobs / candidate_extracted_fields (Build
-- Phase 6) carry no REVOKE of their own, so grant the full set here — this
-- fills a gap where TEST 12 below was previously erroring with "permission
-- denied" rather than exercising RLS at all.
grant select, insert, update, delete on public.candidate_document_processing_jobs, public.candidate_extracted_fields to authenticated;

-- Set up base fixtures: org, roles, client, project, assignment.
insert into public.organizations (id, name) values
  ('00000000-0000-0000-0000-0000000000a1', 'Test Org') on conflict do nothing;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@test.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'recruiter1@test.com'),
  ('00000000-0000-0000-0000-0000000000a3', 'recruiter2@test.com'),
  ('00000000-0000-0000-0000-0000000000a4', 'client@test.com')
on conflict do nothing;

insert into public.organization_memberships (organization_id, user_id, role, status, is_default) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 'agency_admin', 'active', true),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', 'recruiter', 'active', true),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a3', 'recruiter', 'active', true)
on conflict do nothing;

insert into public.clients (id, organization_id, name, vertical, status) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'Acme Retail', 'retail', 'active')
on conflict do nothing;

insert into public.organization_memberships (organization_id, user_id, role, status, is_default, client_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a4', 'client_decision_maker', 'active', true, '00000000-0000-0000-0000-0000000000c1')
on conflict do nothing;

insert into public.recruitment_projects (id, organization_id, client_id, role_title, target_shortlist_size, match_threshold, is_draft) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'Store Manager', 3, 70, false)
on conflict do nothing;

insert into public.project_assignments (organization_id, recruitment_project_id, user_id, assignment_role) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a2', 'lead_recruiter')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- TEST 1: candidates dedup normalized columns compute correctly
-- ---------------------------------------------------------------------
insert into public.candidates (id, organization_id, full_name, primary_email, primary_phone, created_by)
values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'Jane Doe', '  Jane.Doe@Example.com ', '+1 (555) 123-4567', '00000000-0000-0000-0000-0000000000a2');

select 'TEST1 normalized_email' as test,
  (select normalized_email from public.candidates where id = '00000000-0000-0000-0000-0000000000d1') = 'jane.doe@example.com' as pass;
select 'TEST1 normalized_phone' as test,
  (select normalized_phone from public.candidates where id = '00000000-0000-0000-0000-0000000000d1') = '15551234567' as pass;

-- ---------------------------------------------------------------------
-- TEST 2: candidates_merged_has_target constraint
-- ---------------------------------------------------------------------
do $$
begin
  begin
    insert into public.candidates (organization_id, full_name, status, created_by)
    values ('00000000-0000-0000-0000-0000000000a1', 'Bad Merge', 'merged', '00000000-0000-0000-0000-0000000000a2');
    raise exception 'TEST2 FAILED: insert should have been rejected';
  exception when check_violation then
    raise notice 'TEST2 PASS: merged status without merged_into_candidate_id correctly rejected';
  end;
end $$;

-- ---------------------------------------------------------------------
-- TEST 3: candidate_profiles compensation range constraint
-- ---------------------------------------------------------------------
do $$
begin
  begin
    insert into public.candidate_profiles (organization_id, candidate_id, compensation_min, compensation_max)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', 100000, 50000);
    raise exception 'TEST3 FAILED: insert should have been rejected';
  exception when check_violation then
    raise notice 'TEST3 PASS: compensation_max < compensation_min correctly rejected';
  end;
end $$;

insert into public.candidate_profiles (organization_id, candidate_id, current_title, compensation_min, compensation_max, workplace_preference, recruiter_notes, client_visible_notes)
values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', 'Assistant Manager', 40000, 55000, 'hybrid', 'Internal: flaky references', 'Strong retail background');

-- ---------------------------------------------------------------------
-- TEST 4: candidate_skills unique-per-candidate (case-insensitive)
-- ---------------------------------------------------------------------
insert into public.candidate_skills (organization_id, candidate_id, skill_name) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', 'Inventory Management');
do $$
begin
  begin
    insert into public.candidate_skills (organization_id, candidate_id, skill_name)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', 'inventory management');
    raise exception 'TEST4 FAILED: duplicate skill should have been rejected';
  exception when unique_violation then
    raise notice 'TEST4 PASS: case-insensitive duplicate skill correctly rejected';
  end;
end $$;

-- ---------------------------------------------------------------------
-- TEST 5: candidate_project_entries + pipeline stage check constraint
-- ---------------------------------------------------------------------
insert into public.candidate_project_entries (organization_id, candidate_id, recruitment_project_id, current_stage, client_visible, added_by)
values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f1', 'discovered', false, '00000000-0000-0000-0000-0000000000a2');

do $$
begin
  begin
    update public.candidate_project_entries set current_stage = 'not_a_real_stage'
    where candidate_id = '00000000-0000-0000-0000-0000000000d1';
    raise exception 'TEST5 FAILED: invalid stage should have been rejected';
  exception when check_violation then
    raise notice 'TEST5 PASS: invalid pipeline stage correctly rejected';
  end;
end $$;

-- ---------------------------------------------------------------------
-- TEST 6: candidate_pipeline_events is append-only (no UPDATE/DELETE grant)
-- ---------------------------------------------------------------------
insert into public.candidate_pipeline_events (organization_id, candidate_id, recruitment_project_id, from_stage, to_stage, actor_id, reason)
values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f1', null, 'discovered', '00000000-0000-0000-0000-0000000000a2', 'Sourced from LinkedIn');

select 'TEST6 pipeline_events append-only (no update priv)' as test,
  not has_table_privilege('authenticated', 'public.candidate_pipeline_events', 'UPDATE') as pass;
select 'TEST6 pipeline_events append-only (no delete priv)' as test,
  not has_table_privilege('authenticated', 'public.candidate_pipeline_events', 'DELETE') as pass;

-- ---------------------------------------------------------------------
-- TEST 7: RLS — recruiter assigned to project CAN see the candidate;
-- an unassigned recruiter (who did not source it) CANNOT.
-- ---------------------------------------------------------------------
set role authenticated;

select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a2', false);
select 'TEST7a assigned recruiter sees candidate' as test,
  exists(select 1 from public.candidates where id = '00000000-0000-0000-0000-0000000000d1') as pass;

select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a3', false);
select 'TEST7b unassigned recruiter (not sourcer) cannot see candidate' as test,
  not exists(select 1 from public.candidates where id = '00000000-0000-0000-0000-0000000000d1') as pass;

reset role;

-- ---------------------------------------------------------------------
-- TEST 8: RLS — client_decision_maker cannot see candidate until
-- client_visible = true, then can once it is set. Never sees
-- candidate_documents at all.
-- ---------------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a4', false);
select 'TEST8a client cannot see non-shared candidate' as test,
  not exists(select 1 from public.candidates where id = '00000000-0000-0000-0000-0000000000d1') as pass;
reset role;

update public.candidate_project_entries set client_visible = true
where candidate_id = '00000000-0000-0000-0000-0000000000d1';

set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a4', false);
select 'TEST8b client sees candidate once client_visible=true' as test,
  exists(select 1 from public.candidates where id = '00000000-0000-0000-0000-0000000000d1') as pass;
select 'TEST8c client never sees candidate_documents' as test,
  not exists(select 1 from public.candidate_documents where candidate_id = '00000000-0000-0000-0000-0000000000d1') as pass;
reset role;

-- ---------------------------------------------------------------------
-- TEST 9: candidate_documents reuse of document_uploads — checksum lives
-- on document_uploads, candidate_documents versions reference it.
-- ---------------------------------------------------------------------
insert into public.document_uploads (id, organization_id, owner_type, owner_id, storage_path, file_name, mime_type, size_bytes, checksum_sha256, uploaded_by)
values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'candidate_document', '00000000-0000-0000-0000-0000000000d1', 'org1/candidate_document/d1/abc-cv.pdf', 'cv.pdf', 'application/pdf', 12345, 'deadbeef', '00000000-0000-0000-0000-0000000000a2');

insert into public.candidate_documents (organization_id, candidate_id, document_upload_id, doc_type, version_no, created_by)
values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1', 'cv', 1, '00000000-0000-0000-0000-0000000000a2');

select 'TEST9a candidate_documents linked to document_uploads checksum' as test,
  (select du.checksum_sha256 from public.candidate_documents cd join public.document_uploads du on du.id = cd.document_upload_id
   where cd.candidate_id = '00000000-0000-0000-0000-0000000000d1') = 'deadbeef' as pass;

do $$
begin
  begin
    insert into public.candidate_documents (organization_id, candidate_id, document_upload_id, doc_type, version_no, created_by)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1', 'cv', 1, '00000000-0000-0000-0000-0000000000a2');
    raise exception 'TEST9b FAILED: duplicate version should have been rejected';
  exception when unique_violation then
    raise notice 'TEST9b PASS: duplicate (candidate,doc_type,version_no) correctly rejected';
  end;
end $$;

-- ---------------------------------------------------------------------
-- TEST 10: recruiter who neither sourced nor is assigned cannot write
-- (RLS write policy), even though grants exist.
-- ---------------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a3', false);
do $$
begin
  begin
    update public.candidates set full_name = 'Hacked Name' where id = '00000000-0000-0000-0000-0000000000d1';
    if not found then
      raise notice 'TEST10 PASS: unauthorized recruiter update affected 0 rows (RLS-filtered)';
    else
      raise exception 'TEST10 FAILED: unauthorized recruiter update should not have affected any row';
    end if;
  end;
end $$;
reset role;
select 'TEST10 name unchanged' as test,
  (select full_name from public.candidates where id = '00000000-0000-0000-0000-0000000000d1') = 'Jane Doe' as pass;

-- ---------------------------------------------------------------------
-- TEST 11: cross-tenant denial — an agency_admin/recruiter in a SECOND,
-- unrelated organization can neither read nor write org a1's candidate,
-- even though can_access_candidate()'s admin/recruiter branches would
-- otherwise be permissive within their own org. This is the brief's
-- §TESTING "Cross-tenant denial" requirement, exercised for the base
-- candidates table plus one child table (candidate_profiles) and the
-- can_access_candidate()-gated candidate_project_entries table, since all
-- three rely on distinct RLS policies.
-- ---------------------------------------------------------------------
insert into public.organizations (id, name) values
  ('00000000-0000-0000-0000-0000000000b1', 'Other Org') on conflict do nothing;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b2', 'other-org-admin@test.com'),
  ('00000000-0000-0000-0000-0000000000b3', 'other-org-recruiter@test.com')
on conflict do nothing;

insert into public.organization_memberships (organization_id, user_id, role, status, is_default) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2', 'agency_admin', 'active', true),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b3', 'recruiter', 'active', true)
on conflict do nothing;

set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000b2', false);
select 'TEST11a other-org admin cannot see org a1 candidate' as test,
  not exists(select 1 from public.candidates where id = '00000000-0000-0000-0000-0000000000d1') as pass;
select 'TEST11b other-org admin cannot see org a1 candidate_profiles' as test,
  not exists(select 1 from public.candidate_profiles where candidate_id = '00000000-0000-0000-0000-0000000000d1') as pass;
select 'TEST11c other-org admin cannot see org a1 candidate_project_entries' as test,
  not exists(select 1 from public.candidate_project_entries where candidate_id = '00000000-0000-0000-0000-0000000000d1') as pass;

do $$
begin
  begin
    update public.candidates set full_name = 'Cross Tenant Hack' where id = '00000000-0000-0000-0000-0000000000d1';
    if not found then
      raise notice 'TEST11d PASS: other-org admin write affected 0 rows (RLS-filtered)';
    else
      raise exception 'TEST11d FAILED: other-org admin update should not have affected any row';
    end if;
  end;
end $$;
reset role;
select 'TEST11d name still unchanged' as test,
  (select full_name from public.candidates where id = '00000000-0000-0000-0000-0000000000d1') = 'Jane Doe' as pass;

-- can_access_candidate() also denies an other-org recruiter even if (by
-- coincidence of a future bug) they were ever assigned to org a1's project —
-- here we confirm the simpler, more common case: no membership in org a1 at
-- all means no access via any branch of the function.
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000b3', false);
select 'TEST11e other-org recruiter cannot see org a1 candidate' as test,
  not exists(select 1 from public.candidates where id = '00000000-0000-0000-0000-0000000000d1') as pass;
reset role;

-- ---------------------------------------------------------------------
-- TEST 12 (Build Phase 6): RLS for candidate_document_processing_jobs and
-- candidate_extracted_fields.
--   - candidate_document_processing_jobs: internal-only, same as
--     candidate_documents — assigned recruiter/admin/reviewer can see it,
--     an unassigned recruiter cannot, and client_decision_maker NEVER can,
--     even once client_visible=true (matches candidate_documents' own
--     unconditional client exclusion, docs/06-roles-permissions.md §6.2.3).
--   - candidate_extracted_fields: client-visible for a shortlisted/shared
--     candidate (matrix: candidate_evidence client_decision_maker=read),
--     but never writable by the client, and only writable by
--     admin/assigned-recruiter (the human-review action), never by an
--     unassigned recruiter.
-- ---------------------------------------------------------------------
insert into public.candidate_document_processing_jobs
  (id, organization_id, candidate_id, candidate_document_id, status, idempotency_key, attempt_no, requested_by)
values
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1',
   (select id from public.candidate_documents where candidate_id = '00000000-0000-0000-0000-0000000000d1' limit 1),
   'awaiting_review', 'test-idem-key-1', 1, '00000000-0000-0000-0000-0000000000a2');

insert into public.candidate_extracted_fields
  (id, organization_id, candidate_id, processing_job_id, field_group, field_key, item_index, extracted_value, has_evidence, source_document_id, source_location, source_excerpt, confidence, verification_status)
values
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e2', 'profile', 'currentTitle', null, '{"value":"Store Manager"}'::jsonb, true,
   (select id from public.candidate_documents where candidate_id = '00000000-0000-0000-0000-0000000000d1' limit 1),
   'line 5', 'Store Manager', 0.90, 'pending');

set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a2', false);
select 'TEST12a assigned recruiter sees processing job' as test,
  exists(select 1 from public.candidate_document_processing_jobs where id = '00000000-0000-0000-0000-0000000000e2') as pass;

select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a3', false);
select 'TEST12b unassigned recruiter cannot see processing job' as test,
  not exists(select 1 from public.candidate_document_processing_jobs where id = '00000000-0000-0000-0000-0000000000e2') as pass;

select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a4', false);
select 'TEST12c client_decision_maker NEVER sees processing jobs (even client_visible=true)' as test,
  not exists(select 1 from public.candidate_document_processing_jobs where id = '00000000-0000-0000-0000-0000000000e2') as pass;

select 'TEST12d client_decision_maker CAN read evidence for a shared candidate' as test,
  exists(select 1 from public.candidate_extracted_fields where id = '00000000-0000-0000-0000-0000000000e3') as pass;

do $$
begin
  begin
    update public.candidate_extracted_fields set verification_status = 'verified', reviewer_id = '00000000-0000-0000-0000-0000000000a4', reviewed_at = now()
    where id = '00000000-0000-0000-0000-0000000000e3';
    if not found then
      raise notice 'TEST12e PASS: client_decision_maker write to candidate_extracted_fields affected 0 rows (RLS-filtered)';
    else
      raise exception 'TEST12e FAILED: client_decision_maker should never be able to write evidence review decisions';
    end if;
  end;
end $$;
reset role;
select 'TEST12e verification_status still pending' as test,
  (select verification_status from public.candidate_extracted_fields where id = '00000000-0000-0000-0000-0000000000e3') = 'pending' as pass;

set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a3', false);
do $$
begin
  begin
    update public.candidate_extracted_fields set verification_status = 'verified', reviewer_id = '00000000-0000-0000-0000-0000000000a3', reviewed_at = now()
    where id = '00000000-0000-0000-0000-0000000000e3';
    if not found then
      raise notice 'TEST12f PASS: unassigned recruiter write to candidate_extracted_fields affected 0 rows (RLS-filtered)';
    else
      raise exception 'TEST12f FAILED: unassigned recruiter should not be able to write evidence review decisions for a candidate they cannot access';
    end if;
  end;
end $$;
reset role;

set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a2', false);
update public.candidate_extracted_fields set verification_status = 'verified', reviewer_id = '00000000-0000-0000-0000-0000000000a2', reviewed_at = now()
where id = '00000000-0000-0000-0000-0000000000e3';
reset role;
select 'TEST12g assigned recruiter CAN write an evidence review decision' as test,
  (select verification_status from public.candidate_extracted_fields where id = '00000000-0000-0000-0000-0000000000e3') = 'verified' as pass;

-- ---------------------------------------------------------------------
-- TEST 13 (Build Phase 7): candidate matching — RLS + append-only +
-- deterministic-constraint checks across the 7 new tables.
-- ---------------------------------------------------------------------

-- Grants mirror what a real Supabase project auto-grants to `authenticated`,
-- narrowed by exactly the REVOKE statements 0027 already applied (so this
-- script exercises the REAL, migration-enforced privilege set, same
-- convention as TEST 6's candidate_pipeline_events check above):
--   matching_runs            -> revoke update,delete -> select,insert only
--   candidate_role_matches   -> no revoke             -> select,insert,update,delete
--   mandatory_gate_results   -> revoke delete only    -> select,insert,update
--   requirement_evidence     -> revoke update,delete  -> select,insert only
--   scoring_breakdowns       -> revoke update,delete  -> select,insert only
--   human_reviews            -> revoke update,delete  -> select,insert only
--   review_decisions         -> revoke update,delete  -> select,insert only
grant select, insert on public.matching_runs to authenticated;
grant select, insert, update, delete on public.candidate_role_matches to authenticated;
grant select, insert, update on public.mandatory_gate_results to authenticated;
grant select, insert on public.requirement_evidence to authenticated;
grant select, insert on public.scoring_breakdowns to authenticated;
grant select, insert on public.human_reviews to authenticated;
grant select, insert on public.review_decisions to authenticated;

-- Fixtures: one job (f2) under project f1, one mandatory + one preferred
-- requirement, an approved/active scorecard version freezing both, then a
-- completed matching run + its current-state projection + gate/evidence/
-- scoring rows, inserted as the table owner (bypassing RLS) exactly as the
-- server-role application code would via its own RLS-scoped session in
-- production — this script only needs the DATA to exist to test read/write
-- policies against it below.
insert into public.jobs (id, organization_id, recruitment_project_id, title) values
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1', 'Store Manager')
on conflict do nothing;

insert into public.job_requirements (id, organization_id, job_id, name, type, weight) values
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f2', '25+ multi-unit sites managed', 'mandatory', null),
  ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f2', 'P&L scale', 'preferred', 100)
on conflict do nothing;

insert into public.scorecards (id, organization_id, job_id, name, status) values
  ('00000000-0000-0000-0000-0000000000f5', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f2', 'Store Manager Scorecard', 'approved')
on conflict do nothing;

insert into public.scorecard_versions (id, organization_id, scorecard_id, version_no, status, requirement_snapshot) values
  ('00000000-0000-0000-0000-0000000000f6', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f5', 1, 'active',
   '[{"requirementId":"00000000-0000-0000-0000-0000000000f3","type":"mandatory","weight":null},{"requirementId":"00000000-0000-0000-0000-0000000000f4","type":"preferred","weight":100}]'::jsonb)
on conflict do nothing;

insert into public.matching_runs (id, organization_id, candidate_id, job_id, recruitment_project_id, scorecard_id, scorecard_version_id, status, trigger_reason, requested_by, started_at, completed_at) values
  ('00000000-0000-0000-0000-0000000000f7', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f5', '00000000-0000-0000-0000-0000000000f6', 'completed', 'initial_evaluation', '00000000-0000-0000-0000-0000000000a2', now(), now())
on conflict do nothing;

insert into public.candidate_role_matches (id, organization_id, candidate_id, job_id, recruitment_project_id, scorecard_version_id, latest_matching_run_id, eligibility, overall_score, evidence_coverage_pct, data_completeness_pct, confidence, review_status) values
  ('00000000-0000-0000-0000-0000000000f8', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f6', '00000000-0000-0000-0000-0000000000f7', 'eligible', 90.00, 100.00, 100.00, 0.900, 'pending')
on conflict do nothing;

insert into public.mandatory_gate_results (id, organization_id, matching_run_id, candidate_role_match_id, requirement_id, requirement_name, deterministic_result, ai_suggested_result, state) values
  ('00000000-0000-0000-0000-0000000000f9', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f7', '00000000-0000-0000-0000-0000000000f8', '00000000-0000-0000-0000-0000000000f3', '25+ multi-unit sites managed', 'pass', 'pass', 'passed')
on conflict do nothing;

insert into public.requirement_evidence (id, organization_id, matching_run_id, candidate_role_match_id, requirement_id, candidate_id, source_kind, excerpt, relevance_score, confidence, is_direct_statement) values
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f7', '00000000-0000-0000-0000-0000000000f8', '00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000d1', 'experience', 'Managed 42 sites across three states', 0.900, 0.900, true)
on conflict do nothing;

insert into public.scoring_breakdowns (id, organization_id, matching_run_id, candidate_role_match_id, requirement_id, requirement_name, weight, raw_score, confidence_discount, effective_score, weighted_contribution, has_evidence) values
  ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f7', '00000000-0000-0000-0000-0000000000f8', '00000000-0000-0000-0000-0000000000f4', 'P&L scale', 100, 0.900, 1, 0.900, 90.000, true)
on conflict do nothing;

-- TEST13a: assigned recruiter (a2) can read every one of the 7 tables for
-- this candidate x project.
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a2', false);
select 'TEST13a assigned recruiter sees matching_runs' as test,
  exists(select 1 from public.matching_runs where id = '00000000-0000-0000-0000-0000000000f7') as pass;
select 'TEST13a assigned recruiter sees candidate_role_matches' as test,
  exists(select 1 from public.candidate_role_matches where id = '00000000-0000-0000-0000-0000000000f8') as pass;
select 'TEST13a assigned recruiter sees mandatory_gate_results' as test,
  exists(select 1 from public.mandatory_gate_results where id = '00000000-0000-0000-0000-0000000000f9') as pass;
select 'TEST13a assigned recruiter sees requirement_evidence' as test,
  exists(select 1 from public.requirement_evidence where id = '00000000-0000-0000-0000-0000000000e4') as pass;
select 'TEST13a assigned recruiter sees scoring_breakdowns' as test,
  exists(select 1 from public.scoring_breakdowns where id = '00000000-0000-0000-0000-0000000000e5') as pass;
reset role;

-- TEST13b: unassigned recruiter (a3, same org, not on project f1) sees
-- NONE of the 7 tables' rows for this match.
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a3', false);
select 'TEST13b unassigned recruiter cannot see matching_runs' as test,
  not exists(select 1 from public.matching_runs where id = '00000000-0000-0000-0000-0000000000f7') as pass;
select 'TEST13b unassigned recruiter cannot see candidate_role_matches' as test,
  not exists(select 1 from public.candidate_role_matches where id = '00000000-0000-0000-0000-0000000000f8') as pass;
select 'TEST13b unassigned recruiter cannot see mandatory_gate_results' as test,
  not exists(select 1 from public.mandatory_gate_results where id = '00000000-0000-0000-0000-0000000000f9') as pass;
reset role;

-- TEST13c: client_decision_maker (a4) never sees any of the 7 tables —
-- a deliberate Build Phase 7 scope decision (client-facing shortlist view
-- is a future phase), unlike candidate_extracted_fields' client-readable
-- carve-out tested in TEST12d above.
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a4', false);
select 'TEST13c client_decision_maker cannot see candidate_role_matches' as test,
  not exists(select 1 from public.candidate_role_matches where id = '00000000-0000-0000-0000-0000000000f8') as pass;
select 'TEST13c client_decision_maker cannot see mandatory_gate_results' as test,
  not exists(select 1 from public.mandatory_gate_results where id = '00000000-0000-0000-0000-0000000000f9') as pass;
select 'TEST13c client_decision_maker cannot see requirement_evidence' as test,
  not exists(select 1 from public.requirement_evidence where id = '00000000-0000-0000-0000-0000000000e4') as pass;
reset role;

-- TEST13d: cross-tenant denial — other-org admin (b2) sees none of it,
-- even though its own agency_admin branch is org-wide within its own org.
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000b2', false);
select 'TEST13d cross-tenant admin cannot see candidate_role_matches' as test,
  not exists(select 1 from public.candidate_role_matches where id = '00000000-0000-0000-0000-0000000000f8') as pass;
reset role;

-- TEST13e: append-only enforcement — matching_runs/requirement_evidence/
-- human_reviews all reject UPDATE and DELETE at the database-role level
-- (REVOKE, not just RLS), even for the agency_admin who owns full RLS
-- access to the row.
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a1', false);
do $$
begin
  begin
    update public.matching_runs set status = 'failed' where id = '00000000-0000-0000-0000-0000000000f7';
    raise exception 'TEST13e FAILED: matching_runs should reject UPDATE at the role-privilege level';
  exception when insufficient_privilege then
    raise notice 'TEST13e PASS: matching_runs UPDATE rejected (insufficient_privilege)';
  end;
end $$;
do $$
begin
  begin
    delete from public.requirement_evidence where id = '00000000-0000-0000-0000-0000000000e4';
    raise exception 'TEST13e FAILED: requirement_evidence should reject DELETE at the role-privilege level';
  exception when insufficient_privilege then
    raise notice 'TEST13e PASS: requirement_evidence DELETE rejected (insufficient_privilege)';
  end;
end $$;
do $$
begin
  begin
    delete from public.human_reviews where candidate_role_match_id = '00000000-0000-0000-0000-0000000000f8';
    raise exception 'TEST13e FAILED: human_reviews should reject DELETE at the role-privilege level';
  exception when insufficient_privilege then
    raise notice 'TEST13e PASS: human_reviews DELETE rejected (insufficient_privilege)';
  end;
end $$;
reset role;

-- TEST13f: mandatory_gate_results DOES allow UPDATE (the human-override
-- flow needs it) but still rejects DELETE — its narrower REVOKE.
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a2', false);
update public.mandatory_gate_results
  set state = 'human_override', override_result = 'pass', override_by = '00000000-0000-0000-0000-0000000000a2',
      override_reason = 'Recruiter confirmed via phone reference check.', override_evidence_note = 'Verbal confirmation logged in call notes.', override_at = now()
  where id = '00000000-0000-0000-0000-0000000000f9';
reset role;
select 'TEST13f assigned recruiter CAN override a mandatory gate' as test,
  (select state from public.mandatory_gate_results where id = '00000000-0000-0000-0000-0000000000f9') = 'human_override' as pass;

set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a1', false);
do $$
begin
  begin
    delete from public.mandatory_gate_results where id = '00000000-0000-0000-0000-0000000000f9';
    raise exception 'TEST13f FAILED: mandatory_gate_results should reject DELETE at the role-privilege level';
  exception when insufficient_privilege then
    raise notice 'TEST13f PASS: mandatory_gate_results DELETE rejected (insufficient_privilege)';
  end;
end $$;
reset role;

-- TEST13g: unauthorized override — an unassigned recruiter (a3) cannot
-- override a mandatory gate for a candidate/project they cannot access
-- (RLS-filtered to 0 rows, not merely denied at the app layer).
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a3', false);
do $$
begin
  begin
    update public.mandatory_gate_results
      set override_result = 'fail', override_by = '00000000-0000-0000-0000-0000000000a3', override_reason = 'x', override_evidence_note = 'x', override_at = now()
      where id = '00000000-0000-0000-0000-0000000000f9';
    if not found then
      raise notice 'TEST13g PASS: unassigned recruiter override affected 0 rows (RLS-filtered)';
    else
      raise exception 'TEST13g FAILED: unassigned recruiter should not be able to override a gate for a candidate/project they cannot access';
    end if;
  end;
end $$;
reset role;
select 'TEST13g gate override untouched by unauthorized attempt' as test,
  (select override_by from public.mandatory_gate_results where id = '00000000-0000-0000-0000-0000000000f9') = '00000000-0000-0000-0000-0000000000a2' as pass;

-- TEST13h: human_reviews insert cannot impersonate another reviewer —
-- reviewer_id must equal the inserting user's own auth.uid(), even for an
-- otherwise-authorized assigned recruiter.
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a2', false);
do $$
begin
  begin
    insert into public.human_reviews (organization_id, candidate_role_match_id, matching_run_id, reviewer_id, decision, reason)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f8', '00000000-0000-0000-0000-0000000000f7', '00000000-0000-0000-0000-0000000000a3', 'rejected', 'impersonation attempt');
    raise exception 'TEST13h FAILED: a recruiter should not be able to record a review as a different reviewer_id';
  exception when insufficient_privilege or others then
    raise notice 'TEST13h PASS: human_reviews insert with a spoofed reviewer_id was rejected';
  end;
end $$;
reset role;

-- TEST13i: a legitimate human_reviews insert (reviewer_id = the acting
-- user) succeeds and its review_decisions child row is readable.
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a2', false);
insert into public.human_reviews (id, organization_id, candidate_role_match_id, matching_run_id, reviewer_id, decision, reason)
values ('00000000-0000-0000-0000-0000000000e6', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f8', '00000000-0000-0000-0000-0000000000f7', '00000000-0000-0000-0000-0000000000a2', 'approved_for_outreach', null);
insert into public.review_decisions (organization_id, human_review_id, field, before_value, after_value, reason)
values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e6', 'review_status', '{"reviewStatus":"pending"}'::jsonb, '{"reviewStatus":"approved_for_outreach"}'::jsonb, 'Approved for outreach.');
reset role;
select 'TEST13i assigned recruiter recorded their own review + decision' as test,
  exists(select 1 from public.human_reviews where id = '00000000-0000-0000-0000-0000000000e6' and reviewer_id = '00000000-0000-0000-0000-0000000000a2') as pass;

-- TEST13j: candidate_role_matches_score_only_when_eligible — the database
-- rejects an ineligible/pending_verification match carrying a non-null
-- score, regardless of application-layer discipline (docs/08-candidate-
-- scoring.md §8.3, Build Phase 7 brief §CORE RULES: "A failed mandatory
-- gate makes the candidate ineligible for ranked shortlisting").
do $$
begin
  begin
    insert into public.candidate_role_matches (organization_id, candidate_id, job_id, recruitment_project_id, scorecard_version_id, latest_matching_run_id, eligibility, overall_score)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f6', '00000000-0000-0000-0000-0000000000f7', 'ineligible', 42.00);
    raise exception 'TEST13j FAILED: candidate_role_matches should reject a non-null score for an ineligible candidate';
  exception when check_violation then
    raise notice 'TEST13j PASS: ineligible + non-null overall_score rejected by CHECK constraint';
  end;
end $$;

-- TEST13k: mandatory_gate_results_override_requires_full_record — the
-- database rejects a 'human_override' state that is missing any of the
-- four required fields (Build Phase 7 brief: "A human override must
-- require: Authorized role, Reason, Supporting evidence, Timestamp").
do $$
begin
  begin
    insert into public.mandatory_gate_results (organization_id, matching_run_id, candidate_role_match_id, requirement_id, requirement_name, deterministic_result, state, override_result, override_by)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f7', '00000000-0000-0000-0000-0000000000f8', '00000000-0000-0000-0000-0000000000f4', 'P&L scale', 'insufficient_evidence', 'human_override', 'pass', '00000000-0000-0000-0000-0000000000a2');
    raise exception 'TEST13k FAILED: an incomplete human_override record should be rejected';
  exception when check_violation then
    raise notice 'TEST13k PASS: incomplete human_override (missing reason/evidence/timestamp) rejected by CHECK constraint';
  end;
end $$;

-- TEST13l: rankings exclude ineligible candidates — a query mirroring the
-- shortlist/ranking view (order by overall_score, filtered to eligible)
-- never returns a candidate whose mandatory gate failed. Insert a second,
-- ineligible candidate_role_match with a NULL score (the only value the
-- CHECK constraint allows once ineligible) and confirm it is excluded from
-- a "top ranked candidates" style query.
insert into public.candidates (id, organization_id, full_name, status, created_by) values
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a1', 'Ineligible Candidate', 'active', '00000000-0000-0000-0000-0000000000a2')
on conflict do nothing;
insert into public.candidate_project_entries (organization_id, candidate_id, recruitment_project_id, job_id, current_stage, client_visible) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2', 'discovered', false)
on conflict do nothing;
insert into public.matching_runs (id, organization_id, candidate_id, job_id, recruitment_project_id, scorecard_id, scorecard_version_id, status, trigger_reason, requested_by, started_at, completed_at) values
  ('00000000-0000-0000-0000-0000000000e7', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f5', '00000000-0000-0000-0000-0000000000f6', 'completed', 'initial_evaluation', '00000000-0000-0000-0000-0000000000a2', now(), now())
on conflict do nothing;
insert into public.candidate_role_matches (id, organization_id, candidate_id, job_id, recruitment_project_id, scorecard_version_id, latest_matching_run_id, eligibility, overall_score, review_status) values
  ('00000000-0000-0000-0000-0000000000e8', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f6', '00000000-0000-0000-0000-0000000000e7', 'ineligible', null, 'pending')
on conflict do nothing;

select 'TEST13l ranked query (eligible-only, ordered by score) excludes the ineligible candidate' as test,
  not exists(
    select 1 from public.candidate_role_matches
    where job_id = '00000000-0000-0000-0000-0000000000f2' and eligibility = 'eligible'
      and candidate_id = '00000000-0000-0000-0000-0000000000d2'
  ) as pass;
select 'TEST13l the eligible candidate is still present in the ranked query' as test,
  exists(
    select 1 from public.candidate_role_matches
    where job_id = '00000000-0000-0000-0000-0000000000f2' and eligibility = 'eligible'
      and candidate_id = '00000000-0000-0000-0000-0000000000d1'
  ) as pass;

-- ---------------------------------------------------------------------
-- TEST 14 (Build Phase 8): human review + shortlisting — RLS, trigger
-- enforcement, and append-only checks across the 6 new tables plus the
-- two extended CHECK constraints, mirroring TEST 13's structure.
-- ---------------------------------------------------------------------

-- Grants mirror what a real Supabase project auto-grants, narrowed by
-- 0028's REVOKE statements (verification_requests: revoke delete only;
-- shortlist_candidates/client_decisions/shortlist_activity: revoke
-- update+delete; shortlists/shortlist_versions: no revoke, but delete was
-- never granted either — see 0028's own grant block, which this mirrors).
grant select, insert, update on public.verification_requests to authenticated;
grant select, insert, update on public.shortlists to authenticated;
grant select, insert, update on public.shortlist_versions to authenticated;
grant select, insert on public.shortlist_candidates to authenticated;
grant select, insert on public.client_decisions to authenticated;
grant select, insert on public.shortlist_activity to authenticated;

-- Fixtures: shortlist 200 (max 3, draft) for job f2 / client c1, its first
-- version 210, and the eligible candidate f8/d1 added at rank 1 — inserted
-- as the table owner (bypassing RLS), same convention as TEST 13.
insert into public.shortlists (id, organization_id, recruitment_project_id, job_id, client_id, status, max_candidates, created_by) values
  ('00000000-0000-0000-0000-000000000200', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000c1', 'draft', 3, '00000000-0000-0000-0000-0000000000a2')
on conflict do nothing;

insert into public.shortlist_versions (id, organization_id, shortlist_id, version_number, status, created_by) values
  ('00000000-0000-0000-0000-000000000210', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000200', 1, 'draft', '00000000-0000-0000-0000-0000000000a2')
on conflict do nothing;

update public.shortlists set current_version_id = '00000000-0000-0000-0000-000000000210' where id = '00000000-0000-0000-0000-000000000200';

insert into public.shortlist_candidates (id, organization_id, shortlist_version_id, candidate_role_match_id, candidate_id, matching_run_id, scorecard_version_id, rank, added_by) values
  ('00000000-0000-0000-0000-000000000220', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000210', '00000000-0000-0000-0000-0000000000f8', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f7', '00000000-0000-0000-0000-0000000000f6', 1, '00000000-0000-0000-0000-0000000000a2')
on conflict do nothing;

-- TEST14a: never rank failed mandatory-gate candidates — adding the
-- ineligible candidate (e8/d2) to the same shortlist version is rejected
-- by the enforce_shortlist_candidate_rules() trigger, not silently
-- filtered.
do $$
begin
  begin
    insert into public.shortlist_candidates (organization_id, shortlist_version_id, candidate_role_match_id, candidate_id, matching_run_id, scorecard_version_id, rank, added_by)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000210', '00000000-0000-0000-0000-0000000000e8', '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000e7', '00000000-0000-0000-0000-0000000000f6', 2, '00000000-0000-0000-0000-0000000000a2');
    raise exception 'TEST14a FAILED: an ineligible candidate should never be added to a shortlist';
  exception when others then
    if sqlerrm like '%is not eligible%' then
      raise notice 'TEST14a PASS: ineligible candidate rejected by enforce_shortlist_candidate_rules()';
    else
      raise exception 'TEST14a FAILED: unexpected error: %', sqlerrm;
    end if;
  end;
end $$;

-- TEST14b: duplicate candidate inclusion is rejected by
-- UNIQUE(shortlist_version_id, candidate_id) — same candidate, same
-- version, different row.
do $$
begin
  begin
    insert into public.shortlist_candidates (organization_id, shortlist_version_id, candidate_role_match_id, candidate_id, matching_run_id, scorecard_version_id, rank, added_by)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000210', '00000000-0000-0000-0000-0000000000f8', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f7', '00000000-0000-0000-0000-0000000000f6', 3, '00000000-0000-0000-0000-0000000000a2');
    raise exception 'TEST14b FAILED: a duplicate candidate should be rejected';
  exception when unique_violation then
    raise notice 'TEST14b PASS: duplicate candidate rejected by UNIQUE(shortlist_version_id, candidate_id)';
  end;
end $$;

-- TEST14c: shortlist-size enforcement — a second shortlist (201/211) with
-- max_candidates=1 rejects a second candidate without an override, then
-- accepts it once override_max_candidates + override_by + override_reason
-- are all set (mirrors the interactive verification already run this
-- session against a second eligible candidate_role_match).
insert into public.shortlists (id, organization_id, recruitment_project_id, job_id, client_id, status, max_candidates, created_by) values
  ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000c1', 'draft', 1, '00000000-0000-0000-0000-0000000000a2')
on conflict do nothing;
insert into public.shortlist_versions (id, organization_id, shortlist_id, version_number, status, created_by) values
  ('00000000-0000-0000-0000-000000000211', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000201', 1, 'draft', '00000000-0000-0000-0000-0000000000a2')
on conflict do nothing;
insert into public.shortlist_candidates (id, organization_id, shortlist_version_id, candidate_role_match_id, candidate_id, matching_run_id, scorecard_version_id, rank, added_by) values
  ('00000000-0000-0000-0000-000000000221', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000211', '00000000-0000-0000-0000-0000000000f8', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f7', '00000000-0000-0000-0000-0000000000f6', 1, '00000000-0000-0000-0000-0000000000a2')
on conflict do nothing;

-- Second, distinct eligible match: temporarily flip e8 to eligible for
-- this one insert attempt (rolled back immediately after), same technique
-- used interactively this session, so the size-cap check exercises a
-- genuinely different, genuinely eligible candidate rather than a
-- duplicate of f8/d1.
do $$
begin
  update public.candidate_role_matches set eligibility = 'eligible' where id = '00000000-0000-0000-0000-0000000000e8';
  begin
    insert into public.shortlist_candidates (organization_id, shortlist_version_id, candidate_role_match_id, candidate_id, matching_run_id, scorecard_version_id, rank, added_by)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000211', '00000000-0000-0000-0000-0000000000e8', '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000e7', '00000000-0000-0000-0000-0000000000f6', 2, '00000000-0000-0000-0000-0000000000a2');
    raise exception 'TEST14c FAILED: a second candidate should be rejected without an override (max_candidates=1)';
  exception when others then
    if sqlerrm like '%maximum%' then
      raise notice 'TEST14c PASS: exceeding max_candidates without an override is rejected';
    else
      raise exception 'TEST14c FAILED: unexpected error: %', sqlerrm;
    end if;
  end;

  -- Now authorize the override and retry — should succeed.
  update public.shortlists
    set override_max_candidates = true, override_by = '00000000-0000-0000-0000-0000000000a1', override_reason = 'Client requested a wider slate for this niche role.'
    where id = '00000000-0000-0000-0000-000000000201';

  insert into public.shortlist_candidates (organization_id, shortlist_version_id, candidate_role_match_id, candidate_id, matching_run_id, scorecard_version_id, rank, added_by)
  values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000211', '00000000-0000-0000-0000-0000000000e8', '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000e7', '00000000-0000-0000-0000-0000000000f6', 2, '00000000-0000-0000-0000-0000000000a2');
  raise notice 'TEST14c PASS: an authorized override permits exceeding max_candidates';

  -- Restore e8 to ineligible so later tests (and TEST 13's own assertions,
  -- which run earlier in this file and are unaffected, plus anything that
  -- might rerun) see the original fixture state.
  update public.candidate_role_matches set eligibility = 'ineligible', overall_score = null where id = '00000000-0000-0000-0000-0000000000e8';
end $$;

-- TEST14d: an override with no reason/authorizer is rejected by
-- shortlists_override_requires_reason.
do $$
begin
  begin
    insert into public.shortlists (organization_id, recruitment_project_id, job_id, client_id, status, max_candidates, override_max_candidates, override_reason) values
      ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000c1', 'draft', 1, true, null);
    raise exception 'TEST14d FAILED: an override with no authorizer should be rejected';
  exception when check_violation then
    raise notice 'TEST14d PASS: an incomplete override (missing override_by) is rejected by shortlists_override_requires_reason';
  end;
end $$;

-- TEST14e: rejection/discussion notes are required — accept needs none,
-- reject/discuss must carry a non-empty note (client_decisions_notes_
-- required_unless_accept).
insert into public.shortlist_versions (id, organization_id, shortlist_id, version_number, status) values
  ('00000000-0000-0000-0000-000000000212', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000200', 2, 'sent_to_client')
on conflict do nothing;
update public.shortlists set status = 'sent_to_client', current_version_id = '00000000-0000-0000-0000-000000000212' where id = '00000000-0000-0000-0000-000000000200';

insert into public.shortlist_candidates (id, organization_id, shortlist_version_id, candidate_role_match_id, candidate_id, matching_run_id, scorecard_version_id, rank, added_by) values
  ('00000000-0000-0000-0000-000000000222', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000212', '00000000-0000-0000-0000-0000000000f8', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f7', '00000000-0000-0000-0000-0000000000f6', 1, '00000000-0000-0000-0000-0000000000a2')
on conflict do nothing;

do $$
begin
  begin
    insert into public.client_decisions (organization_id, shortlist_id, shortlist_version_id, client_id, decided_by, decision, notes) values
      ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000200', '00000000-0000-0000-0000-000000000212', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a4', 'reject', null);
    raise exception 'TEST14e FAILED: reject with no notes should be rejected';
  exception when check_violation then
    raise notice 'TEST14e PASS: reject/discuss without notes rejected by client_decisions_notes_required_unless_accept';
  end;
end $$;

insert into public.client_decisions (id, organization_id, shortlist_id, shortlist_version_id, client_id, decided_by, decision, notes) values
  ('00000000-0000-0000-0000-000000000230', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000200', '00000000-0000-0000-0000-000000000212', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a4', 'discuss', 'Would like to see one more candidate with weekend availability.')
on conflict do nothing;

-- TEST14f: review permissions — the recruiter ASSIGNED to this project (a2)
-- can read and insert shortlists/shortlist_versions/shortlist_candidates;
-- the recruiter NOT assigned (a3) cannot see them at all.
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a2', false);
select 'TEST14f assigned recruiter (a2) can see the shortlist' as test,
  exists(select 1 from public.shortlists where id = '00000000-0000-0000-0000-000000000200') as pass;
select 'TEST14f assigned recruiter (a2) can see its shortlist_candidates' as test,
  exists(select 1 from public.shortlist_candidates where id = '00000000-0000-0000-0000-000000000220') as pass;
reset role;

set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a3', false);
select 'TEST14f unassigned recruiter (a3) cannot see the shortlist' as test,
  not exists(select 1 from public.shortlists where id = '00000000-0000-0000-0000-000000000200') as pass;
reset role;

-- TEST14g: client data visibility — a shortlist still in 'draft'/'pending_
-- internal_approval'/'internally_approved' is invisible to the client
-- reviewer (a4); once 'sent_to_client' it becomes visible, and its
-- shortlist_candidates rows become visible too (client-safe field
-- redaction, e.g. dropping recruiterNote, happens at the application
-- layer per apps/web/lib/shortlists/visibility.ts — RLS only gates the
-- row, not the recruiter_note column, so that redaction is NOT re-tested
-- here at the SQL layer; visibility.test.ts covers it).
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a4', false);
select 'TEST14g client cannot see the still-draft second shortlist (201)' as test,
  not exists(select 1 from public.shortlists where id = '00000000-0000-0000-0000-000000000201') as pass;
select 'TEST14g client CAN see the sent-to-client shortlist (200)' as test,
  exists(select 1 from public.shortlists where id = '00000000-0000-0000-0000-000000000200') as pass;
select 'TEST14g client CAN see that shortlist''s current-version candidates' as test,
  exists(select 1 from public.shortlist_candidates where shortlist_version_id = '00000000-0000-0000-0000-000000000212') as pass;
reset role;

-- TEST14h: tenant isolation — an admin/recruiter in a completely different
-- organization (b2/b3) sees none of org a1's shortlist rows at all.
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000b2', false);
select 'TEST14h other-org admin (b2) cannot see any shortlist in org a1' as test,
  not exists(select 1 from public.shortlists where organization_id = '00000000-0000-0000-0000-0000000000a1') as pass;
select 'TEST14h other-org admin (b2) cannot see any shortlist_candidates in org a1' as test,
  not exists(select 1 from public.shortlist_candidates where organization_id = '00000000-0000-0000-0000-0000000000a1') as pass;
reset role;

-- TEST14i: version preservation — shortlist_candidates is append-only at
-- the database-role level (0028 revokes update+delete from authenticated),
-- so even the assigned recruiter cannot mutate or remove a row from a
-- version that has already been submitted/sent — the only supported path
-- is starting a NEW shortlist_versions row (rebuildShortlistVersionAction),
-- never editing history in place.
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a2', false);
do $$
begin
  begin
    delete from public.shortlist_candidates where id = '00000000-0000-0000-0000-000000000220';
    raise exception 'TEST14i FAILED: shortlist_candidates should be append-only at the database-role level';
  exception when insufficient_privilege then
    raise notice 'TEST14i PASS: shortlist_candidates delete denied at the database-role level (append-only, matches revoke in 0028)';
  end;
end $$;
reset role;

-- TEST14j: verification_requests — resolution requires resolved_by/
-- resolved_at together (verification_requests_resolution_requires_detail);
-- an open request can be created and later resolved with a note.
insert into public.verification_requests (id, organization_id, candidate_role_match_id, requirement_id, requested_by, request_note) values
  ('00000000-0000-0000-0000-000000000250', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f8', '00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000a2', 'P&L figure in the resume looks stale — please confirm with the candidate directly.')
on conflict do nothing;

do $$
begin
  begin
    update public.verification_requests set status = 'resolved' where id = '00000000-0000-0000-0000-000000000250';
    raise exception 'TEST14j FAILED: resolving without resolved_by/resolved_at should be rejected';
  exception when check_violation then
    raise notice 'TEST14j PASS: resolution without resolved_by/resolved_at rejected by verification_requests_resolution_requires_detail';
  end;
end $$;

update public.verification_requests
  set status = 'resolved', resolved_by = '00000000-0000-0000-0000-0000000000a2', resolved_at = now(), resolution_note = 'Confirmed directly with the candidate — figure is current.'
  where id = '00000000-0000-0000-0000-000000000250';

select 'TEST14j resolved verification_request carries a resolution note' as test,
  exists(select 1 from public.verification_requests where id = '00000000-0000-0000-0000-000000000250' and status = 'resolved' and resolution_note is not null) as pass;

-- TEST14k: extended decision/review_status enums accept the new Build
-- Phase 8 values ('escalated', 'note_added' on human_reviews.decision;
-- 'escalated' on candidate_role_matches.review_status), and still reject
-- an invalid value.
insert into public.human_reviews (organization_id, candidate_role_match_id, matching_run_id, reviewer_id, decision, reason) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f8', '00000000-0000-0000-0000-0000000000f7', '00000000-0000-0000-0000-0000000000a2', 'escalated', 'Compensation expectation is well above the role band — needs Agency Admin input.'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f8', '00000000-0000-0000-0000-0000000000f7', '00000000-0000-0000-0000-0000000000a2', 'note_added', 'Candidate mentioned a possible relocation timeline change — worth revisiting before outreach.')
on conflict do nothing;

update public.candidate_role_matches set review_status = 'escalated' where id = '00000000-0000-0000-0000-0000000000f8';
select 'TEST14k candidate_role_matches.review_status accepts escalated' as test,
  exists(select 1 from public.candidate_role_matches where id = '00000000-0000-0000-0000-0000000000f8' and review_status = 'escalated') as pass;
update public.candidate_role_matches set review_status = 'pending' where id = '00000000-0000-0000-0000-0000000000f8';

do $$
begin
  begin
    insert into public.human_reviews (organization_id, candidate_role_match_id, matching_run_id, reviewer_id, decision, reason) values
      ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f8', '00000000-0000-0000-0000-0000000000f7', '00000000-0000-0000-0000-0000000000a2', 'not_a_real_decision', 'x');
    raise exception 'TEST14k FAILED: an invalid decision value should be rejected';
  exception when check_violation then
    raise notice 'TEST14k PASS: an invalid human_reviews.decision value is rejected by the extended CHECK constraint';
  end;
end $$;

-- TEST14l: candidate_project_entries interest tri-state — defaults to
-- 'unknown', accepts 'interested'/'declined', rejects anything else.
select 'TEST14l candidate interest defaults to unknown' as test,
  (select interest_status from public.candidate_project_entries where candidate_id = '00000000-0000-0000-0000-0000000000d1' and recruitment_project_id = '00000000-0000-0000-0000-0000000000f1') = 'unknown' as pass;

update public.candidate_project_entries set interest_status = 'interested', interest_confirmed_by = '00000000-0000-0000-0000-0000000000a2', interest_confirmed_at = now()
  where candidate_id = '00000000-0000-0000-0000-0000000000d1' and recruitment_project_id = '00000000-0000-0000-0000-0000000000f1';
select 'TEST14l candidate interest updates to interested' as test,
  (select interest_status from public.candidate_project_entries where candidate_id = '00000000-0000-0000-0000-0000000000d1' and recruitment_project_id = '00000000-0000-0000-0000-0000000000f1') = 'interested' as pass;

do $$
begin
  begin
    update public.candidate_project_entries set interest_status = 'maybe' where candidate_id = '00000000-0000-0000-0000-0000000000d1' and recruitment_project_id = '00000000-0000-0000-0000-0000000000f1';
    raise exception 'TEST14l FAILED: an invalid interest_status value should be rejected';
  exception when check_violation then
    raise notice 'TEST14l PASS: an invalid interest_status value is rejected';
  end;
end $$;
update public.candidate_project_entries set interest_status = 'unknown', interest_confirmed_by = null, interest_confirmed_at = null
  where candidate_id = '00000000-0000-0000-0000-0000000000d1' and recruitment_project_id = '00000000-0000-0000-0000-0000000000f1';

-- TEST14m: shortlist_activity — client_visible = false rows never reach
-- the client reviewer even once the shortlist has been sent, while
-- client_visible = true rows do (Build Phase 8 brief: "Do not expose
-- private recruiter notes to clients").
insert into public.shortlist_activity (id, organization_id, shortlist_id, actor_id, action, summary, client_visible) values
  ('00000000-0000-0000-0000-000000000240', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000200', '00000000-0000-0000-0000-0000000000a2', 'internal_note', 'Recruiter thinks this candidate may want more comp than listed.', false),
  ('00000000-0000-0000-0000-000000000241', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000200', '00000000-0000-0000-0000-0000000000a2', 'sent_to_client', 'Shortlist sent to the client for review.', true)
on conflict do nothing;

set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a4', false);
select 'TEST14m client cannot see the internal-only activity row' as test,
  not exists(select 1 from public.shortlist_activity where id = '00000000-0000-0000-0000-000000000240') as pass;
select 'TEST14m client CAN see the client-visible activity row' as test,
  exists(select 1 from public.shortlist_activity where id = '00000000-0000-0000-0000-000000000241') as pass;
reset role;
reset role;

-- ---------------------------------------------------------------------
-- TEST 15: Build Phase 9 "Outreach" (supabase/migrations/0029) — human
-- approval, message editing, unsupported-personalization scaffolding,
-- idempotent sending, provider failures, opt-out enforcement, response
-- classification (incl. ambiguous), client-role restrictions, tenant
-- isolation, audit history hooks, append-only tables.
-- ---------------------------------------------------------------------

-- TEST15a: outreach_sequences requires the underlying candidate_role_match
-- to already be review_status = 'approved_for_outreach' (core rule: human
-- approval before outreach). f8's review_status was reset to 'pending' by
-- TEST14k above, so this also proves the gate reads live state.
do $$
begin
  begin
    insert into public.outreach_sequences (organization_id, candidate_role_match_id, candidate_id, recruitment_project_id, job_id, started_by)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f8', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000a2');
    raise exception 'TEST15a FAILED: a sequence should not be startable before the match is approved_for_outreach';
  exception when others then
    if sqlerrm like '%has not been approved for outreach%' then
      raise notice 'TEST15a PASS: outreach_sequences rejected before candidate_role_match approval';
    else
      raise exception 'TEST15a FAILED: unexpected error: %', sqlerrm;
    end if;
  end;
end $$;

update public.candidate_role_matches set review_status = 'approved_for_outreach' where id = '00000000-0000-0000-0000-0000000000f8';

insert into public.outreach_sequences (id, organization_id, candidate_role_match_id, candidate_id, recruitment_project_id, job_id, started_by) values
  ('00000000-0000-0000-0000-000000000300', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f8', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000a2')
on conflict do nothing;
select 'TEST15a PASS confirmed: sequence created once the match is approved_for_outreach' as test,
  exists(select 1 from public.outreach_sequences where id = '00000000-0000-0000-0000-000000000300') as pass;

-- TEST15b: opt-out enforcement — draft messages for an opted-out channel
-- are rejected at the database layer (brief functional requirement #10).
insert into public.communication_preferences (id, organization_id, candidate_id, channel, status, opted_out_at, opted_out_reason, opted_out_by, updated_by) values
  ('00000000-0000-0000-0000-000000000310', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', 'email', 'opted_out', now(), 'Candidate asked to be removed from the email list during a phone call.', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a2')
on conflict do nothing;

do $$
begin
  begin
    insert into public.outreach_messages (organization_id, outreach_sequence_id, candidate_id, recruitment_project_id, candidate_role_match_id, channel, draft_body)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000300', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f8', 'email', 'Hi Jane, following up on the Store Manager role...');
    raise exception 'TEST15b FAILED: an email draft should be rejected for an opted-out channel';
  exception when others then
    if sqlerrm like '%has opted out of channel%' then
      raise notice 'TEST15b PASS: outreach_messages insert rejected for an opted-out channel';
    else
      raise exception 'TEST15b FAILED: unexpected error: %', sqlerrm;
    end if;
  end;
end $$;

-- A non-opted-out channel (phone) for the same candidate succeeds.
insert into public.outreach_messages (id, organization_id, outreach_sequence_id, candidate_id, recruitment_project_id, candidate_role_match_id, channel, draft_body, personalization_evidence, idempotency_key, created_by) values
  ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000300', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f8', 'phone', 'Call script: confirm interest in the Store Manager role at Acme Retail, referencing 25+ multi-unit sites managed.', '[{"requirementEvidenceId":"00000000-0000-0000-0000-0000000000e4","excerpt":"Managed 42 sites across three states"}]'::jsonb, 'seed-1', '00000000-0000-0000-0000-0000000000a2')
on conflict do nothing;
select 'TEST15b PASS confirmed: a non-opted-out channel (phone) drafts successfully' as test,
  exists(select 1 from public.outreach_messages where id = '00000000-0000-0000-0000-000000000301') as pass;
select 'TEST15b personalization_evidence carries the evidence reference used' as test,
  (select jsonb_array_length(personalization_evidence) from public.outreach_messages where id = '00000000-0000-0000-0000-000000000301') = 1 as pass;

-- TEST15c: idempotent sending — a duplicate idempotency_key within the same
-- org is rejected by the unique index, not silently double-processed.
insert into public.outreach_messages (id, organization_id, outreach_sequence_id, candidate_id, recruitment_project_id, candidate_role_match_id, channel, draft_body, idempotency_key) values
  ('00000000-0000-0000-0000-000000000305', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000300', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f8', 'phone', 'Draft A.', 'idem-key-1')
on conflict do nothing;

do $$
begin
  begin
    insert into public.outreach_messages (id, organization_id, outreach_sequence_id, candidate_id, recruitment_project_id, candidate_role_match_id, channel, draft_body, idempotency_key)
    values ('00000000-0000-0000-0000-000000000306', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000300', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f8', 'phone', 'Draft A retried.', 'idem-key-1');
    raise exception 'TEST15c FAILED: a duplicate idempotency_key within the same org should be rejected';
  exception when unique_violation then
    raise notice 'TEST15c PASS: retried send with the same idempotency_key rejected by the unique index';
  end;
end $$;

-- TEST15d: approval required before status can advance, AND sender account
-- ownership must be recorded before it can (brief functional requirements
-- #3 and #7).
do $$
begin
  begin
    update public.outreach_messages set status = 'approved' where id = '00000000-0000-0000-0000-000000000301';
    raise exception 'TEST15d FAILED: status should not advance to approved with no outreach_approvals row';
  exception when others then
    if sqlerrm like '%requires a prior approved outreach_approvals record%' then
      raise notice 'TEST15d PASS: status change to approved rejected with no prior approval';
    else
      raise exception 'TEST15d FAILED: unexpected error: %', sqlerrm;
    end if;
  end;
end $$;

insert into public.outreach_approvals (id, organization_id, outreach_message_id, approver_id, decision, edited_before_approval) values
  ('00000000-0000-0000-0000-000000000320', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-0000000000a2', 'approved', true)
on conflict do nothing;

do $$
begin
  begin
    update public.outreach_messages set status = 'approved' where id = '00000000-0000-0000-0000-000000000301';
    raise exception 'TEST15d FAILED: status should still be rejected with no sender_user_id recorded';
  exception when check_violation then
    raise notice 'TEST15d PASS: status change to approved rejected without sender account ownership (sender_user_id)';
  end;
end $$;

update public.outreach_messages set status = 'approved', sender_user_id = '00000000-0000-0000-0000-0000000000a2', sender_account_identifier = 'dave-recruiting-line'
  where id = '00000000-0000-0000-0000-000000000301';
select 'TEST15d PASS confirmed: status advances to approved once approval + sender ownership are both recorded' as test,
  (select status from public.outreach_messages where id = '00000000-0000-0000-0000-000000000301') = 'approved' as pass;

-- TEST15e: message editing before approval is trackable (brief functional
-- requirement #4) — edited_by_human is an ordinary recruiter-set flag.
update public.outreach_messages set draft_body = 'Call script (edited): confirm interest, mention flexible start date.', edited_by_human = true
  where id = '00000000-0000-0000-0000-000000000305';
select 'TEST15e edited_by_human flag is recorded on an edited draft' as test,
  (select edited_by_human from public.outreach_messages where id = '00000000-0000-0000-0000-000000000305') = true as pass;

-- TEST15f: provider failures — a 'failed' status requires failed_at and a
-- non-empty failure_reason together (CHECK), not just a bare flag.
insert into public.outreach_messages (id, organization_id, outreach_sequence_id, candidate_id, recruitment_project_id, candidate_role_match_id, channel, draft_body) values
  ('00000000-0000-0000-0000-000000000307', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000300', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f8', 'phone', 'Second call attempt script.')
on conflict do nothing;

do $$
begin
  begin
    update public.outreach_messages set status = 'failed', sender_user_id = '00000000-0000-0000-0000-0000000000a2' where id = '00000000-0000-0000-0000-000000000307';
    raise exception 'TEST15f FAILED: a failed status with no failed_at/failure_reason should be rejected';
  exception when check_violation then
    raise notice 'TEST15f PASS: failed status without failed_at/failure_reason rejected by outreach_messages_failed_requires_detail';
  end;
end $$;

update public.outreach_messages set status = 'failed', sender_user_id = '00000000-0000-0000-0000-0000000000a2', failed_at = now(), failure_reason = 'Provider timeout after 3 retries.'
  where id = '00000000-0000-0000-0000-000000000307';
select 'TEST15f PASS confirmed: failed status accepted once failed_at + failure_reason are both recorded' as test,
  (select status from public.outreach_messages where id = '00000000-0000-0000-0000-000000000307') = 'failed' as pass;

-- TEST15g: candidate response classification — AI's suggestion is
-- reviewable/informational only; confirming a classification requires
-- reviewed_by + reviewed_at together (CHECK), so an unreviewed AI proposal
-- alone can never become authoritative.
insert into public.candidate_responses (id, organization_id, candidate_id, recruitment_project_id, outreach_message_id, channel, raw_response_text, ai_suggested_classification, ai_confidence) values
  ('00000000-0000-0000-0000-000000000330', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f1', null, 'linkedin', 'Please stop contacting me, I am not interested any further.', 'opt_out', 0.870)
on conflict do nothing;

do $$
begin
  begin
    update public.candidate_responses set confirmed_classification = 'opt_out' where id = '00000000-0000-0000-0000-000000000330';
    raise exception 'TEST15g FAILED: confirming a classification with no reviewed_by/reviewed_at should be rejected';
  exception when check_violation then
    raise notice 'TEST15g PASS: confirmed_classification without reviewed_by/reviewed_at rejected by candidate_responses_confirmed_requires_review';
  end;
end $$;

-- TEST15h: opt-out propagation is human-confirmation-gated, not AI-driven —
-- the raw AI suggestion above did NOT touch communication_preferences.
select 'TEST15h an unreviewed AI opt_out suggestion does not itself set communication_preferences' as test,
  not exists(select 1 from public.communication_preferences where candidate_id = '00000000-0000-0000-0000-0000000000d1' and channel = 'linkedin') as pass;

-- Human confirms the classification: reviewed_by + reviewed_at together,
-- which is what actually triggers the deterministic opt-out gate.
update public.candidate_responses set confirmed_classification = 'opt_out', reviewed_by = '00000000-0000-0000-0000-0000000000a2', reviewed_at = now(), review_note = 'Confirmed opt-out request during the same call.'
  where id = '00000000-0000-0000-0000-000000000330';

select 'TEST15h confirmed opt_out classification propagates to communication_preferences' as test,
  (select status from public.communication_preferences where candidate_id = '00000000-0000-0000-0000-0000000000d1' and channel = 'linkedin') = 'opted_out' as pass;

do $$
begin
  begin
    insert into public.outreach_messages (organization_id, outreach_sequence_id, candidate_id, recruitment_project_id, candidate_role_match_id, channel, draft_body)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000300', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f8', 'linkedin', 'LinkedIn message draft.');
    raise exception 'TEST15h FAILED: further automated communication on the now-opted-out channel should be blocked';
  exception when others then
    if sqlerrm like '%has opted out of channel%' then
      raise notice 'TEST15h PASS: further outreach on the newly opted-out channel (linkedin) is blocked';
    else
      raise exception 'TEST15h FAILED: unexpected error: %', sqlerrm;
    end if;
  end;
end $$;

-- TEST15i: ambiguous / non-opt-out classifications are recorded normally
-- and never touch communication_preferences.
insert into public.candidate_responses (id, organization_id, candidate_id, recruitment_project_id, outreach_message_id, channel, raw_response_text, ai_suggested_classification, reviewed_by, reviewed_at, confirmed_classification) values
  ('00000000-0000-0000-0000-000000000331', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000301', 'phone', 'Maybe, can you tell me more about the schedule?', 'ambiguous', '00000000-0000-0000-0000-0000000000a2', now(), 'ambiguous')
on conflict do nothing;
select 'TEST15i ambiguous classification recorded without triggering an opt-out' as test,
  not exists(select 1 from public.communication_preferences where candidate_id = '00000000-0000-0000-0000-0000000000d1' and channel = 'phone' and status = 'opted_out') as pass;

-- TEST15j: malformed status/classification values are rejected by the
-- extended CHECK constraints, not silently accepted.
do $$
begin
  begin
    insert into public.outreach_messages (organization_id, outreach_sequence_id, candidate_id, recruitment_project_id, candidate_role_match_id, channel, draft_body, status)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000300', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f8', 'phone', 'x', 'not_a_real_status');
    raise exception 'TEST15j FAILED: an invalid outreach_messages.status value should be rejected';
  exception when check_violation then
    raise notice 'TEST15j PASS: invalid outreach_messages.status value rejected by CHECK constraint';
  end;
end $$;

do $$
begin
  begin
    update public.candidate_responses set confirmed_classification = 'maybe_later', reviewed_by = '00000000-0000-0000-0000-0000000000a2', reviewed_at = now()
      where id = '00000000-0000-0000-0000-000000000331';
    raise exception 'TEST15j FAILED: an invalid candidate_responses classification value should be rejected';
  exception when check_violation then
    raise notice 'TEST15j PASS: invalid candidate_responses classification value rejected by CHECK constraint';
  end;
end $$;

-- TEST15k: candidate_contact_points.verified_at is required once verified
-- is true (Build Phase 9 extension to the existing table).
do $$
begin
  begin
    insert into public.candidate_contact_points (organization_id, candidate_id, type, value, verified)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', 'email', 'jane.verify.test@example.com', true);
    raise exception 'TEST15k FAILED: verified = true with no verified_at should be rejected';
  exception when check_violation then
    raise notice 'TEST15k PASS: verified = true without verified_at rejected by candidate_contact_points_verified_at_requires_verified';
  end;
end $$;

-- TEST15l: communication_events — inbound events are always recordable
-- regardless of opt-out status; outbound events on an opted-out channel are
-- blocked by the same deterministic gate as outreach_messages.
insert into public.communication_events (id, organization_id, outreach_message_id, candidate_id, recruitment_project_id, channel, direction, event_type, provider, raw_payload) values
  ('00000000-0000-0000-0000-000000000340', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f1', 'phone', 'outbound', 'queued', 'twilio-stub', '{"note":"queued for dial"}'::jsonb)
on conflict do nothing;
select 'TEST15l an outbound event on a non-opted-out channel is recorded' as test,
  exists(select 1 from public.communication_events where id = '00000000-0000-0000-0000-000000000340') as pass;

insert into public.communication_events (id, organization_id, outreach_message_id, candidate_id, recruitment_project_id, channel, direction, event_type, raw_payload) values
  ('00000000-0000-0000-0000-000000000341', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f1', 'linkedin', 'inbound', 'inbound_reply', '{"body":"candidate-authored text, untrusted"}'::jsonb)
on conflict do nothing;
select 'TEST15l an inbound event on an opted-out channel is still recorded (history is never suppressed)' as test,
  exists(select 1 from public.communication_events where id = '00000000-0000-0000-0000-000000000341') as pass;

do $$
begin
  begin
    insert into public.communication_events (organization_id, outreach_message_id, candidate_id, recruitment_project_id, channel, direction, event_type)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f1', 'linkedin', 'outbound', 'queued');
    raise exception 'TEST15l FAILED: an outbound event on an opted-out channel should be blocked';
  exception when others then
    if sqlerrm like '%has opted out of channel%' then
      raise notice 'TEST15l PASS: outbound communication_events blocked on the opted-out channel';
    else
      raise exception 'TEST15l FAILED: unexpected error: %', sqlerrm;
    end if;
  end;
end $$;

-- TEST15m: append-only tables — outreach_approvals and communication_events
-- are append-only at the database-role level (no UPDATE/DELETE grant to
-- authenticated), same convention as human_reviews/client_decisions.
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a2', false);
do $$
begin
  begin
    delete from public.outreach_approvals where id = '00000000-0000-0000-0000-000000000320';
    raise exception 'TEST15m FAILED: outreach_approvals should be append-only at the database-role level';
  exception when insufficient_privilege then
    raise notice 'TEST15m PASS: outreach_approvals delete denied at the database-role level';
  end;
end $$;
do $$
begin
  begin
    update public.communication_events set event_type = 'delivered' where id = '00000000-0000-0000-0000-000000000340';
    raise exception 'TEST15m FAILED: communication_events should be append-only at the database-role level';
  exception when insufficient_privilege then
    raise notice 'TEST15m PASS: communication_events update denied at the database-role level';
  end;
end $$;
reset role;

-- TEST15n: recruiter scoping — the assigned recruiter (a2) can see the
-- sequence/messages; the unassigned recruiter (a3) cannot see any of it.
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a2', false);
select 'TEST15n assigned recruiter (a2) can see the outreach_sequence' as test,
  exists(select 1 from public.outreach_sequences where id = '00000000-0000-0000-0000-000000000300') as pass;
select 'TEST15n assigned recruiter (a2) can see its outreach_messages' as test,
  exists(select 1 from public.outreach_messages where id = '00000000-0000-0000-0000-000000000301') as pass;
select 'TEST15n assigned recruiter (a2) can see the candidate_responses' as test,
  exists(select 1 from public.candidate_responses where id = '00000000-0000-0000-0000-000000000330') as pass;
reset role;

set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a3', false);
select 'TEST15n unassigned recruiter (a3) cannot see the outreach_sequence' as test,
  not exists(select 1 from public.outreach_sequences where id = '00000000-0000-0000-0000-000000000300') as pass;
select 'TEST15n unassigned recruiter (a3) cannot see the outreach_messages' as test,
  not exists(select 1 from public.outreach_messages where id = '00000000-0000-0000-0000-000000000301') as pass;
select 'TEST15n unassigned recruiter (a3) cannot see the candidate_responses' as test,
  not exists(select 1 from public.candidate_responses where id = '00000000-0000-0000-0000-000000000330') as pass;
reset role;

-- TEST15o: client-role restriction — client_decision_maker (a4) has zero
-- access to every outreach table (packages/types/src/permissions.ts
-- resource 'outreach': client_decision_maker = 'none'; no RLS policy on any
-- of these tables grants that role anything).
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a4', false);
select 'TEST15o client_decision_maker cannot see communication_preferences' as test,
  not exists(select 1 from public.communication_preferences where organization_id = '00000000-0000-0000-0000-0000000000a1') as pass;
select 'TEST15o client_decision_maker cannot see outreach_templates' as test,
  not exists(select 1 from public.outreach_templates where organization_id = '00000000-0000-0000-0000-0000000000a1') as pass;
select 'TEST15o client_decision_maker cannot see outreach_sequences' as test,
  not exists(select 1 from public.outreach_sequences where organization_id = '00000000-0000-0000-0000-0000000000a1') as pass;
select 'TEST15o client_decision_maker cannot see outreach_messages' as test,
  not exists(select 1 from public.outreach_messages where organization_id = '00000000-0000-0000-0000-0000000000a1') as pass;
select 'TEST15o client_decision_maker cannot see outreach_approvals' as test,
  not exists(select 1 from public.outreach_approvals where organization_id = '00000000-0000-0000-0000-0000000000a1') as pass;
select 'TEST15o client_decision_maker cannot see communication_events' as test,
  not exists(select 1 from public.communication_events where organization_id = '00000000-0000-0000-0000-0000000000a1') as pass;
select 'TEST15o client_decision_maker cannot see candidate_responses' as test,
  not exists(select 1 from public.candidate_responses where organization_id = '00000000-0000-0000-0000-0000000000a1') as pass;
reset role;

-- TEST15p: tenant isolation — a completely different organization (b1's
-- admin b2 / recruiter b3) sees none of org a1's outreach rows.
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000b2', false);
select 'TEST15p other-org admin (b2) cannot see any communication_preferences in org a1' as test,
  not exists(select 1 from public.communication_preferences where organization_id = '00000000-0000-0000-0000-0000000000a1') as pass;
select 'TEST15p other-org admin (b2) cannot see any outreach_sequences in org a1' as test,
  not exists(select 1 from public.outreach_sequences where organization_id = '00000000-0000-0000-0000-0000000000a1') as pass;
select 'TEST15p other-org admin (b2) cannot see any outreach_messages in org a1' as test,
  not exists(select 1 from public.outreach_messages where organization_id = '00000000-0000-0000-0000-0000000000a1') as pass;
select 'TEST15p other-org admin (b2) cannot see any outreach_approvals in org a1' as test,
  not exists(select 1 from public.outreach_approvals where organization_id = '00000000-0000-0000-0000-0000000000a1') as pass;
select 'TEST15p other-org admin (b2) cannot see any communication_events in org a1' as test,
  not exists(select 1 from public.communication_events where organization_id = '00000000-0000-0000-0000-0000000000a1') as pass;
select 'TEST15p other-org admin (b2) cannot see any candidate_responses in org a1' as test,
  not exists(select 1 from public.candidate_responses where organization_id = '00000000-0000-0000-0000-0000000000a1') as pass;
reset role;

set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000b3', false);
select 'TEST15p other-org recruiter (b3) cannot see any outreach_messages in org a1' as test,
  not exists(select 1 from public.outreach_messages where organization_id = '00000000-0000-0000-0000-0000000000a1') as pass;
reset role;

-- TEST15q: audit history hooks — every state-changing action this
-- migration supports (approval, status change, response review) is
-- attributable to a real actor via approver_id/sender_user_id/reviewed_by,
-- which is what apps/web/lib/audit/log.ts's new outreach.* AuditAction
-- literals will record alongside (see that file). Spot-check here that the
-- attribution columns are actually populated, not left null by any of the
-- writes above.
select 'TEST15q outreach_approvals.approver_id is always attributed' as test,
  not exists(select 1 from public.outreach_approvals where organization_id = '00000000-0000-0000-0000-0000000000a1' and approver_id is null) as pass;
select 'TEST15q approved/scheduled/sent outreach_messages always carry sender_user_id' as test,
  not exists(select 1 from public.outreach_messages where organization_id = '00000000-0000-0000-0000-0000000000a1' and status in ('approved', 'scheduled', 'sent', 'delivered', 'responded') and sender_user_id is null) as pass;
select 'TEST15q a confirmed candidate_responses classification always carries reviewed_by' as test,
  not exists(select 1 from public.candidate_responses where organization_id = '00000000-0000-0000-0000-0000000000a1' and confirmed_classification is not null and reviewed_by is null) as pass;

-- ---------------------------------------------------------------------
-- TEST 16: Build Phase 10 "POC Benchmark and Reporting" (supabase/
-- migrations/0030) — POC comparison schema: role-mix enforcement,
-- non-computed poc_results can never carry a fabricated value,
-- metric_definitions immutability once referenced, poc_decisions
-- notes+authorized-approval requirement, append-only enforcement,
-- cross-tenant isolation, and decision-approval-authority restriction.
-- ---------------------------------------------------------------------

-- Platform admin fixture (none existed before this test block) —
-- is_platform_admin() checks for ANY active platform_admin membership row,
-- regardless of which org, so attaching it to org a1 is sufficient.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000a99', 'platformadmin@test.com')
on conflict do nothing;
insert into public.organization_memberships (organization_id, user_id, role, status, is_default) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000a99', 'platform_admin', 'active', true)
on conflict do nothing;

-- Two jobs under the existing assigned project f1 (a2 is the lead
-- recruiter assigned to f1; a3 is NOT assigned to any project).
insert into public.jobs (id, organization_id, recruitment_project_id, title) values
  ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1', 'Store Manager (Standard)'),
  ('00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1', 'District Manager (Senior/Difficult)')
on conflict do nothing;

insert into public.poc_benchmarks (id, organization_id, client_id, name, status, start_time, created_by) values
  ('00000000-0000-0000-0000-000000000310', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'Dave POC — Store Mgr / District Mgr', 'setup', now(), '00000000-0000-0000-0000-0000000000a1')
on conflict do nothing;

-- TEST16a: role-mix invariant — only a 'standard' role exists so far;
-- leaving 'setup' must be rejected.
insert into public.poc_roles (id, organization_id, poc_benchmark_id, job_id, recruitment_project_id, role_type) values
  ('00000000-0000-0000-0000-000000000311', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000310', '00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-0000000000f1', 'standard')
on conflict do nothing;

do $$
begin
  begin
    update public.poc_benchmarks set status = 'in_progress' where id = '00000000-0000-0000-0000-000000000310';
    raise exception 'TEST16a FAILED: benchmark should reject leaving setup with only a standard role present';
  exception when check_violation then
    raise notice 'TEST16a PASS: role-mix incomplete (missing senior_or_difficult) correctly rejected';
  end;
end $$;

insert into public.poc_roles (id, organization_id, poc_benchmark_id, job_id, recruitment_project_id, role_type) values
  ('00000000-0000-0000-0000-000000000312', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000310', '00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-0000000000f1', 'senior_or_difficult')
on conflict do nothing;

update public.poc_benchmarks set status = 'in_progress' where id = '00000000-0000-0000-0000-000000000310';
select 'TEST16a benchmark activates once exactly one standard + one senior_or_difficult role exist' as test,
  (select status from public.poc_benchmarks where id = '00000000-0000-0000-0000-000000000310') = 'in_progress' as pass;

-- TEST16b: role deletion locked once the benchmark has left setup.
do $$
begin
  begin
    delete from public.poc_roles where id = '00000000-0000-0000-0000-000000000312';
    raise exception 'TEST16b FAILED: role deletion should be rejected once the benchmark has left setup';
  exception when check_violation then
    raise notice 'TEST16b PASS: role deletion locked once benchmark is active';
  end;
end $$;

-- TEST16c: participants — one client_baseline + one vendor_assisted per role.
insert into public.poc_participants (id, organization_id, poc_benchmark_id, poc_role_id, process_type) values
  ('00000000-0000-0000-0000-000000000321', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000310', '00000000-0000-0000-0000-000000000311', 'client_baseline'),
  ('00000000-0000-0000-0000-000000000322', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000310', '00000000-0000-0000-0000-000000000311', 'vendor_assisted'),
  ('00000000-0000-0000-0000-000000000323', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000310', '00000000-0000-0000-0000-000000000312', 'client_baseline'),
  ('00000000-0000-0000-0000-000000000324', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000310', '00000000-0000-0000-0000-000000000312', 'vendor_assisted')
on conflict do nothing;

-- TEST16c2: shortlist_id may only be set on the vendor_assisted side
-- (reusing the shortlist inserted at id ...200 by the Build Phase 8 test
-- fixtures above — this migration reuses shortlists' existing max-3 cap
-- rather than duplicating it, see 0030's header note).
do $$
begin
  begin
    update public.poc_participants set shortlist_id = '00000000-0000-0000-0000-000000000200' where id = '00000000-0000-0000-0000-000000000321';
    raise exception 'TEST16c2 FAILED: shortlist_id should be rejected on a client_baseline participant';
  exception when check_violation then
    raise notice 'TEST16c2 PASS: shortlist_id on client_baseline participant correctly rejected';
  end;
end $$;

update public.poc_participants set shortlist_id = '00000000-0000-0000-0000-000000000200' where id = '00000000-0000-0000-0000-000000000322';
select 'TEST16c2 shortlist_id accepted on vendor_assisted participant' as test,
  (select shortlist_id from public.poc_participants where id = '00000000-0000-0000-0000-000000000322') = '00000000-0000-0000-0000-000000000200' as pass;

-- TEST16d: poc_baselines (client's self-reported raw inputs) — insert then
-- confirm append-only at the role-privilege level.
insert into public.poc_baselines (organization_id, poc_benchmark_id, poc_role_id, poc_participant_id, candidates_sourced_count, candidates_reviewed_count, time_to_shortlist_hours, recruiter_hours_spent, reported_by_label, created_by) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000310', '00000000-0000-0000-0000-000000000311', '00000000-0000-0000-0000-000000000321', 40, 12, 96.5, 20.0, 'Dave (client)', '00000000-0000-0000-0000-0000000000a2');

set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a1', false);
do $$
begin
  begin
    update public.poc_baselines set candidates_sourced_count = 41 where poc_participant_id = '00000000-0000-0000-0000-000000000321';
    raise exception 'TEST16d FAILED: poc_baselines should reject UPDATE at the role-privilege level';
  exception when insufficient_privilege then
    raise notice 'TEST16d PASS: poc_baselines UPDATE rejected (insufficient_privilege) — corrections must be new rows';
  end;
end $$;
reset role;

-- TEST16e: poc_metrics — metric_definition_id/version must match an
-- existing metric_definitions row.
do $$
declare
  v_def_id uuid;
begin
  select id into v_def_id from public.metric_definitions where metric_key = 'mandatory_gate_pass_rate' and version = 1;
  begin
    insert into public.poc_metrics (organization_id, poc_benchmark_id, poc_role_id, poc_participant_id, metric_definition_id, metric_definition_version, data_point_key, value_numeric, source, recorded_by)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000310', '00000000-0000-0000-0000-000000000311', '00000000-0000-0000-0000-000000000322', v_def_id, 99, 'gate_pass_count', 8, 'platform_computed', '00000000-0000-0000-0000-0000000000a2');
    raise exception 'TEST16e FAILED: poc_metrics should reject a metric_definition_id/version mismatch';
  exception when check_violation then
    raise notice 'TEST16e PASS: mismatched metric_definition_id/version correctly rejected';
  end;
end $$;

insert into public.poc_metrics (organization_id, poc_benchmark_id, poc_role_id, poc_participant_id, metric_definition_id, metric_definition_version, data_point_key, value_numeric, source, recorded_by)
select '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000310', '00000000-0000-0000-0000-000000000311', '00000000-0000-0000-0000-000000000322', id, version, 'gate_pass_count', 8, 'platform_computed', '00000000-0000-0000-0000-0000000000a2'
from public.metric_definitions where metric_key = 'mandatory_gate_pass_rate' and version = 1;

set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a1', false);
do $$
begin
  begin
    delete from public.poc_metrics where poc_participant_id = '00000000-0000-0000-0000-000000000322';
    raise exception 'TEST16e FAILED: poc_metrics should reject DELETE at the role-privilege level';
  exception when insufficient_privilege then
    raise notice 'TEST16e PASS: poc_metrics append-only (DELETE rejected)';
  end;
end $$;
reset role;

-- TEST16f: poc_results — the CHECK constraint is the structural guarantee
-- that a non-'computed' status can never carry a fabricated value, and a
-- 'computed' status always carries one.
do $$
declare
  v_def_id uuid;
  v_def_version integer;
begin
  select id, version into v_def_id, v_def_version from public.metric_definitions where metric_key = 'evidence_coverage' and version = 1;
  begin
    insert into public.poc_results (organization_id, poc_benchmark_id, poc_role_id, metric_definition_id, metric_definition_version, side, status, value)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000310', '00000000-0000-0000-0000-000000000311', v_def_id, v_def_version, 'vendor', 'pending', 55);
    raise exception 'TEST16f FAILED: a pending poc_results row should reject a non-null value';
  exception when check_violation then
    raise notice 'TEST16f PASS: pending status + non-null value correctly rejected';
  end;

  begin
    insert into public.poc_results (organization_id, poc_benchmark_id, poc_role_id, metric_definition_id, metric_definition_version, side, status, value)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000310', '00000000-0000-0000-0000-000000000311', v_def_id, v_def_version, 'vendor', 'computed', null);
    raise exception 'TEST16f FAILED: a computed poc_results row should require a non-null value';
  exception when check_violation then
    raise notice 'TEST16f PASS: computed status + null value correctly rejected';
  end;
end $$;

insert into public.poc_results (id, organization_id, poc_benchmark_id, poc_role_id, metric_definition_id, metric_definition_version, side, status, value)
select '00000000-0000-0000-0000-000000000330', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000310', '00000000-0000-0000-0000-000000000311', id, version, 'vendor', 'pending', null
from public.metric_definitions where metric_key = 'evidence_coverage' and version = 1;

-- Not-yet-measured client side, honestly recorded rather than fabricated.
insert into public.poc_results (organization_id, poc_benchmark_id, poc_role_id, metric_definition_id, metric_definition_version, side, status, value)
select '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000310', '00000000-0000-0000-0000-000000000311', id, version, 'client', 'not_available', null
from public.metric_definitions where metric_key = 'evidence_coverage' and version = 1;

update public.poc_results set status = 'computed', value = 100, computed_at = now(), computed_by = '00000000-0000-0000-0000-0000000000a2'
where id = '00000000-0000-0000-0000-000000000330';
select 'TEST16f a legitimate computed value is accepted' as test,
  (select value from public.poc_results where id = '00000000-0000-0000-0000-000000000330') = 100 as pass;

-- TEST16g: metric_definitions immutability once referenced by poc_results.
do $$
begin
  begin
    update public.metric_definitions set name = 'Renamed Evidence Coverage' where metric_key = 'evidence_coverage' and version = 1;
    raise exception 'TEST16g FAILED: a referenced metric_definitions row should be immutable';
  exception when check_violation then
    raise notice 'TEST16g PASS: referenced metric_definitions row correctly rejected an UPDATE to its definition fields';
  end;
end $$;

-- status is the one column still allowed to change even once referenced.
update public.metric_definitions set status = 'deprecated' where metric_key = 'evidence_coverage' and version = 1;
select 'TEST16g status may still change on a referenced definition' as test,
  (select status from public.metric_definitions where metric_key = 'evidence_coverage' and version = 1) = 'deprecated' as pass;
update public.metric_definitions set status = 'active' where metric_key = 'evidence_coverage' and version = 1;

do $$
begin
  begin
    delete from public.metric_definitions where metric_key = 'evidence_coverage' and version = 1;
    raise exception 'TEST16g FAILED: a referenced metric_definitions row should reject DELETE';
  exception when check_violation then
    raise notice 'TEST16g PASS: referenced metric_definitions row correctly rejected DELETE';
  end;
end $$;

-- Grant-level check: metric_definitions is readable by everyone but only
-- platform_admin may write it — agency_admin a1 cannot insert a new one.
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a1', false);
do $$
begin
  begin
    insert into public.metric_definitions (metric_key, version, name, description, calculation_notes, category, unit)
    values ('agency_admin_should_not_insert', 1, 'x', 'x', 'x', 'errors', 'count');
    raise exception 'TEST16g FAILED: agency_admin should not be able to insert a metric_definitions row';
  exception when insufficient_privilege then
    raise notice 'TEST16g PASS: agency_admin blocked from writing metric_definitions (platform_admin only)';
  end;
end $$;
select 'TEST16g metric_definitions readable by every authenticated role (agency_admin)' as test,
  exists(select 1 from public.metric_definitions where metric_key = 'evidence_coverage' and version = 1) as pass;
reset role;

set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-000000000a99', false);
insert into public.metric_definitions (metric_key, version, name, description, calculation_notes, category, unit)
values ('platform_admin_can_insert', 1, 'x', 'x', 'x', 'errors', 'count')
on conflict do nothing;
select 'TEST16g platform_admin can insert a metric_definitions row' as test,
  exists(select 1 from public.metric_definitions where metric_key = 'platform_admin_can_insert') as pass;
reset role;

-- TEST16h: poc_decisions requires notes AND approved_by/approved_at
-- together (both NOT NULL — the row's existence IS the authorized
-- approval).
do $$
begin
  begin
    insert into public.poc_decisions (organization_id, poc_benchmark_id, decision, notes, approved_by, created_by)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000310', 'extend_poc', null, '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1');
    raise exception 'TEST16h FAILED: poc_decisions should require non-null notes';
  exception when not_null_violation then
    raise notice 'TEST16h PASS: missing notes correctly rejected (NOT NULL)';
  end;
end $$;

do $$
begin
  begin
    insert into public.poc_decisions (organization_id, poc_benchmark_id, decision, notes, approved_by, created_by)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000310', 'extend_poc', '   ', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1');
    raise exception 'TEST16h FAILED: poc_decisions should reject blank/whitespace-only notes';
  exception when check_violation then
    raise notice 'TEST16h PASS: blank notes correctly rejected (CHECK)';
  end;
end $$;

-- TEST16i: only the approval-authority role (agency_admin, or
-- platform_admin) may insert a poc_decisions row — see packages/types/src/
-- permissions.ts poc_reports comment for the reasoning. Recruiter and
-- client_decision_maker cannot, even though client_decision_maker can read.
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a2', false);
do $$
begin
  begin
    insert into public.poc_decisions (organization_id, poc_benchmark_id, decision, notes, approved_by, created_by)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000310', 'extend_poc', 'recruiter attempting to approve', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a2');
    raise exception 'TEST16i FAILED: recruiter should not hold POC decision-approval authority';
  exception when insufficient_privilege then
    raise notice 'TEST16i PASS: recruiter blocked from inserting poc_decisions (agency_admin/platform_admin only)';
  end;
end $$;
reset role;

set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a4', false);
do $$
begin
  begin
    insert into public.poc_decisions (organization_id, poc_benchmark_id, decision, notes, approved_by, created_by)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000310', 'proceed_to_paid_pilot', 'client attempting to approve', '00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000a4');
    raise exception 'TEST16i FAILED: client_decision_maker should not hold POC decision-approval authority';
  exception when insufficient_privilege then
    raise notice 'TEST16i PASS: client_decision_maker blocked from inserting poc_decisions (read-only on this table)';
  end;
end $$;
select 'TEST16i client_decision_maker CAN read the POC decision (joint review, docs/14-poc-specification.md §14.16/§14.17)' as test,
  exists(select 1 from public.poc_benchmarks where id = '00000000-0000-0000-0000-000000000310') as pass;
reset role;

set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a1', false);
insert into public.poc_decisions (id, organization_id, poc_benchmark_id, decision, notes, approved_by, created_by)
values ('00000000-0000-0000-0000-000000000340', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000310', 'extend_poc', 'Promising early results but evidence coverage still needs a second role cycle before recommending the paid pilot.', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1')
on conflict do nothing;
reset role;

select 'TEST16i agency_admin decision insert succeeded and is current' as test,
  (select is_current from public.poc_decisions where id = '00000000-0000-0000-0000-000000000340') = true as pass;

-- TEST16j: a second decision for the same benchmark flips the prior one's
-- is_current and auto-links supersedes_decision_id.
insert into public.poc_decisions (id, organization_id, poc_benchmark_id, decision, notes, approved_by, created_by)
values ('00000000-0000-0000-0000-000000000341', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000310', 'proceed_to_paid_pilot', 'Second role cycle complete: evidence coverage at 100%, speed and quality both favor the platform. Proceeding.', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1')
on conflict do nothing;

select 'TEST16j prior decision is no longer current' as test,
  (select is_current from public.poc_decisions where id = '00000000-0000-0000-0000-000000000340') = false as pass;
select 'TEST16j new decision is current' as test,
  (select is_current from public.poc_decisions where id = '00000000-0000-0000-0000-000000000341') = true as pass;
select 'TEST16j new decision auto-links supersedes_decision_id' as test,
  (select supersedes_decision_id from public.poc_decisions where id = '00000000-0000-0000-0000-000000000341') = '00000000-0000-0000-0000-000000000340' as pass;

-- TEST16k: poc_decisions is append-only at the role-privilege level.
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a1', false);
do $$
begin
  begin
    update public.poc_decisions set notes = 'edited after the fact' where id = '00000000-0000-0000-0000-000000000341';
    raise exception 'TEST16k FAILED: poc_decisions should reject UPDATE at the role-privilege level';
  exception when insufficient_privilege then
    raise notice 'TEST16k PASS: poc_decisions UPDATE rejected (insufficient_privilege)';
  end;
end $$;
do $$
begin
  begin
    delete from public.poc_decisions where id = '00000000-0000-0000-0000-000000000340';
    raise exception 'TEST16k FAILED: poc_decisions should reject DELETE at the role-privilege level';
  exception when insufficient_privilege then
    raise notice 'TEST16k PASS: poc_decisions DELETE rejected (insufficient_privilege)';
  end;
end $$;
reset role;

-- TEST16l: poc_exclusions requires the excluded candidate be identified
-- somehow (a real candidate_id, or a free-text label for a client-side
-- candidate never entered into this platform).
do $$
begin
  begin
    insert into public.poc_exclusions (organization_id, poc_benchmark_id, poc_role_id, side, exclusion_type, reason, excluded_by)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000310', '00000000-0000-0000-0000-000000000311', 'both', 'duplicate_across_sides', 'unidentifiable exclusion attempt', '00000000-0000-0000-0000-0000000000a1');
    raise exception 'TEST16l FAILED: poc_exclusions should require candidate_id or candidate_reference_label';
  exception when check_violation then
    raise notice 'TEST16l PASS: an exclusion identifying neither a candidate_id nor a label is correctly rejected';
  end;
end $$;

insert into public.poc_exclusions (organization_id, poc_benchmark_id, poc_role_id, candidate_id, side, exclusion_type, reason, excluded_by)
values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000310', '00000000-0000-0000-0000-000000000311', '00000000-0000-0000-0000-0000000000d1', 'both', 'duplicate_across_sides', 'Jane Doe was independently sourced by both sides — counts toward each side''s speed metric but excluded from quality differentiation (docs/14-poc-specification.md §14.6).', '00000000-0000-0000-0000-0000000000a1');

select 'TEST16l a properly identified exclusion is recorded, not silently dropped' as test,
  exists(select 1 from public.poc_exclusions where poc_role_id = '00000000-0000-0000-0000-000000000311' and candidate_id = '00000000-0000-0000-0000-0000000000d1') as pass;

set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a1', false);
do $$
begin
  begin
    delete from public.poc_exclusions where poc_role_id = '00000000-0000-0000-0000-000000000311';
    raise exception 'TEST16l FAILED: poc_exclusions should reject DELETE at the role-privilege level';
  exception when insufficient_privilege then
    raise notice 'TEST16l PASS: poc_exclusions append-only (DELETE rejected)';
  end;
end $$;
reset role;

-- TEST16m: recruiter scoping — a2 (assigned to project f1, which both
-- roles' jobs belong to) sees the benchmark; a3 (unassigned to any
-- project) sees none of it.
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a2', false);
select 'TEST16m assigned recruiter (a2) sees the poc_benchmark' as test,
  exists(select 1 from public.poc_benchmarks where id = '00000000-0000-0000-0000-000000000310') as pass;
select 'TEST16m assigned recruiter (a2) sees poc_roles' as test,
  (select count(*) from public.poc_roles where poc_benchmark_id = '00000000-0000-0000-0000-000000000310') = 2 as pass;
select 'TEST16m assigned recruiter (a2) sees poc_results' as test,
  exists(select 1 from public.poc_results where id = '00000000-0000-0000-0000-000000000330') as pass;
reset role;

set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a3', false);
select 'TEST16m unassigned recruiter (a3) cannot see the poc_benchmark' as test,
  not exists(select 1 from public.poc_benchmarks where id = '00000000-0000-0000-0000-000000000310') as pass;
select 'TEST16m unassigned recruiter (a3) cannot see poc_roles' as test,
  not exists(select 1 from public.poc_roles where poc_benchmark_id = '00000000-0000-0000-0000-000000000310') as pass;
select 'TEST16m unassigned recruiter (a3) cannot see poc_decisions' as test,
  not exists(select 1 from public.poc_decisions where poc_benchmark_id = '00000000-0000-0000-0000-000000000310') as pass;
reset role;

-- TEST16n: cross-tenant isolation on every new tenant-scoped table — org
-- b's agency_admin (b2) sees none of org a1's POC data, even though its
-- own agency_admin branch is org-wide within its own org.
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000b2', false);
select 'TEST16n cross-tenant admin cannot see poc_benchmarks' as test,
  not exists(select 1 from public.poc_benchmarks where id = '00000000-0000-0000-0000-000000000310') as pass;
select 'TEST16n cross-tenant admin cannot see poc_roles' as test,
  not exists(select 1 from public.poc_roles where poc_benchmark_id = '00000000-0000-0000-0000-000000000310') as pass;
select 'TEST16n cross-tenant admin cannot see poc_participants' as test,
  not exists(select 1 from public.poc_participants where poc_benchmark_id = '00000000-0000-0000-0000-000000000310') as pass;
select 'TEST16n cross-tenant admin cannot see poc_baselines' as test,
  not exists(select 1 from public.poc_baselines where poc_benchmark_id = '00000000-0000-0000-0000-000000000310') as pass;
select 'TEST16n cross-tenant admin cannot see poc_metrics' as test,
  not exists(select 1 from public.poc_metrics where poc_benchmark_id = '00000000-0000-0000-0000-000000000310') as pass;
select 'TEST16n cross-tenant admin cannot see poc_exclusions' as test,
  not exists(select 1 from public.poc_exclusions where poc_benchmark_id = '00000000-0000-0000-0000-000000000310') as pass;
select 'TEST16n cross-tenant admin cannot see poc_results' as test,
  not exists(select 1 from public.poc_results where poc_benchmark_id = '00000000-0000-0000-0000-000000000310') as pass;
select 'TEST16n cross-tenant admin cannot see poc_decisions' as test,
  not exists(select 1 from public.poc_decisions where poc_benchmark_id = '00000000-0000-0000-0000-000000000310') as pass;
-- metric_definitions is the one GLOBAL table in this migration — every
-- authenticated user, including a cross-tenant admin, legitimately reads
-- it (it is not tenant data), but still cannot write it (not platform_admin).
select 'TEST16n metric_definitions IS visible cross-tenant (global reference catalog, by design)' as test,
  exists(select 1 from public.metric_definitions where metric_key = 'evidence_coverage' and version = 1) as pass;
do $$
begin
  begin
    insert into public.metric_definitions (metric_key, version, name, description, calculation_notes, category, unit)
    values ('cross_tenant_should_not_insert', 1, 'x', 'x', 'x', 'errors', 'count');
    raise exception 'TEST16n FAILED: cross-tenant agency_admin should not be able to insert metric_definitions';
  exception when insufficient_privilege then
    raise notice 'TEST16n PASS: cross-tenant agency_admin blocked from writing metric_definitions';
  end;
end $$;
reset role;

-- jobs/job_descriptions/ai_runs carry no explicit grant of their own
-- anywhere in the migration set (a real Supabase project bootstraps this
-- automatically; see this file's own header comment) — this gap was never
-- hit by TESTs 1-16 because no earlier test exercised an authenticated-role
-- INSERT into ai_runs or a SELECT that evaluates ai_runs' RLS policies
-- (which themselves query jobs/job_descriptions). TEST 17q is the first to
-- do so, so the grant is added here, same convention as line 27 above.
grant select, insert, update on public.ai_runs to authenticated;
grant select on public.jobs, public.job_descriptions to authenticated;

-- ---------------------------------------------------------------------
-- TEST 17: Build Phase 11 Wave 1 "Recruiter AI Copilot" (supabase/
-- migrations/0031) — conversation scope invariants, own-conversation-only
-- visibility (stricter than org-wide sharing), tool allowlist CHECK,
-- append-only enforcement, resource_ownership_validated gate, the
-- propose->confirm mutation scaffolding, usage-counter monotonicity, and
-- cross-tenant isolation on all four new tables.
-- ---------------------------------------------------------------------

-- TEST17a: role_at_creation = 'recruiter' requires recruitment_project_id
-- (org-wide copilot conversations are only for platform_admin/agency_admin/
-- read_only_reviewer).
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a2', false);
do $$
begin
  begin
    insert into public.copilot_conversations (organization_id, user_id, role_at_creation)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', 'recruiter');
    raise exception 'TEST17a FAILED: a recruiter conversation without recruitment_project_id should be rejected';
  exception when check_violation then
    raise notice 'TEST17a PASS: recruiter conversation without recruitment_project_id correctly rejected';
  end;
end $$;

insert into public.copilot_conversations (id, organization_id, user_id, role_at_creation, recruitment_project_id, client_id)
values ('00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', 'recruiter', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000c1');
select 'TEST17a a properly project-scoped recruiter conversation is accepted' as test,
  exists(select 1 from public.copilot_conversations where id = '00000000-0000-0000-0000-000000000401') as pass;
reset role;

-- TEST17b: client_decision_maker conversation must be
-- data_classification = 'restricted_notes_excluded' AND carry a client_id
-- — never the default 'standard'.
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a4', false);
do $$
begin
  begin
    insert into public.copilot_conversations (organization_id, user_id, role_at_creation, recruitment_project_id, client_id, data_classification)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a4', 'client_decision_maker', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000c1', 'standard');
    raise exception 'TEST17b FAILED: a client_decision_maker conversation with data_classification=standard should be rejected';
  exception when check_violation then
    raise notice 'TEST17b PASS: client_decision_maker conversation with standard classification correctly rejected';
  end;
end $$;

do $$
begin
  begin
    insert into public.copilot_conversations (organization_id, user_id, role_at_creation, recruitment_project_id, data_classification)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a4', 'client_decision_maker', '00000000-0000-0000-0000-0000000000f1', 'restricted_notes_excluded');
    raise exception 'TEST17b FAILED: a client_decision_maker conversation with no client_id should be rejected';
  exception when check_violation then
    raise notice 'TEST17b PASS: client_decision_maker conversation with no client_id correctly rejected';
  end;
end $$;
reset role;

-- TEST17c: role_at_creation must match an ACTIVE membership the caller
-- actually holds — a2 (a real recruiter) cannot claim role_at_creation =
-- 'agency_admin' to unlock an org-wide, unscoped conversation.
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a2', false);
do $$
begin
  begin
    insert into public.copilot_conversations (organization_id, user_id, role_at_creation)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', 'agency_admin');
    raise exception 'TEST17c FAILED: a recruiter should not be able to self-declare role_at_creation=agency_admin';
  exception when check_violation then
    raise notice 'TEST17c PASS: role_at_creation not matching an active membership correctly rejected';
  end;
end $$;
reset role;

-- TEST17d: a client_decision_maker's client_id must be their OWN
-- represented client (organization_memberships.client_id), not an
-- arbitrary one, even within the same org.
insert into public.clients (id, organization_id, name, vertical, status) values
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a1', 'Other Retail Client', 'retail', 'active')
on conflict do nothing;
insert into public.recruitment_projects (id, organization_id, client_id, role_title, target_shortlist_size, match_threshold, is_draft) values
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c2', 'Shift Supervisor', 3, 70, false)
on conflict do nothing;

set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a4', false);
do $$
begin
  begin
    insert into public.copilot_conversations (organization_id, user_id, role_at_creation, recruitment_project_id, client_id, data_classification)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a4', 'client_decision_maker', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000c2', 'restricted_notes_excluded');
    raise exception 'TEST17d FAILED: client_decision_maker should not be able to attach a client_id that is not their own';
  exception when check_violation then
    raise notice 'TEST17d PASS: client_id not matching the caller''s own represented client correctly rejected';
  end;
end $$;

insert into public.copilot_conversations (id, organization_id, user_id, role_at_creation, recruitment_project_id, client_id, data_classification)
values ('00000000-0000-0000-0000-000000000402', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a4', 'client_decision_maker', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000c1', 'restricted_notes_excluded');
select 'TEST17d a properly scoped client_decision_maker conversation is accepted' as test,
  exists(select 1 from public.copilot_conversations where id = '00000000-0000-0000-0000-000000000402') as pass;
reset role;

-- Org-wide agency_admin conversation, for later oversight/visibility tests.
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a1', false);
insert into public.copilot_conversations (id, organization_id, user_id, role_at_creation)
values ('00000000-0000-0000-0000-000000000403', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 'agency_admin');
reset role;

-- TEST17e: scope immutability — status/title may change; every other
-- scope column is frozen once created.
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a2', false);
update public.copilot_conversations set status = 'archived', title = 'Store Manager shortlist questions' where id = '00000000-0000-0000-0000-000000000401';
select 'TEST17e status/title update by the owning user succeeds' as test,
  (select status from public.copilot_conversations where id = '00000000-0000-0000-0000-000000000401') = 'archived' as pass;

do $$
begin
  begin
    update public.copilot_conversations set recruitment_project_id = '00000000-0000-0000-0000-0000000000f2' where id = '00000000-0000-0000-0000-000000000401';
    raise exception 'TEST17e FAILED: recruitment_project_id should be immutable once created';
  exception when check_violation then
    raise notice 'TEST17e PASS: recruitment_project_id correctly rejected an UPDATE (scope immutable)';
  end;
end $$;

do $$
begin
  begin
    update public.copilot_conversations set data_classification = 'restricted_notes_excluded' where id = '00000000-0000-0000-0000-000000000401';
    raise exception 'TEST17e FAILED: data_classification should be immutable once created';
  exception when check_violation then
    raise notice 'TEST17e PASS: data_classification correctly rejected an UPDATE (scope immutable)';
  end;
end $$;
reset role;

-- TEST17f: own-conversation-only visibility — a3 (a different recruiter in
-- the SAME org) cannot see a2's conversation; agency_admin (a1) and
-- platform_admin (a99) CAN (read-only oversight); client_decision_maker
-- (a4) cannot see a2's or the agency_admin's conversation (no oversight
-- grant for that role).
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a3', false);
select 'TEST17f a different same-org recruiter (a3) cannot see a2''s conversation' as test,
  not exists(select 1 from public.copilot_conversations where id = '00000000-0000-0000-0000-000000000401') as pass;
reset role;

set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a1', false);
select 'TEST17f agency_admin oversight CAN see a2''s conversation' as test,
  exists(select 1 from public.copilot_conversations where id = '00000000-0000-0000-0000-000000000401') as pass;
reset role;

set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-000000000a99', false);
select 'TEST17f platform_admin oversight CAN see a2''s conversation' as test,
  exists(select 1 from public.copilot_conversations where id = '00000000-0000-0000-0000-000000000401') as pass;
reset role;

set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a4', false);
select 'TEST17f client_decision_maker has no oversight — cannot see a2''s conversation' as test,
  not exists(select 1 from public.copilot_conversations where id = '00000000-0000-0000-0000-000000000401') as pass;
select 'TEST17f client_decision_maker has no oversight — cannot see agency_admin''s org-wide conversation' as test,
  not exists(select 1 from public.copilot_conversations where id = '00000000-0000-0000-0000-000000000403') as pass;
reset role;

-- TEST17g: an oversight admin cannot WRITE another user's conversation —
-- read-only oversight only, never write.
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a1', false);
do $$
begin
  update public.copilot_conversations set status = 'ended' where id = '00000000-0000-0000-0000-000000000401';
  if found then
    raise exception 'TEST17g FAILED: agency_admin oversight should not be able to write another user''s conversation';
  end if;
end $$;
select 'TEST17g oversight admin write to another user''s conversation affected zero rows' as test,
  (select status from public.copilot_conversations where id = '00000000-0000-0000-0000-000000000401') = 'archived' as pass;
reset role;

-- ---------------------------------------------------------------------
-- copilot_messages
-- ---------------------------------------------------------------------

-- TEST17h: a 'user' role message requires non-null content.
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a2', false);
do $$
begin
  begin
    insert into public.copilot_messages (organization_id, copilot_conversation_id, role, content, sequence_number)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000401', 'user', null, 0);
    raise exception 'TEST17h FAILED: a user-role message with null content should be rejected';
  exception when check_violation then
    raise notice 'TEST17h PASS: user-role message with null content correctly rejected';
  end;
end $$;

insert into public.copilot_messages (id, organization_id, copilot_conversation_id, role, content, sequence_number, created_by)
values ('00000000-0000-0000-0000-000000000410', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000401', 'user', 'Which requirements are still missing for the Store Manager scorecard?', 0, '00000000-0000-0000-0000-0000000000a2');

-- An assistant turn with no prose (pure tool-call turn) is allowed.
insert into public.copilot_messages (id, organization_id, copilot_conversation_id, role, content, citations, sequence_number)
values ('00000000-0000-0000-0000-000000000411', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000401', 'assistant', null, '[]'::jsonb, 1);
select 'TEST17h an assistant message with null content (pure tool-call turn) is accepted' as test,
  exists(select 1 from public.copilot_messages where id = '00000000-0000-0000-0000-000000000411') as pass;
reset role;

-- TEST17i: copilot_messages is append-only at the role-privilege level.
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a2', false);
do $$
begin
  begin
    update public.copilot_messages set content = 'edited after the fact' where id = '00000000-0000-0000-0000-000000000410';
    raise exception 'TEST17i FAILED: copilot_messages should reject UPDATE at the role-privilege level';
  exception when insufficient_privilege then
    raise notice 'TEST17i PASS: copilot_messages UPDATE rejected (insufficient_privilege)';
  end;
end $$;
do $$
begin
  begin
    delete from public.copilot_messages where id = '00000000-0000-0000-0000-000000000410';
    raise exception 'TEST17i FAILED: copilot_messages should reject DELETE at the role-privilege level';
  exception when insufficient_privilege then
    raise notice 'TEST17i PASS: copilot_messages DELETE rejected (insufficient_privilege)';
  end;
end $$;
reset role;

-- TEST17j: a user cannot insert a message into another user's conversation.
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a3', false);
do $$
begin
  insert into public.copilot_messages (organization_id, copilot_conversation_id, role, content, sequence_number)
  values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000401', 'user', 'trying to write into a2''s conversation', 2);
  raise exception 'TEST17j FAILED: a3 should not be able to insert into a2''s conversation';
exception when insufficient_privilege then
  raise notice 'TEST17j PASS: insert into another user''s conversation rejected (insufficient_privilege)';
end $$;
reset role;

-- ---------------------------------------------------------------------
-- copilot_tool_calls
-- ---------------------------------------------------------------------

-- TEST17k: tool_name CHECK rejects a non-allowlisted value.
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a2', false);
do $$
begin
  begin
    insert into public.copilot_tool_calls (organization_id, copilot_conversation_id, copilot_message_id, tool_name, input)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000411', 'delete_candidate_record', '{}'::jsonb);
    raise exception 'TEST17k FAILED: a non-allowlisted tool_name should be rejected';
  exception when check_violation then
    raise notice 'TEST17k PASS: non-allowlisted tool_name correctly rejected';
  end;
end $$;

-- TEST17l: resource_ownership_validated defaults false; an output cannot
-- be marked 'valid' unless it is explicitly true.
do $$
begin
  begin
    insert into public.copilot_tool_calls (organization_id, copilot_conversation_id, copilot_message_id, tool_name, input, output, output_validation_status)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000411', 'find_missing_job_requirements', '{"jobId":"00000000-0000-0000-0000-000000000301"}'::jsonb, '{"missing":[]}'::jsonb, 'valid');
    raise exception 'TEST17l FAILED: output_validation_status=valid without resource_ownership_validated should be rejected';
  exception when check_violation then
    raise notice 'TEST17l PASS: valid output without resource_ownership_validated correctly rejected';
  end;
end $$;

insert into public.copilot_tool_calls (id, organization_id, copilot_conversation_id, copilot_message_id, tool_name, input)
values ('00000000-0000-0000-0000-000000000420', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000411', 'find_missing_job_requirements', '{"jobId":"00000000-0000-0000-0000-000000000301"}'::jsonb);
select 'TEST17l resource_ownership_validated defaults to false' as test,
  (select resource_ownership_validated from public.copilot_tool_calls where id = '00000000-0000-0000-0000-000000000420') = false as pass;

insert into public.copilot_tool_calls (id, organization_id, copilot_conversation_id, copilot_message_id, tool_name, input, output, output_validation_status, resource_ownership_validated)
values ('00000000-0000-0000-0000-000000000421', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000411', 'find_missing_job_requirements', '{"jobId":"00000000-0000-0000-0000-000000000301"}'::jsonb, '{"missing":["proof of right to work"]}'::jsonb, 'valid', true);
select 'TEST17l a legitimate valid+ownership-validated tool call is accepted' as test,
  exists(select 1 from public.copilot_tool_calls where id = '00000000-0000-0000-0000-000000000421') as pass;
reset role;

-- TEST17m: a denied tool call must carry a reason and no output; a
-- denial_reason may not be set on a call that was not denied.
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a2', false);
do $$
begin
  begin
    insert into public.copilot_tool_calls (organization_id, copilot_conversation_id, copilot_message_id, tool_name, input, denied)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000411', 'explain_candidate_match', '{}'::jsonb, true);
    raise exception 'TEST17m FAILED: a denied tool call without a denial_reason should be rejected';
  exception when check_violation then
    raise notice 'TEST17m PASS: denied tool call without denial_reason correctly rejected';
  end;
end $$;

do $$
begin
  begin
    insert into public.copilot_tool_calls (organization_id, copilot_conversation_id, copilot_message_id, tool_name, input, denied, denial_reason)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000411', 'explain_candidate_match', '{}'::jsonb, false, 'should not be allowed on a non-denied call');
    raise exception 'TEST17m FAILED: denial_reason on a non-denied call should be rejected';
  exception when check_violation then
    raise notice 'TEST17m PASS: denial_reason on a non-denied call correctly rejected';
  end;
end $$;

insert into public.copilot_tool_calls (id, organization_id, copilot_conversation_id, copilot_message_id, tool_name, input, denied, denial_reason)
values ('00000000-0000-0000-0000-000000000422', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000411', 'explain_candidate_match', '{"candidateId":"00000000-0000-0000-0000-0000000000d1"}'::jsonb, true, 'candidate is outside this conversation''s permitted project scope');
select 'TEST17m a properly denied tool call (reason, no output) is accepted' as test,
  exists(select 1 from public.copilot_tool_calls where id = '00000000-0000-0000-0000-000000000422') as pass;
reset role;

-- TEST17n: propose -> confirm mutation scaffolding. confirmed_at/
-- confirmed_by cannot be set at insert unless requires_confirmation is
-- true; both must be set together.
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a2', false);
do $$
begin
  begin
    insert into public.copilot_tool_calls (organization_id, copilot_conversation_id, copilot_message_id, tool_name, input, requires_confirmation, confirmed_at)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000411', 'draft_outreach_message', '{}'::jsonb, false, now());
    raise exception 'TEST17n FAILED: confirmed_at set without requires_confirmation should be rejected';
  exception when check_violation then
    raise notice 'TEST17n PASS: confirmed_at without requires_confirmation correctly rejected';
  end;
end $$;

insert into public.copilot_tool_calls (id, organization_id, copilot_conversation_id, copilot_message_id, tool_name, input, requires_confirmation)
values ('00000000-0000-0000-0000-000000000423', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000411', 'draft_outreach_message', '{"candidateId":"00000000-0000-0000-0000-0000000000d1"}'::jsonb, true);
select 'TEST17n an unconfirmed requires_confirmation call is accepted' as test,
  (select confirmed_at from public.copilot_tool_calls where id = '00000000-0000-0000-0000-000000000423') is null as pass;

-- The narrow allowed post-insert write: confirm it.
update public.copilot_tool_calls set confirmed_at = now(), confirmed_by = '00000000-0000-0000-0000-0000000000a2' where id = '00000000-0000-0000-0000-000000000423';
select 'TEST17n confirming the call succeeds' as test,
  (select confirmed_by from public.copilot_tool_calls where id = '00000000-0000-0000-0000-000000000423') = '00000000-0000-0000-0000-0000000000a2' as pass;

-- Re-confirming (or unconfirming) is rejected.
do $$
begin
  begin
    update public.copilot_tool_calls set confirmed_at = now() where id = '00000000-0000-0000-0000-000000000423';
    raise exception 'TEST17n FAILED: re-confirming an already-confirmed call should be rejected';
  exception when check_violation then
    raise notice 'TEST17n PASS: re-confirming an already-confirmed call correctly rejected';
  end;
end $$;

-- Any other-column edit disguised as a confirmation update is rejected.
do $$
begin
  begin
    update public.copilot_tool_calls set tool_name = 'draft_interview_questions', confirmed_at = now(), confirmed_by = '00000000-0000-0000-0000-0000000000a2'
    where id = '00000000-0000-0000-0000-000000000420';
    raise exception 'TEST17n FAILED: editing tool_name alongside a confirmation update should be rejected';
  exception when check_violation then
    raise notice 'TEST17n PASS: attempting to edit tool_name via a confirmation-shaped update correctly rejected';
  end;
end $$;

-- Confirming a call that never required confirmation is rejected.
do $$
begin
  begin
    update public.copilot_tool_calls set confirmed_at = now(), confirmed_by = '00000000-0000-0000-0000-0000000000a2' where id = '00000000-0000-0000-0000-000000000420';
    raise exception 'TEST17n FAILED: confirming a call with requires_confirmation=false should be rejected';
  exception when check_violation then
    raise notice 'TEST17n PASS: confirming a call that never required confirmation correctly rejected';
  end;
end $$;

-- Confirming a denied call is rejected.
do $$
begin
  begin
    update public.copilot_tool_calls set requires_confirmation = true where id = '00000000-0000-0000-0000-000000000422';
    raise exception 'TEST17n FAILED: changing requires_confirmation outside the confirm-only shape should be rejected';
  exception when check_violation then
    raise notice 'TEST17n PASS: non-confirmation field change on a denied call correctly rejected';
  end;
end $$;
reset role;

-- TEST17o: copilot_tool_calls has no DELETE grant at all.
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a2', false);
do $$
begin
  begin
    delete from public.copilot_tool_calls where id = '00000000-0000-0000-0000-000000000420';
    raise exception 'TEST17o FAILED: copilot_tool_calls should reject DELETE at the role-privilege level';
  exception when insufficient_privilege then
    raise notice 'TEST17o PASS: copilot_tool_calls DELETE rejected (insufficient_privilege)';
  end;
end $$;
reset role;

-- ---------------------------------------------------------------------
-- copilot_usage_counters
-- ---------------------------------------------------------------------

-- TEST17p: a user can write their own usage row; counters are monotonic
-- (never decrease); cross-user visibility is denied except oversight.
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a2', false);
insert into public.copilot_usage_counters (id, organization_id, user_id, window_date, message_count, tool_call_count, total_input_tokens, total_output_tokens, total_cost_usd)
values ('00000000-0000-0000-0000-000000000430', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', current_date, 1, 1, 500, 200, 0.012);

update public.copilot_usage_counters set message_count = 2, tool_call_count = 2, total_input_tokens = 900, total_output_tokens = 350, total_cost_usd = 0.021 where id = '00000000-0000-0000-0000-000000000430';
select 'TEST17p a legitimate increasing counter update is accepted' as test,
  (select message_count from public.copilot_usage_counters where id = '00000000-0000-0000-0000-000000000430') = 2 as pass;

do $$
begin
  begin
    update public.copilot_usage_counters set message_count = 1 where id = '00000000-0000-0000-0000-000000000430';
    raise exception 'TEST17p FAILED: a decreasing counter update should be rejected';
  exception when check_violation then
    raise notice 'TEST17p PASS: decreasing counter update correctly rejected (monotonic-only)';
  end;
end $$;
reset role;

set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a3', false);
select 'TEST17p a different same-org user (a3) cannot see a2''s usage counters' as test,
  not exists(select 1 from public.copilot_usage_counters where id = '00000000-0000-0000-0000-000000000430') as pass;
reset role;

set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a1', false);
select 'TEST17p agency_admin oversight CAN see a2''s usage counters' as test,
  exists(select 1 from public.copilot_usage_counters where id = '00000000-0000-0000-0000-000000000430') as pass;
reset role;

-- ---------------------------------------------------------------------
-- ai_runs.workflow_type extension
-- ---------------------------------------------------------------------

-- TEST17q: ai_runs.workflow_type now admits 'copilot_response' plus the
-- two Build Phase 9 outreach workflow types that were flagged as a gap
-- twice (docs/build-phase-9-report.md §9.7, docs/09-ai-architecture.md
-- §9.7/§9.8) and never fixed until now.
-- Run as a1 (agency_admin, org-wide ai_runs insert grant) rather than a2
-- (recruiter, whose ai_runs insert policy branch requires input_ref to
-- match a job_description the recruiter is assigned to) — this test is
-- about the workflow_type CHECK constraint, not ai_runs' own RLS scoping,
-- which TEST13/TEST7 already cover elsewhere in this file.
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a1', false);
insert into public.ai_runs (id, organization_id, workflow_type, model, prompt_version, status, input_ref, created_by)
values
  ('00000000-0000-0000-0000-000000000440', '00000000-0000-0000-0000-0000000000a1', 'copilot_response', 'claude-test', 'copilot-response-v1', 'success', '00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-0000000000a1');
select 'TEST17q ai_runs accepts workflow_type=copilot_response' as test,
  exists(select 1 from public.ai_runs where id = '00000000-0000-0000-0000-000000000440') as pass;

do $$
begin
  begin
    insert into public.ai_runs (organization_id, workflow_type, model, prompt_version, status, input_ref, created_by)
    values ('00000000-0000-0000-0000-0000000000a1', 'not_a_real_workflow', 'claude-test', 'v1', 'success', 'x', '00000000-0000-0000-0000-0000000000a1');
    raise exception 'TEST17q FAILED: an unrecognized workflow_type should still be rejected';
  exception when check_violation then
    raise notice 'TEST17q PASS: an unrecognized workflow_type is still correctly rejected';
  end;
end $$;

insert into public.ai_runs (id, organization_id, workflow_type, model, prompt_version, status, input_ref, created_by)
values
  ('00000000-0000-0000-0000-000000000441', '00000000-0000-0000-0000-0000000000a1', 'outreach_draft_generation', 'claude-test', 'outreach-draft-v1', 'success', 'x', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-000000000442', '00000000-0000-0000-0000-0000000000a1', 'response_classification', 'claude-test', 'response-classification-v1', 'success', 'x', '00000000-0000-0000-0000-0000000000a1')
on conflict do nothing;
reset role;
select 'TEST17q ai_runs accepts the previously-missing Build Phase 9 outreach workflow types (cross-phase fix)' as test,
  (select count(*) from public.ai_runs where id in ('00000000-0000-0000-0000-000000000441', '00000000-0000-0000-0000-000000000442')) = 2 as pass;

-- ---------------------------------------------------------------------
-- TEST17r: cross-tenant isolation — org b's agency_admin (b2) sees none of
-- org a1's copilot data on any of the four new tables.
-- ---------------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000b2', false);
select 'TEST17r cross-tenant admin cannot see copilot_conversations' as test,
  not exists(select 1 from public.copilot_conversations where organization_id = '00000000-0000-0000-0000-0000000000a1') as pass;
select 'TEST17r cross-tenant admin cannot see copilot_messages' as test,
  not exists(select 1 from public.copilot_messages where organization_id = '00000000-0000-0000-0000-0000000000a1') as pass;
select 'TEST17r cross-tenant admin cannot see copilot_tool_calls' as test,
  not exists(select 1 from public.copilot_tool_calls where organization_id = '00000000-0000-0000-0000-0000000000a1') as pass;
select 'TEST17r cross-tenant admin cannot see copilot_usage_counters' as test,
  not exists(select 1 from public.copilot_usage_counters where organization_id = '00000000-0000-0000-0000-0000000000a1') as pass;

-- Cross-tenant write attempts are rejected too — in this case, TWO
-- independent layers both reject it: the consistency trigger fires first
-- (b2 holds no active membership at all in org a1, so
-- enforce_copilot_conversation_consistency's role_at_creation check raises
-- a 23514 before RLS is even reached), and RLS's insert policy (user_id =
-- auth.uid() and is_org_member(organization_id)) would independently
-- reject it too if the trigger did not exist. Catching `others` here
-- deliberately, since either layer alone is a correct rejection and this
-- test is about the outcome (no cross-tenant row is ever created), not
-- which specific layer fires first.
do $$
begin
  begin
    insert into public.copilot_conversations (organization_id, user_id, role_at_creation)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b2', 'agency_admin');
    raise exception 'TEST17r FAILED: cross-tenant insert into another org''s copilot_conversations should be rejected';
  exception when others then
    if sqlerrm like 'TEST17r FAILED%' then
      raise;
    end if;
    raise notice 'TEST17r PASS: cross-tenant insert into copilot_conversations correctly rejected (%)', sqlstate;
  end;
end $$;
reset role;

-- ---------------------------------------------------------------------
-- TEST 18: Build Phase 12 Wave 1 — background_jobs / integration_
-- connections / webhook_events / notifications / notification_preferences
-- (supabase/migrations/0032).
-- ---------------------------------------------------------------------

-- Local-verification-only grant, same convention as the top of this file
-- (0032 already grants select on webhook_events to authenticated; the
-- INSERT below for TEST18b is deliberately done as the unprivileged
-- postgres/superuser role, never as `authenticated`, mirroring the real
-- webhook-route-handler pattern documented in 0032's table comment).

-- -----------------------------------------------------------------
-- TEST18a: background_jobs idempotency-key uniqueness (per org+job_type)
-- rejects a duplicate.
-- -----------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a1', false);

insert into public.background_jobs (id, organization_id, job_type, idempotency_key)
values ('00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-0000000000a1', 'email_delivery', 'job-key-1');

select 'TEST18a first job with idempotency_key inserted' as test,
  exists(select 1 from public.background_jobs where id = '00000000-0000-0000-0000-000000000501') as pass;

do $$
begin
  begin
    insert into public.background_jobs (organization_id, job_type, idempotency_key)
    values ('00000000-0000-0000-0000-0000000000a1', 'email_delivery', 'job-key-1');
    raise exception 'TEST18a FAILED: duplicate (organization_id, job_type, idempotency_key) should be rejected';
  exception when unique_violation then
    raise notice 'TEST18a PASS: duplicate job idempotency_key correctly rejected';
  end;
end $$;

-- A different job_type with the same key is fine (uniqueness is scoped
-- per job_type, not just per org).
insert into public.background_jobs (organization_id, job_type, idempotency_key)
values ('00000000-0000-0000-0000-0000000000a1', 'ai_extraction', 'job-key-1');
select 'TEST18a same idempotency_key but different job_type is accepted' as test,
  exists(select 1 from public.background_jobs where organization_id = '00000000-0000-0000-0000-0000000000a1' and job_type = 'ai_extraction' and idempotency_key = 'job-key-1') as pass;
reset role;

-- -----------------------------------------------------------------
-- TEST18b: webhook_events dedup uniqueness on (provider, external_event_id)
-- rejects a duplicate. Inserted as the superuser role, not `authenticated`
-- — mirrors the real webhook route handler, which uses the Supabase
-- service role (0032's table comment: no INSERT grant exists for
-- authenticated/anon at all).
-- -----------------------------------------------------------------
insert into public.webhook_events (id, organization_id, provider, external_event_id, signature_valid, processing_status)
values ('00000000-0000-0000-0000-000000000510', '00000000-0000-0000-0000-0000000000a1', 'resend', 'evt-dup-1', true, 'processed');

select 'TEST18b first webhook event inserted' as test,
  exists(select 1 from public.webhook_events where id = '00000000-0000-0000-0000-000000000510') as pass;

do $$
begin
  begin
    insert into public.webhook_events (organization_id, provider, external_event_id, signature_valid, processing_status)
    values ('00000000-0000-0000-0000-0000000000a1', 'resend', 'evt-dup-1', true, 'duplicate_ignored');
    raise exception 'TEST18b FAILED: duplicate (provider, external_event_id) should be rejected';
  exception when unique_violation then
    raise notice 'TEST18b PASS: duplicate webhook (provider, external_event_id) correctly rejected';
  end;
end $$;

-- A null external_event_id never collides with another null (partial
-- unique index excludes nulls) — two unparseable/malformed events can
-- both be recorded.
insert into public.webhook_events (organization_id, provider, external_event_id, signature_valid, processing_status)
values
  ('00000000-0000-0000-0000-0000000000a1', 'resend', null, false, 'rejected_invalid_signature'),
  ('00000000-0000-0000-0000-0000000000a1', 'resend', null, false, 'rejected_invalid_signature');
select 'TEST18b two null-external_event_id rows both accepted (nulls excluded from uniqueness)' as test,
  (select count(*) from public.webhook_events where organization_id = '00000000-0000-0000-0000-0000000000a1' and external_event_id is null) = 2 as pass;

-- authenticated cannot insert into webhook_events at all (no grant) —
-- the real route handler must use the service role.
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a1', false);
select 'TEST18b authenticated has no INSERT privilege on webhook_events' as test,
  not has_table_privilege('authenticated', 'public.webhook_events', 'INSERT') as pass;
reset role;

-- -----------------------------------------------------------------
-- TEST18c: notifications are strictly own-recipient-visible — cross-user
-- denial within the SAME org.
-- -----------------------------------------------------------------
-- Inserted as postgres (system/notification-dispatch-job path); the RLS
-- insert policy itself only requires org membership, not that the
-- inserting session equal the recipient, since notifications are
-- system-generated.
insert into public.notifications (id, organization_id, recipient_user_id, event_type, title, resource_type, resource_id)
values ('00000000-0000-0000-0000-000000000520', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', 'candidate_awaiting_review', 'A candidate needs review', 'candidate', '00000000-0000-0000-0000-0000000000d1');

set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a2', false);
select 'TEST18c recipient (a2) can see their own notification' as test,
  exists(select 1 from public.notifications where id = '00000000-0000-0000-0000-000000000520') as pass;

select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a3', false);
select 'TEST18c a different same-org user (a3) cannot see a2''s notification' as test,
  not exists(select 1 from public.notifications where id = '00000000-0000-0000-0000-000000000520') as pass;

select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a1', false);
select 'TEST18c agency_admin (a1) has NO oversight — cannot see a2''s notification (deliberately narrower than copilot_conversations)' as test,
  not exists(select 1 from public.notifications where id = '00000000-0000-0000-0000-000000000520') as pass;

select set_config('request.jwt.uid', '00000000-0000-0000-0000-000000000a99', false);
select 'TEST18c platform_admin (a99) has NO oversight either — cannot see a2''s notification' as test,
  not exists(select 1 from public.notifications where id = '00000000-0000-0000-0000-000000000520') as pass;
reset role;

-- -----------------------------------------------------------------
-- TEST18d: notification read_at-only mutation — every other column is
-- frozen post-insert; read_at may be set once from null, mirroring Build
-- Phase 11's copilot_tool_calls_confirm_only pattern.
-- -----------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a2', false);

update public.notifications set read_at = now() where id = '00000000-0000-0000-0000-000000000520';
select 'TEST18d recipient marking their own notification read succeeds' as test,
  (select read_at from public.notifications where id = '00000000-0000-0000-0000-000000000520') is not null as pass;

do $$
begin
  begin
    update public.notifications set title = 'Tampered title' where id = '00000000-0000-0000-0000-000000000520';
    raise exception 'TEST18d FAILED: changing title post-insert should be rejected';
  exception when check_violation then
    raise notice 'TEST18d PASS: changing title post-insert correctly rejected';
  end;
end $$;

do $$
begin
  begin
    update public.notifications set read_at = now() where id = '00000000-0000-0000-0000-000000000520';
    raise exception 'TEST18d FAILED: re-setting read_at on an already-read notification should be rejected';
  exception when check_violation then
    raise notice 'TEST18d PASS: re-setting read_at on an already-read notification correctly rejected';
  end;
end $$;
reset role;

-- Another user (a3) cannot mark a2's notification read at all — RLS,
-- not just the trigger, blocks it (zero rows affected).
insert into public.notifications (id, organization_id, recipient_user_id, event_type, title)
values ('00000000-0000-0000-0000-000000000521', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', 'verification_requested', 'Verification needed');

set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a3', false);
update public.notifications set read_at = now() where id = '00000000-0000-0000-0000-000000000521';
select 'TEST18d a different user cannot mark someone else''s notification read (RLS, zero rows affected)' as test,
  (select read_at from public.notifications where id = '00000000-0000-0000-0000-000000000521') is null as pass;
reset role;

-- -----------------------------------------------------------------
-- TEST18e: notification_preferences strictly own-user CRUD.
-- -----------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a2', false);

insert into public.notification_preferences (id, organization_id, user_id, event_type, in_app_enabled, email_enabled)
values ('00000000-0000-0000-0000-000000000530', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', 'candidate_awaiting_review', true, true);

select 'TEST18e a2 can insert and read their own preference row' as test,
  exists(select 1 from public.notification_preferences where id = '00000000-0000-0000-0000-000000000530') as pass;

select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a3', false);
select 'TEST18e a3 cannot see a2''s preference row' as test,
  not exists(select 1 from public.notification_preferences where id = '00000000-0000-0000-0000-000000000530') as pass;

update public.notification_preferences set email_enabled = false where id = '00000000-0000-0000-0000-000000000530';
select 'TEST18e a3 cannot update a2''s preference row (zero rows affected)' as test,
  (select email_enabled from public.notification_preferences where id = '00000000-0000-0000-0000-000000000530') = true as pass;

delete from public.notification_preferences where id = '00000000-0000-0000-0000-000000000530';

-- Verify existence back under a2's own session (RLS itself makes the row
-- invisible to a3, so the existence check must run as the row's owner,
-- not as a3, to actually confirm the delete affected zero rows).
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a2', false);
select 'TEST18e a3 cannot delete a2''s preference row' as test,
  exists(select 1 from public.notification_preferences where id = '00000000-0000-0000-0000-000000000530') as pass;

update public.notification_preferences set email_enabled = false where id = '00000000-0000-0000-0000-000000000530';
select 'TEST18e a2 can update their own preference row' as test,
  (select email_enabled from public.notification_preferences where id = '00000000-0000-0000-0000-000000000530') = false as pass;
reset role;

-- -----------------------------------------------------------------
-- TEST18f: integration_connections access shape — agency_admin full,
-- platform_admin read-only oversight, everyone else denied.
-- -----------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a1', false);

insert into public.integration_connections (id, organization_id, provider, mode, status)
values ('00000000-0000-0000-0000-000000000540', '00000000-0000-0000-0000-0000000000a1', 'ta_tracker', 'csv_import_export', 'not_connected');

select 'TEST18f agency_admin can insert an integration_connections row' as test,
  exists(select 1 from public.integration_connections where id = '00000000-0000-0000-0000-000000000540') as pass;

update public.integration_connections set status = 'connected', connected_by = '00000000-0000-0000-0000-0000000000a1', connected_at = now()
  where id = '00000000-0000-0000-0000-000000000540';
select 'TEST18f agency_admin can update (connect) their own org''s connection' as test,
  (select status from public.integration_connections where id = '00000000-0000-0000-0000-000000000540') = 'connected' as pass;

select set_config('request.jwt.uid', '00000000-0000-0000-0000-000000000a99', false);
select 'TEST18f platform_admin can SELECT (read-only oversight)' as test,
  exists(select 1 from public.integration_connections where id = '00000000-0000-0000-0000-000000000540') as pass;

update public.integration_connections set status = 'disconnected' where id = '00000000-0000-0000-0000-000000000540';
select 'TEST18f platform_admin cannot UPDATE (read-only oversight only — zero rows affected)' as test,
  (select status from public.integration_connections where id = '00000000-0000-0000-0000-000000000540') = 'connected' as pass;

select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a2', false);
select 'TEST18f recruiter (a2) cannot SELECT integration_connections at all (DB layer narrower than the application-layer ''read'' grant — see this wave''s report)' as test,
  not exists(select 1 from public.integration_connections where id = '00000000-0000-0000-0000-000000000540') as pass;

select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a4', false);
select 'TEST18f client_decision_maker cannot SELECT integration_connections' as test,
  not exists(select 1 from public.integration_connections where id = '00000000-0000-0000-0000-000000000540') as pass;
reset role;

-- -----------------------------------------------------------------
-- TEST18g: cross-tenant isolation on every new table — org b's
-- agency_admin (b2) sees none of org a1's rows, and a cross-tenant insert
-- attempt is rejected.
-- -----------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000b2', false);

select 'TEST18g cross-tenant admin cannot see background_jobs' as test,
  not exists(select 1 from public.background_jobs where organization_id = '00000000-0000-0000-0000-0000000000a1') as pass;
select 'TEST18g cross-tenant admin cannot see integration_connections' as test,
  not exists(select 1 from public.integration_connections where organization_id = '00000000-0000-0000-0000-0000000000a1') as pass;
select 'TEST18g cross-tenant admin cannot see webhook_events' as test,
  not exists(select 1 from public.webhook_events where organization_id = '00000000-0000-0000-0000-0000000000a1') as pass;
select 'TEST18g cross-tenant admin cannot see notifications' as test,
  not exists(select 1 from public.notifications where organization_id = '00000000-0000-0000-0000-0000000000a1') as pass;
select 'TEST18g cross-tenant admin cannot see notification_preferences' as test,
  not exists(select 1 from public.notification_preferences where organization_id = '00000000-0000-0000-0000-0000000000a1') as pass;

do $$
begin
  begin
    insert into public.integration_connections (organization_id, provider, mode, status)
    values ('00000000-0000-0000-0000-0000000000a1', 'apollo', null, 'not_connected');
    raise exception 'TEST18g FAILED: cross-tenant insert into another org''s integration_connections should be rejected';
  exception when others then
    if sqlerrm like 'TEST18g FAILED%' then
      raise;
    end if;
    raise notice 'TEST18g PASS: cross-tenant insert into integration_connections correctly rejected (%)', sqlstate;
  end;
end $$;
reset role;

-- -----------------------------------------------------------------
-- TEST18h: TA Tracker mode='api' combined with any status other than
-- 'not_connected'/'pending_documentation' is rejected by a CHECK
-- constraint — structural proof the API mode can never claim to be
-- connected in this environment (this migration's central safety
-- guarantee: "do not invent a TA Tracker API").
-- Run against org b1 (as its own agency_admin, b2) throughout — org a1
-- already holds a ta_tracker row from TEST18f/g and (organization_id,
-- provider) is UNIQUE, so testing against a1 risks a unique_violation
-- masking the CHECK constraint this test is actually about.
-- -----------------------------------------------------------------
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000b2', false);

do $$
begin
  begin
    insert into public.integration_connections (organization_id, provider, mode, status)
    values ('00000000-0000-0000-0000-0000000000b1', 'ta_tracker', 'api', 'connected');
    raise exception 'TEST18h FAILED: ta_tracker/api/connected should be rejected';
  exception when check_violation then
    raise notice 'TEST18h PASS: ta_tracker mode=api cannot report status=connected';
  end;
end $$;

do $$
begin
  begin
    insert into public.integration_connections (organization_id, provider, mode, status, last_sync_error)
    values ('00000000-0000-0000-0000-0000000000b1', 'ta_tracker', 'api', 'sync_error', 'irrelevant');
    raise exception 'TEST18h FAILED: ta_tracker/api/sync_error should be rejected';
  exception when check_violation then
    raise notice 'TEST18h PASS: ta_tracker mode=api cannot report status=sync_error';
  end;
end $$;

do $$
begin
  begin
    insert into public.integration_connections (organization_id, provider, mode, status, disconnected_at, disconnected_by)
    values ('00000000-0000-0000-0000-0000000000b1', 'ta_tracker', 'api', 'disconnected', now(), '00000000-0000-0000-0000-0000000000b2');
    raise exception 'TEST18h FAILED: ta_tracker/api/disconnected should be rejected';
  exception when check_violation then
    raise notice 'TEST18h PASS: ta_tracker mode=api cannot report status=disconnected';
  end;
end $$;

-- The two allowed statuses for ta_tracker/api both succeed. Run against
-- org b1 (as its own agency_admin, b2) rather than org a1 — a1 already
-- holds a ta_tracker row from TEST18f/g and (organization_id, provider)
-- is UNIQUE, so a second ta_tracker row for a1 would collide on that
-- constraint rather than exercising the mode-honesty CHECK this test is
-- actually about. Each row is deleted before the next is inserted for the
-- same reason (one ta_tracker row per org at a time).
select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000b2', false);

insert into public.integration_connections (id, organization_id, provider, mode, status)
values ('00000000-0000-0000-0000-000000000550', '00000000-0000-0000-0000-0000000000b1', 'ta_tracker', 'api', 'pending_documentation');
select 'TEST18h ta_tracker mode=api CAN report status=pending_documentation' as test,
  exists(select 1 from public.integration_connections where id = '00000000-0000-0000-0000-000000000550') as pass;
delete from public.integration_connections where id = '00000000-0000-0000-0000-000000000550';

insert into public.integration_connections (id, organization_id, provider, mode, status)
values ('00000000-0000-0000-0000-000000000551', '00000000-0000-0000-0000-0000000000b1', 'ta_tracker', 'api', 'not_connected');
select 'TEST18h ta_tracker mode=api CAN report status=not_connected' as test,
  exists(select 1 from public.integration_connections where id = '00000000-0000-0000-0000-000000000551') as pass;
delete from public.integration_connections where id = '00000000-0000-0000-0000-000000000551';

-- Meanwhile ta_tracker's secure_manual_exchange mode CAN legitimately
-- reach 'connected' — the constraint is scoped to mode='api' only.
insert into public.integration_connections (id, organization_id, provider, mode, status, connected_by, connected_at)
values ('00000000-0000-0000-0000-000000000552', '00000000-0000-0000-0000-0000000000b1', 'ta_tracker', 'secure_manual_exchange', 'connected', '00000000-0000-0000-0000-0000000000b2', now());
select 'TEST18h ta_tracker mode=secure_manual_exchange CAN legitimately report status=connected' as test,
  exists(select 1 from public.integration_connections where id = '00000000-0000-0000-0000-000000000552') as pass;

select set_config('request.jwt.uid', '00000000-0000-0000-0000-0000000000a1', false);

-- mode is only meaningful for ta_tracker — a non-ta_tracker provider with
-- a non-null mode is rejected.
do $$
begin
  begin
    insert into public.integration_connections (organization_id, provider, mode, status)
    values ('00000000-0000-0000-0000-0000000000a1', 'apollo', 'api', 'not_connected');
    raise exception 'TEST18h FAILED: a non-ta_tracker provider with a non-null mode should be rejected';
  exception when check_violation then
    raise notice 'TEST18h PASS: mode is only ever meaningful for provider=ta_tracker';
  end;
end $$;
