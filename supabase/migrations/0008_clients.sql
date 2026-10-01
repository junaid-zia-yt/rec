-- 0008_clients.sql
-- docs/07-data-model.md §7.1 (`clients`) — end-client companies an agency
-- recruits for. Build Phase 3 brief §"Client management".

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(btrim(name)) > 0),
  vertical text not null default '',
  primary_contact_name text,
  primary_contact_email text,
  primary_contact_phone text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  archived_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.clients is
  'End-client companies (docs/07-data-model.md §7.1). PII sensitivity: contact fields.';

create index if not exists clients_organization_id_idx on public.clients (organization_id);
create index if not exists clients_organization_name_idx on public.clients (organization_id, lower(name));

drop trigger if exists clients_set_updated_at on public.clients;
create trigger clients_set_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();

-- Client Decision-Maker access is scoped to a single client, never org-wide
-- (docs/06-roles-permissions.md §6.3). That link lives on the membership
-- row, not on the client, since one client can have several reviewer
-- contacts and one user only ever represents one client at a time.
alter table public.organization_memberships
  add column if not exists client_id uuid references public.clients (id) on delete set null;

comment on column public.organization_memberships.client_id is
  'Set only for client_decision_maker memberships: which client this reviewer represents. Never org-wide even for that role. docs/06-roles-permissions.md §6.3.';

alter table public.clients enable row level security;

-- Agency Admin: F, Recruiter: F, Read-Only Reviewer: R (docs/06 §6.2) — all
-- org-scoped. Client Decision-Maker: R, but only their own client record.
create policy clients_select_scoped
  on public.clients
  for select
  using (
    public.is_platform_admin()
    or public.has_org_role(
      organization_id,
      array['agency_admin', 'recruiter', 'read_only_reviewer']::public.app_role[]
    )
    or (
      public.has_org_role(organization_id, array['client_decision_maker']::public.app_role[])
      and id = (
        select m.client_id
        from public.organization_memberships m
        where m.user_id = auth.uid()
          and m.organization_id = clients.organization_id
          and m.status = 'active'
        limit 1
      )
    )
  );

create policy clients_write_agency_recruiter
  on public.clients
  for all
  using (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin', 'recruiter']::public.app_role[])
  )
  with check (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin', 'recruiter']::public.app_role[])
  );
