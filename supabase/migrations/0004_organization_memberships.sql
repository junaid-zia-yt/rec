-- 0004_organization_memberships.sql
-- docs/07-data-model.md §7.1 (`organization_memberships`) — user↔org↔role join.
-- This is the single source of truth for "who has what role in which org" —
-- role is never trusted from anywhere else (never a browser-supplied field,
-- never auth.users metadata alone), per docs/12-security-compliance.md §12.3
-- and the Build Phase 2 brief's "Do not trust role values sent by the browser."

create table if not exists public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.app_role not null,
  status text not null default 'active' check (status in ('active', 'revoked')),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

comment on table public.organization_memberships is
  'User x org x role join — the sole source of truth for role-based access. docs/07-data-model.md §7.1, docs/12-security-compliance.md §12.3.';

create index if not exists organization_memberships_user_id_idx
  on public.organization_memberships (user_id)
  where status = 'active';

drop trigger if exists organization_memberships_set_updated_at on public.organization_memberships;
create trigger organization_memberships_set_updated_at
  before update on public.organization_memberships
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Authorization helper functions. Every one is STABLE + SECURITY DEFINER so
-- it can read organization_memberships regardless of the calling policy's
-- own RLS visibility, without granting the caller broader table access.
-- ---------------------------------------------------------------------------

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_memberships m
    where m.user_id = auth.uid()
      and m.role = 'platform_admin'
      and m.status = 'active'
  );
$$;

comment on function public.is_platform_admin() is
  'True only when the caller has an active platform_admin membership row.';

create or replace function public.is_org_member(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_memberships m
    where m.user_id = auth.uid()
      and m.organization_id = target_org
      and m.status = 'active'
  );
$$;

comment on function public.is_org_member(uuid) is
  'True only when the caller has an active membership (any role) in target_org.';

create or replace function public.has_org_role(target_org uuid, allowed_roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_memberships m
    where m.user_id = auth.uid()
      and m.organization_id = target_org
      and m.status = 'active'
      and m.role = any(allowed_roles)
  );
$$;

comment on function public.has_org_role(uuid, public.app_role[]) is
  'True only when the caller has an active membership in target_org whose role is in allowed_roles.';

alter table public.organization_memberships enable row level security;

-- A member can see the membership rows for orgs they belong to (needed to
-- render "who's on my team"); platform_admin can see all, for support only.
create policy organization_memberships_select_own_org
  on public.organization_memberships
  for select
  using (
    public.is_org_member(organization_id)
    or public.is_platform_admin()
  );

-- Only an agency_admin (or platform_admin) may create/update/revoke
-- memberships in their own org — matches docs/06-roles-permissions.md §6.2
-- ("Users: F (own org)" for Agency Admin, "R (own org)" for everyone else).
create policy organization_memberships_admin_write
  on public.organization_memberships
  for all
  using (
    public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
    or public.is_platform_admin()
  )
  with check (
    public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
    or public.is_platform_admin()
  );

-- ---------------------------------------------------------------------------
-- Now that is_platform_admin()/is_org_member() exist, add the two policies
-- deferred from earlier migrations (kept here, not retrofitted into 0002/
-- 0003, because a migration file must never be edited after it has shipped —
-- docs/21-implementation-contract.md §21.7 treats every migration as
-- append-only history).
-- ---------------------------------------------------------------------------

create policy organizations_admin_write
  on public.organizations
  for all
  using (public.is_platform_admin() or public.has_org_role(id, array['agency_admin']::public.app_role[]))
  with check (public.is_platform_admin() or public.has_org_role(id, array['agency_admin']::public.app_role[]));

create policy user_profiles_select_same_org
  on public.user_profiles
  for select
  using (
    exists (
      select 1
      from public.organization_memberships mine
      join public.organization_memberships theirs
        on theirs.organization_id = mine.organization_id
      where mine.user_id = auth.uid()
        and mine.status = 'active'
        and theirs.user_id = public.user_profiles.id
        and theirs.status = 'active'
    )
  );
