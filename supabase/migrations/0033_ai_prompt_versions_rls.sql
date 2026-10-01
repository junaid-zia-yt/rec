-- 0033_ai_prompt_versions_rls.sql
-- Build Phase 14 (Security Hardening), Wave 1 — CRITICAL fix.
--
-- FINDING: 0017_ai_runs.sql created public.ai_prompt_versions with RLS
-- deliberately left OFF, on the stated assumption (0017's own table
-- comment, restated in 0030's metric_definitions comment) that "no
-- RLS/no grants" is equivalent to "service-role-only access". That
-- assumption is wrong for a real Supabase project: Supabase's standard
-- project bootstrap grants the `anon`/`authenticated` roles SELECT,
-- INSERT, UPDATE, DELETE on every table in the `public` schema via
-- schema-level default privileges, independent of whether RLS is ever
-- enabled on a given table. RLS being OFF does not withdraw those grants
-- — it only means there is no row-level policy narrowing them, so with
-- RLS off the grant applies unrestricted to every row.
--
-- Net effect prior to this migration: ANY authenticated user, in ANY
-- tenant organization, holding ANY role (including the lowest-privilege
-- read_only_reviewer/client_decision_maker), could read AND OVERWRITE
-- every row in ai_prompt_versions — including `template`, the literal
-- prompt text sent to the model for every organization's requirement
-- extraction / candidate matching / copilot runs. This is a cross-tenant
-- integrity break with a direct line to the project's AI-safety core
-- rules (#3 "AI must never invent candidate qualifications", #10 "every
-- AI action must be auditable") — a single compromised or malicious
-- low-privilege account in one tenant could rewrite the shared prompt
-- template and silently alter AI behavior for every other tenant on the
-- platform. Classified CRITICAL (crosses the tenant boundary via a
-- write path, not just a read).
--
-- FIX: enable RLS and add the same real-policy shape 0030 already used
-- for metric_definitions (another shared, non-tenant-owned platform
-- catalog) instead of relying on "no RLS" ever meaning "no access"
-- again — read-only to every authenticated user (ai_runs.prompt_version
-- rows need to resolve against this table for any org to explain an AI
-- result), write restricted to platform_admin only.

alter table public.ai_prompt_versions enable row level security;

-- Same shape as 0030's metric_definitions: RLS `using (true)` for select
-- (read access is actually bounded by the table GRANT below, restricted to
-- `authenticated` only — never `anon` — mirroring every other migration's
-- grant convention since 0007), write restricted to platform_admin by RLS.
create policy ai_prompt_versions_select_all_authenticated
  on public.ai_prompt_versions
  for select
  using (true);

create policy ai_prompt_versions_insert_platform_admin
  on public.ai_prompt_versions
  for insert
  with check (public.is_platform_admin());

create policy ai_prompt_versions_update_platform_admin
  on public.ai_prompt_versions
  for update
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy ai_prompt_versions_delete_platform_admin
  on public.ai_prompt_versions
  for delete
  using (public.is_platform_admin());

grant select on public.ai_prompt_versions to authenticated;
grant insert, update, delete on public.ai_prompt_versions to authenticated;

comment on table public.ai_prompt_versions is
  'Versioned prompt template store (docs/09-ai-architecture.md). Not tenant data (no organization_id) — a platform-level shared asset, read-only to every authenticated user, write restricted to platform_admin (0033; supersedes 0017''s no-RLS/no-grants approach, which relied on an incorrect assumption about Supabase''s default public-schema grants).';
