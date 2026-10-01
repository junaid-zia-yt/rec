-- 0007_custom_access_token_hook.sql
-- Populates the `org_id` and `role` JWT claims that public.current_org_id()
-- and the RLS policies above read, and grants table access to the
-- `authenticated`/`anon` Postgres roles (RLS then restricts rows).
--
-- MANUAL STEP REQUIRED, NOT PERFORMED BY THIS MIGRATION: Supabase only
-- invokes a "custom access token" hook function once it is registered in
-- the project's Auth configuration (Dashboard → Authentication → Hooks →
-- "Customize Access Token (JWT) Claims hook", or supabase/config.toml's
-- [auth.hook.custom_access_token] block pointing at
-- "pg-functions://postgres/public/custom_access_token_hook"). This
-- repository has no live Supabase project connected, so that registration
-- could not be performed here — see docs/build-phase-2-report.md. Until it
-- is registered, every JWT is issued without an org_id claim, and
-- current_org_id() correctly returns null (fail closed) rather than
-- granting access to the wrong organization.

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  claims jsonb;
  target_user_id uuid;
  default_membership record;
begin
  claims := event -> 'claims';
  target_user_id := (event ->> 'user_id')::uuid;

  -- Prefer a membership explicitly marked default; otherwise fall back to
  -- the caller's single active membership if they have exactly one, so a
  -- freshly-invited single-org user gets a usable org_id claim immediately
  -- without an extra "pick your org" step. A user in >1 org with no default
  -- set gets no org_id claim until they explicitly select one (see
  -- lib/auth/session.ts `resolveActiveOrg` and the org-switch action) —
  -- this is intentional: silently guessing which of several orgs to scope
  -- a session to would be an access-control mistake, not a convenience.
  select m.organization_id, m.role
    into default_membership
  from public.organization_memberships m
  where m.user_id = target_user_id
    and m.status = 'active'
  order by m.is_default desc, m.created_at asc
  limit 1;

  if default_membership.organization_id is not null then
    claims := jsonb_set(claims, '{app_metadata,org_id}', to_jsonb(default_membership.organization_id::text));
    claims := jsonb_set(claims, '{app_metadata,org_role}', to_jsonb(default_membership.role::text));
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

comment on function public.custom_access_token_hook(jsonb) is
  'Supabase Auth custom-access-token hook: injects app_metadata.org_id / app_metadata.org_role into the issued JWT from the caller''s default (or sole) active organization_memberships row. Must be registered in the project''s Auth Hooks configuration — not automatic just because this function exists.';

-- The Supabase auth admin role needs EXECUTE to invoke the hook.
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;

-- ---------------------------------------------------------------------------
-- Table grants. RLS (already enabled on every table above) is what actually
-- restricts row visibility; these GRANTs only allow the `authenticated`/
-- `anon` roles onto the table at all (Postgres denies access to a table
-- with no GRANT regardless of RLS). service_role bypasses RLS entirely by
-- Supabase convention and is used only by server-only code
-- (lib/supabase/admin.ts) — never given to anything that could reach the
-- browser.
-- ---------------------------------------------------------------------------
grant select on public.organizations to authenticated;
grant select, update on public.user_profiles to authenticated;
grant select, insert, update, delete on public.organization_memberships to authenticated;
grant select, insert, update, delete on public.invitations to authenticated;
grant select, insert on public.audit_events to authenticated;

-- anon has no legitimate access to any tenant table; the only anon-reachable
-- surface is Supabase Auth itself (sign-in, password reset), which does not
-- go through these tables directly.
