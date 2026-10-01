-- 00_stub_supabase_auth.sql
--
-- NOT a Supabase migration and never applied to a real Supabase project —
-- a real Supabase Postgres instance already provides a real `auth` schema
-- (GoTrue-managed `auth.users`, real `auth.uid()`/`auth.jwt()`) and this
-- file must never run there. It exists solely so `supabase/migrations/**`
-- (which reference `auth.users`, `auth.uid()`, `auth.jwt()` throughout,
-- starting with 0001_extensions_and_helpers.sql's `current_org_id()`) and
-- `scripts/verify_candidates.sql` (which does
-- `select set_config('request.jwt.uid', '<uuid>', false)` to switch
-- simulated identity, then `set role authenticated`) can be applied and
-- exercised against a throwaway, vanilla Postgres 16 instance — in CI, or
-- a developer's own local Postgres — with nothing else installed.
--
-- This is the same minimal auth/storage schema stand-in this repository's
-- prior build phases have used for their own local `psql`-against-
-- fresh-Postgres verification runs (see docs/build-phase-11-report.md §4:
-- "the two non-migration stub files (00_stub_supabase_auth.sql,
-- 01_stub_storage.sql — a minimal auth/storage schema stand-in for local
-- Postgres)"). It is committed here, instead of being recreated by hand
-- each time, specifically so `.github/workflows/migration-validation.yml`
-- can run it non-interactively.
--
-- `auth.uid()` here intentionally reads the custom `request.jwt.uid` GUC
-- that verify_candidates.sql itself sets (not the standard Supabase local
-- dev stack's `request.jwt.claims` GUC) — this mirrors the exact mechanism
-- this repo's own verification script already depends on, not a generic
-- Supabase-CLI-local-dev auth stub.

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- authenticated / anon roles: real Supabase Postgres ships these by
-- default; a vanilla Postgres instance does not, and
-- scripts/verify_candidates.sql's own grants (and every migration's RLS
-- policies, which target `to authenticated`) require them to exist.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

-- The migration-applying role (and verify_candidates.sql's own grant
-- statements) need permission to GRANT privileges to `authenticated`/
-- `anon`, and `set role authenticated` requires membership.
do $$
begin
  execute format('grant authenticated to %I', current_user);
  execute format('grant anon to %I', current_user);
  execute format('grant service_role to %I', current_user);
end
$$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.uid', true), '')::uuid;
$$;

-- current_org_id() (0001_extensions_and_helpers.sql) calls auth.jwt() for
-- the org_id app_metadata claim, but no RLS policy in this codebase
-- actually depends on that claim being populated locally — org membership
-- is derived from `organization_memberships` joined on auth.uid()
-- (public.is_org_member()/has_org_role(), 0004_organization_memberships.sql)
-- instead, exactly so RLS keeps working before the real JWT hook is wired
-- up in a live project. This stub returns an empty object so
-- current_org_id() resolves to null (fails closed) rather than erroring.
create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select '{}'::jsonb;
$$;

grant usage on schema auth to authenticated, anon, service_role;
grant select on auth.users to authenticated, anon, service_role;
