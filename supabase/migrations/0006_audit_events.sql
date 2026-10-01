-- 0006_audit_events.sql
-- docs/07-data-model.md §7.1/§7.7 (`audit_events`) — immutable, append-only
-- action log. docs/21-implementation-contract.md §21.7 requires this ship
-- with its RLS in the same migration; §7.7 requires UPDATE/DELETE revoked
-- at the database role level, not just application logic.

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  actor_id uuid references auth.users (id),
  action text not null,
  entity_type text not null,
  entity_id text,
  before_json jsonb,
  after_json jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.audit_events is
  'Append-only audit log. Every AI action, score, approval and change must be auditable (project core rule #10). docs/07-data-model.md §7.7.';

comment on column public.audit_events.action is
  'Verb-first action name, e.g. auth.sign_in, auth.sign_out, invitation.created, invitation.accepted, membership.role_changed, membership.disabled.';

create index if not exists audit_events_organization_id_idx
  on public.audit_events (organization_id, created_at desc);

create index if not exists audit_events_actor_id_idx
  on public.audit_events (actor_id, created_at desc);

alter table public.audit_events enable row level security;

-- Agency Admin: R (own org). Recruiter: R (own actions). Read-Only Reviewer:
-- R (own org). Platform Admin: R (all orgs). docs/06-roles-permissions.md §6.2.
create policy audit_events_select_own_org
  on public.audit_events
  for select
  using (
    public.is_platform_admin()
    or (organization_id is not null and public.is_org_member(organization_id))
  );

-- Inserts happen via the server-side audit-logging helper, authenticated as
-- the acting user (never anonymous) so actor_id is always trustworthy.
create policy audit_events_insert_own_org
  on public.audit_events
  for insert
  with check (
    actor_id = auth.uid()
    and (organization_id is null or public.is_org_member(organization_id))
  );

-- Append-only at the database-role level: no UPDATE or DELETE grant exists
-- for any non-superuser role, including the authenticated/anon roles RLS
-- would otherwise gate. This is enforced independently of RLS so that even
-- a future RLS policy mistake cannot make this table mutable.
revoke update, delete on public.audit_events from authenticated, anon;
