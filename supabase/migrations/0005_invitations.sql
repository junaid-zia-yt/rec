-- 0005_invitations.sql
-- docs/07-data-model.md §7.1 (`invitations`) — pending org invites.
-- Public self-registration is explicitly out of scope for this build
-- (Build Phase 2 brief §3); the only way into an organization is an
-- invitation created by an agency_admin (or platform_admin) and accepted by
-- the invited person.

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role public.app_role not null,
  invited_by uuid not null references auth.users (id),
  token uuid not null default gen_random_uuid(),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, email, status) deferrable initially immediate
);

comment on table public.invitations is
  'Pending/accepted invitations into an organization. No public self-registration path exists — invitations are the only entry point. docs/07-data-model.md §7.1.';

comment on column public.invitations.token is
  'Opaque bearer token embedded in the invitation link. Never logged or echoed back in an error message; treated as a credential.';

drop trigger if exists invitations_set_updated_at on public.invitations;
create trigger invitations_set_updated_at
  before update on public.invitations
  for each row execute function public.set_updated_at();

alter table public.invitations enable row level security;

-- Only agency_admin (own org) or platform_admin may create/manage invitations.
create policy invitations_admin_manage
  on public.invitations
  for all
  using (
    public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
    or public.is_platform_admin()
  )
  with check (
    public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
    or public.is_platform_admin()
  );

-- The invited person looks up their own invitation by matching JWT email —
-- this is intentionally the only "read across org boundary" case in the
-- schema, and it is scoped to exactly one row (their own pending invite),
-- never the full invitations list of an org they are not yet a member of.
create policy invitations_select_own_pending
  on public.invitations
  for select
  using (
    lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and status = 'pending'
  );
