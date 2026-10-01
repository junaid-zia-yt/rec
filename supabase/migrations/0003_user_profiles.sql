-- 0003_user_profiles.sql
-- docs/07-data-model.md §7.1 (`user_profiles`) — 1:1 with auth.users.

create table if not exists public.user_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  avatar_url text,
  status text not null default 'active' check (status in ('active', 'deactivated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.user_profiles is
  'Person record, 1:1 with auth.users. docs/07-data-model.md §7.1. PII: full_name, avatar_url.';

drop trigger if exists user_profiles_set_updated_at on public.user_profiles;
create trigger user_profiles_set_updated_at
  before update on public.user_profiles
  for each row execute function public.set_updated_at();

alter table public.user_profiles enable row level security;

-- A user may always read/update their own profile.
create policy user_profiles_select_self
  on public.user_profiles
  for select
  using (id = auth.uid());

create policy user_profiles_update_self
  on public.user_profiles
  for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- Org-admin visibility (docs/06-roles-permissions.md §6.2: Agency Admin has
-- F on Users within their own org) is added in 0004_organization_memberships.sql
-- once is_org_member()/has_org_role() exist, so that policy can be scoped to
-- "same organization, not just any authenticated user."

-- ---------------------------------------------------------------------------
-- handle_new_user() — creates a user_profiles row automatically whenever a
-- new auth.users row is inserted (i.e. on sign-up / invite acceptance), so
-- application code never has to remember to do this as a second step.
-- full_name is seeded from raw_user_meta_data->>'full_name' when the
-- sign-up call supplied it (e.g. via an invitation-acceptance form),
-- otherwise left blank — never invented.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
