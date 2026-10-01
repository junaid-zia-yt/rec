-- 0002_organizations.sql
-- docs/07-data-model.md §7.1 (`organizations`) — the tenant root.

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) > 0),
  plan text not null default 'trial',
  suspended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.organizations is
  'Tenant root (one recruitment agency). docs/07-data-model.md §7.1.';

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists organizations_set_updated_at on public.organizations;
create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

alter table public.organizations enable row level security;

-- Writes are platform-admin-only per docs/07-data-model.md §7.1 ("RLS:
-- Platform-admin-only writes"). is_platform_admin() is defined in 0004 (it
-- depends on organization_memberships); this policy is created there
-- instead of here so every tenant table's RLS ships in its own migration
-- (§21.7) without a forward reference to a function that does not exist yet.
-- A member of an org may read their own org's row.
create policy organizations_select_own_org
  on public.organizations
  for select
  using (id = public.current_org_id());
