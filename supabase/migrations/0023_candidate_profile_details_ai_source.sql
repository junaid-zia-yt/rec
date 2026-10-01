-- Build Phase 6: allow AI-applied candidate_experiences/_education/
-- _certifications/_skills rows to record their true origin.
--
-- docs/build-phase-5-report.md's candidate_skills comment already
-- anticipated this ("source will gain an 'ai' value once AI CV parsing
-- exists — schema is already shaped for that") but the inline CHECK
-- constraints on all four tables only ever allowed ('manual', 'csv_import')
-- — this migration is the small schema change that comment promised.
--
-- 'ai' rows are only ever created by the human "Accept all verified
-- fields" / per-field accept action in
-- apps/web/lib/candidates/document-processing-actions.ts, AFTER a human
-- has reviewed and verified/edited the corresponding
-- candidate_extracted_fields row (Build Phase 6 brief §HUMAN CONTROL:
-- "AI-extracted data must remain pending until reviewed or explicitly
-- accepted") — never written directly from an AI provider response.

alter table public.candidate_experiences
  drop constraint if exists candidate_experiences_source_check;
alter table public.candidate_experiences
  add constraint candidate_experiences_source_check check (source in ('manual', 'csv_import', 'ai'));

alter table public.candidate_education
  drop constraint if exists candidate_education_source_check;
alter table public.candidate_education
  add constraint candidate_education_source_check check (source in ('manual', 'csv_import', 'ai'));

alter table public.candidate_certifications
  drop constraint if exists candidate_certifications_source_check;
alter table public.candidate_certifications
  add constraint candidate_certifications_source_check check (source in ('manual', 'csv_import', 'ai'));

alter table public.candidate_skills
  drop constraint if exists candidate_skills_source_check;
alter table public.candidate_skills
  add constraint candidate_skills_source_check check (source in ('manual', 'csv_import', 'ai'));
