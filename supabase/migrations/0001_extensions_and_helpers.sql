-- 0001_extensions_and_helpers.sql
-- Build Phase 2 — docs/21-implementation-contract.md §21.7/§21.8,
-- docs/07-data-model.md §7.3, docs/12-security-compliance.md §12.1.
--
-- Extensions, the role enum, and the JWT-claim helper functions that every
-- later table's RLS policy depends on. Nothing here is tenant data, so there
-- is no RLS policy in this file (§21.7 requires RLS only on tables that
-- touch tenant data).

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Role enum (docs/06-roles-permissions.md §6.1). Matches packages/types'
-- `UserRole` Zod enum exactly (docs/21-implementation-contract.md §21.4 —
-- naming must not drift between the DB and the shared TypeScript types).
-- `client_decision_maker` is the client-facing "Client Reviewer"/"Client
-- Decision-Maker" role referenced under both names across the docs set;
-- this is the canonical spelling because it is what docs/06, docs/07, and
-- the already-shipped packages/types/src/index.ts (`UserRole`) use.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum (
      'platform_admin',
      'agency_admin',
      'recruiter',
      'client_decision_maker',
      'read_only_reviewer'
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- current_org_id() — reads the `org_id` custom claim from the caller's JWT
-- (docs/07-data-model.md §7.3, docs/21-implementation-contract.md §21.8).
--
-- The claim itself is populated by a Supabase Auth "custom access token"
-- hook (public.custom_access_token_hook, defined below) that must be wired
-- up in the Supabase project's Auth settings (Dashboard → Authentication →
-- Hooks, or supabase/config.toml's [auth.hook.custom_access_token] block)
-- once a live project exists — this repository has no live Supabase project
-- connected, so that wiring could not be performed or verified here. Until
-- the hook is enabled, `org_id` is simply absent from every JWT and
-- current_org_id() returns null, which every RLS policy below treats as "no
-- access" (fail closed), never "all access".
-- ---------------------------------------------------------------------------
create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select nullif(
    coalesce(
      auth.jwt() -> 'app_metadata' ->> 'org_id',
      auth.jwt() ->> 'org_id'
    ),
    ''
  )::uuid;
$$;

comment on function public.current_org_id() is
  'Active organization id from the caller''s JWT app_metadata claim, or null if unset. Fails closed: RLS policies must never treat a null current_org_id() as "match everything".';

-- is_platform_admin() / is_org_member() / has_org_role() are defined in
-- 0004_organization_memberships.sql, since they query that table and a
-- LANGUAGE SQL function's body is validated against real catalog objects at
-- CREATE FUNCTION time — it must be created only after its table exists.
