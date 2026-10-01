-- 0031_copilot.sql
-- Build Phase 11 ("Recruiter AI Copilot"), Wave 1 — DB + types + permissions
-- foundation. docs/09-ai-architecture.md §9.2 row 17 ("Recruiter copilot...
-- Answer recruiter questions about a project/candidate using only data
-- already in the platform (RAG over the org's own records)... advisory,
-- cites its sources... cannot answer -> says so, never fabricates a
-- citation") is the one place this workflow was previously sketched; this
-- migration is the first real implementation of its storage layer.
--
-- GOVERNING BRIEF (verbatim, abbreviated): a permission-aware, evidence-
-- grounded copilot that may summarize/explain/draft/suggest but MUST NOT
-- make the final hiring decision, alter candidate records without
-- confirmation, override mandatory gates, approve outreach, submit a
-- shortlist, reveal cross-tenant data, reveal hidden recruiter notes to
-- clients, or invent evidence. This wave builds the schema that makes as
-- many of those guarantees as possible hold at the database layer, not just
-- in the orchestration code the next three waves add on top of it.
--
-- FOUR new tables, in dependency order:
--
--   copilot_conversations   -- one row per chat thread. Carries the
--                               conversation's entire authorized SCOPE as a
--                               snapshot at creation time (organization,
--                               role_at_creation, client_id/
--                               recruitment_project_id, data_classification)
--                               so retrieval can never silently widen later
--                               even if the user's real role or assignments
--                               change mid-conversation. See "SCOPE SNAPSHOT,
--                               NOT LIVE LOOKUP" below.
--   copilot_messages         -- one turn (user/assistant/system_note),
--                               append-only, carrying `citations` — the
--                               brief's "citations to authorized records"
--                               mechanism.
--   copilot_tool_calls       -- one tool invocation inside an assistant
--                               turn: allowlisted tool_name (CHECK), the
--                               structured input actually sent, the
--                               (validated) output, and
--                               `resource_ownership_validated` — the brief's
--                               "validate resource ownership on every tool
--                               call" made into a recorded, auditable fact
--                               rather than a trusted claim. Append-only
--                               except for one narrow, trigger-enforced
--                               confirm step (see below).
--   copilot_usage_counters   -- persisted, auditable rate-limit/cost state
--                               per (org, user, day) — chosen over an
--                               in-memory limiter because this is a
--                               Vercel/serverless stack (docs/17-deployment-
--                               operations.md) where in-memory state does
--                               not survive a cold start or span instances.
--
-- SCOPE SNAPSHOT, NOT LIVE LOOKUP (judgment call, flagged for later waves):
-- `role_at_creation`, `client_id` and `recruitment_project_id` are captured
-- once, at INSERT, and are then immutable for the life of the conversation
-- (enforced by a trigger below). A user's org role, project assignments or
-- client membership can change after a conversation starts; this design
-- means an EXISTING conversation's authorized scope never silently widens
-- to match a new, broader role — the retrieval engine (wave 2) MUST always
-- additionally re-check the user's CURRENT permissions on every message
-- (a role can also have been narrowed or revoked since creation, which this
-- snapshot alone cannot catch), but it must never trust a conversation's
-- snapshot to still reflect reality without that live re-check. This is
-- documented here so wave 2 does not mistake the snapshot for a substitute
-- for live authorization.
--
-- HIDDEN RECRUITER NOTES (brief: "reveal hidden recruiter notes to
-- clients" is a MUST NOT): the concrete field this refers to is
-- `candidate_profiles.recruiter_notes` (supabase/migrations/0018,
-- deliberately split from `client_visible_notes` and excluded from any
-- client-facing payload at the application layer per docs/06-roles-
-- permissions.md §6.2.3). This migration cannot redact a column by itself
-- (RLS is row-level, not column-level — the same limitation noted for
-- `candidate_profiles` itself); what it CAN do, and does, is (1) force
-- every `client_decision_maker` conversation's `data_classification` to
-- `'restricted_notes_excluded'` by CHECK constraint (never
-- `'standard'`), so the retrieval engine has a machine-checkable signal it
-- cannot forget to branch on, and (2) require every such conversation to be
-- pinned to one project AND one client (never org-wide), narrowing the
-- retrieval surface as far as the schema can. The actual field-level
-- redaction of `recruiter_notes` before it ever reaches a prompt is wave
-- 2's job, in the retrieval/tool layer — this is the same division of
-- labor docs/06-roles-permissions.md §6.2.3 already established for the
-- ordinary candidate-profile read path (column redaction is application-
-- layer, RLS is row-level only).
--
-- Calculation/orchestration logic, the actual Claude tool-calling loop, the
-- retrieval/RAG engine, and all UI are explicitly OUT OF SCOPE for this
-- migration — waves 2-4's job. This migration only lays the schema +
-- deterministic guardrails those waves must operate inside of.

-- ---------------------------------------------------------------------------
-- copilot_conversations
-- ---------------------------------------------------------------------------

create table if not exists public.copilot_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Snapshot of the org role the user held when this conversation was
  -- created — see "SCOPE SNAPSHOT, NOT LIVE LOOKUP" in this migration's
  -- header. Intentionally the same five-value app_role domain used
  -- everywhere else, not a bespoke enum.
  role_at_creation public.app_role not null,
  -- The permitted scope this conversation is confined to. Nullable
  -- (org-wide) only for roles whose base permission grant is itself
  -- org-wide (platform_admin/agency_admin/read_only_reviewer) — see the
  -- copilot_conversations_scope_by_role CHECK below, which forces a
  -- recruiter or client_decision_maker conversation to always be pinned to
  -- one project, so retrieval can never wander into a different project
  -- that user happens to also have access to elsewhere.
  client_id uuid references public.clients (id) on delete cascade,
  recruitment_project_id uuid references public.recruitment_projects (id) on delete cascade,
  -- The mechanism the brief's "data classification" scoping and "redact
  -- unauthorized fields" requirement hangs off. 'restricted_notes_excluded'
  -- is mandatory (never 'standard') for a client_decision_maker
  -- conversation — see copilot_conversations_client_role_restricted below
  -- and this migration's "HIDDEN RECRUITER NOTES" header note.
  data_classification text not null default 'standard'
    check (data_classification in ('standard', 'restricted_notes_excluded')),
  status text not null default 'active'
    check (status in ('active', 'archived', 'ended')),
  -- Optional user-facing label ("Store Manager shortlist questions"); never
  -- interpreted as instructions or fed back into a prompt as anything other
  -- than inert display text.
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A recruiter/client_decision_maker conversation must be pinned to a real
  -- project (the brief's "organization and project scoping"); the org-wide
  -- roles may start an unscoped (org-wide) conversation.
  constraint copilot_conversations_scope_by_role check (
    (role_at_creation in ('recruiter', 'client_decision_maker') and recruitment_project_id is not null)
    or (role_at_creation in ('platform_admin', 'agency_admin', 'read_only_reviewer'))
  ),
  -- Client-role conversations are always the narrow, client-notes-excluded
  -- classification and always tied to a specific client — never org-wide,
  -- never the default 'standard' classification a recruiter/admin gets.
  constraint copilot_conversations_client_role_restricted check (
    role_at_creation <> 'client_decision_maker'
    or (data_classification = 'restricted_notes_excluded' and client_id is not null)
  )
);

comment on table public.copilot_conversations is
  'One row per recruiter-copilot chat thread (Build Phase 11 brief). Carries the conversation''s authorized scope as an immutable snapshot (role_at_creation/client_id/recruitment_project_id/data_classification) taken at creation and locked by copilot_conversations_scope_immutable below — never silently widened by a later role change. See this migration''s header notes for the full reasoning, including why this snapshot is not a substitute for a live permission re-check on every message.';

create index if not exists copilot_conversations_org_user_idx
  on public.copilot_conversations (organization_id, user_id, created_at desc);
create index if not exists copilot_conversations_project_idx
  on public.copilot_conversations (recruitment_project_id) where recruitment_project_id is not null;

drop trigger if exists copilot_conversations_set_updated_at on public.copilot_conversations;
create trigger copilot_conversations_set_updated_at
  before update on public.copilot_conversations
  for each row execute function public.set_updated_at();

-- Consistency: client_id/recruitment_project_id must belong to this
-- organization, a project's own client_id (when both are set) must agree
-- with the conversation's client_id, role_at_creation must match an
-- ACTIVE membership the caller actually holds (never a self-declared,
-- wider role used to unlock a looser data_classification), and a
-- client_decision_maker's client_id must be their own represented client —
-- mirrors can_access_candidate()'s client_decision_maker branch (0021).
create or replace function public.enforce_copilot_conversation_consistency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_org uuid;
  v_project_client uuid;
  v_client_org uuid;
  v_has_role boolean;
  v_own_client_id uuid;
begin
  if new.recruitment_project_id is not null then
    select p.organization_id, p.client_id into v_project_org, v_project_client
      from public.recruitment_projects p where p.id = new.recruitment_project_id;

    if v_project_org is distinct from new.organization_id then
      raise exception 'copilot_conversations: recruitment_project_id does not belong to organization_id %', new.organization_id
        using errcode = '23514';
    end if;

    if new.client_id is not null and v_project_client is distinct from new.client_id then
      raise exception 'copilot_conversations: recruitment_project_id''s client does not match client_id'
        using errcode = '23514';
    end if;
  end if;

  if new.client_id is not null then
    select c.organization_id into v_client_org from public.clients c where c.id = new.client_id;
    if v_client_org is distinct from new.organization_id then
      raise exception 'copilot_conversations: client_id does not belong to organization_id %', new.organization_id
        using errcode = '23514';
    end if;
  end if;

  select exists (
    select 1 from public.organization_memberships m
    where m.user_id = new.user_id
      and m.organization_id = new.organization_id
      and m.status = 'active'
      and m.role = new.role_at_creation
  ) into v_has_role;

  if not v_has_role then
    raise exception 'copilot_conversations: user % does not hold an active % membership in organization %', new.user_id, new.role_at_creation, new.organization_id
      using errcode = '23514';
  end if;

  if new.role_at_creation = 'client_decision_maker' then
    select m.client_id into v_own_client_id
      from public.organization_memberships m
      where m.user_id = new.user_id
        and m.organization_id = new.organization_id
        and m.status = 'active'
        and m.role = 'client_decision_maker';

    if v_own_client_id is distinct from new.client_id then
      raise exception 'copilot_conversations: client_decision_maker''s client_id must be their own represented client'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists copilot_conversations_enforce_consistency on public.copilot_conversations;
create trigger copilot_conversations_enforce_consistency
  before insert on public.copilot_conversations
  for each row execute function public.enforce_copilot_conversation_consistency();

-- Scope immutability: once created, a conversation's authorized scope can
-- never widen. Only status/title/updated_at may ever change — see
-- "SCOPE SNAPSHOT, NOT LIVE LOOKUP" above for why this matters.
create or replace function public.enforce_copilot_conversation_scope_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.organization_id <> old.organization_id
    or new.user_id <> old.user_id
    or new.role_at_creation <> old.role_at_creation
    or new.client_id is distinct from old.client_id
    or new.recruitment_project_id is distinct from old.recruitment_project_id
    or new.data_classification <> old.data_classification
    or new.created_at <> old.created_at
  then
    raise exception 'copilot_conversations: scope columns (organization_id, user_id, role_at_creation, client_id, recruitment_project_id, data_classification, created_at) are immutable once created — only status/title may change'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists copilot_conversations_scope_immutable on public.copilot_conversations;
create trigger copilot_conversations_scope_immutable
  before update on public.copilot_conversations
  for each row execute function public.enforce_copilot_conversation_scope_immutable();

alter table public.copilot_conversations enable row level security;

-- A conversation is a personal AI session, not a shared work artifact —
-- deliberately STRICTER than most tables' role-based org sharing (brief:
-- "a user can only see their OWN conversations"). agency_admin/
-- platform_admin get read-only ORG-WIDE oversight on top of that: the
-- brief requires every AI action to be auditable end to end, and
-- docs/12-security-compliance.md's audit_logs resource already gives
-- agency_admin 'read' org-wide / platform_admin 'full' cross-org — copilot
-- conversations are exactly the kind of AI-action record that oversight is
-- meant to cover. No other role (recruiter, client_decision_maker,
-- read_only_reviewer) ever sees another user's conversation, even within
-- the same org — narrower than the audit_logs precedent on purpose, since
-- a chat thread can contain much more free-form content than a single
-- audit_events row.
create policy copilot_conversations_select_own_or_oversight
  on public.copilot_conversations
  for select
  using (
    user_id = auth.uid()
    or public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
  );

create policy copilot_conversations_insert_own
  on public.copilot_conversations
  for insert
  with check (
    user_id = auth.uid()
    and public.is_org_member(organization_id)
  );

-- Only the owning user may change status/title (archive/end/rename their
-- own conversation) — oversight access above is read-only, never write, on
-- purpose: an admin reviewing conversations for audit purposes must never
-- be able to alter them.
create policy copilot_conversations_update_own
  on public.copilot_conversations
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- No delete grant at all — a conversation is either active, archived or
-- ended, never removed, so its audit trail (and its child messages/tool
-- calls) is always reconstructible.

-- ---------------------------------------------------------------------------
-- copilot_messages — one turn per row, append-only.
-- ---------------------------------------------------------------------------

create table if not exists public.copilot_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  copilot_conversation_id uuid not null references public.copilot_conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system_note')),
  -- A user turn always carries content; an assistant turn MAY be pure
  -- tool-call(s) with no prose reply yet, hence nullable there. A
  -- system_note is an internal, non-model-authored annotation (e.g. "rate
  -- limit reached") and may also have no free text.
  --
  -- TRUST NOTE (brief: "treat retrieved documents as untrusted... never
  -- allow document instructions to override system policy"): a `user`
  -- row's content is the org's own authenticated user typing into their
  -- own chat, which is NOT the brief's primary untrusted-input concern —
  -- that is retrieved documents/records the tool layer pulls in (CVs, JD
  -- text, candidate responses), which are never stored in this table at
  -- all, only referenced via `citations`. A compromised or malicious
  -- internal account is still a real, if secondary, prompt-injection
  -- vector though, so the orchestration layer (wave 2/3) must still frame
  -- `user` content as data inside the model call, exactly like every other
  -- untrusted-input workflow in this codebase (docs/09-ai-architecture.md
  -- §9.1) — this column does not get a free pass just because it is
  -- first-party.
  content text,
  constraint copilot_messages_user_content_required check (
    role <> 'user' or content is not null
  ),
  -- Citations to authorized records this message's claims are grounded in
  -- (brief: "citations to authorized records"). An array of objects, e.g.
  -- [{"kind":"candidate_extracted_field","id":"...","excerpt":"..."}] — the
  -- exact shape is defined by packages/types' CopilotCitationSchema (Zod),
  -- validated in application code before insert; the DB only enforces it
  -- is a JSON array, not an arbitrary shape.
  citations jsonb not null default '[]'::jsonb
    check (jsonb_typeof(citations) = 'array'),
  -- Links to the full audited ai_runs record (model, prompt version,
  -- tokens, cost, confidence) for an assistant turn that made a model
  -- call — see this migration's ai_runs.workflow_type extension below.
  -- Always null for role = 'user'/'system_note'.
  ai_run_id uuid references public.ai_runs (id) on delete set null,
  -- Deterministic ordering independent of clock resolution/skew.
  sequence_number integer not null check (sequence_number >= 0),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (copilot_conversation_id, sequence_number)
);

comment on table public.copilot_messages is
  'One turn (user/assistant/system_note) per row, append-only (Build Phase 11 brief). citations is the brief''s "citations to authorized records" mechanism — see CopilotCitationSchema in packages/types. See this migration''s TRUST NOTE comment on the content column for why a user-authored turn is not the brief''s primary prompt-injection concern, but still not exempt from trusted/untrusted framing at the orchestration layer.';

create index if not exists copilot_messages_conversation_idx
  on public.copilot_messages (copilot_conversation_id, sequence_number);

create or replace function public.enforce_copilot_message_consistency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation_org uuid;
begin
  select c.organization_id into v_conversation_org
    from public.copilot_conversations c where c.id = new.copilot_conversation_id;

  if v_conversation_org is distinct from new.organization_id then
    raise exception 'copilot_messages: organization_id must match the referenced copilot_conversation''s'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists copilot_messages_enforce_consistency on public.copilot_messages;
create trigger copilot_messages_enforce_consistency
  before insert on public.copilot_messages
  for each row execute function public.enforce_copilot_message_consistency();

revoke update, delete on public.copilot_messages from authenticated, anon;

alter table public.copilot_messages enable row level security;

create policy copilot_messages_select_own_or_oversight
  on public.copilot_messages
  for select
  using (
    exists (
      select 1 from public.copilot_conversations c
      where c.id = copilot_messages.copilot_conversation_id
        and (
          c.user_id = auth.uid()
          or public.is_platform_admin()
          or public.has_org_role(c.organization_id, array['agency_admin']::public.app_role[])
        )
    )
  );

-- Insert requires the caller to OWN the parent conversation — the same
-- shape as ai_runs' "server-side orchestration, authenticated as the
-- acting user" pattern (0017): oversight (admin) access above is read-only
-- and never gets an insert policy, so an admin reviewing a conversation can
-- never inject a message into someone else's thread.
create policy copilot_messages_insert_own
  on public.copilot_messages
  for insert
  with check (
    exists (
      select 1 from public.copilot_conversations c
      where c.id = copilot_messages.copilot_conversation_id
        and c.user_id = auth.uid()
        and c.organization_id = copilot_messages.organization_id
    )
  );

-- ---------------------------------------------------------------------------
-- copilot_tool_calls — one row per tool invocation within a message turn.
-- ---------------------------------------------------------------------------

-- The tool allowlist, structurally enforced (brief: "tool allowlist"
-- enforced independently of model output, as defense-in-depth alongside
-- the application-layer allowlist wave 2 builds). One entry per COPILOT
-- CAPABILITY the brief lists — 13 total. This is a closed, append-only-by-
-- migration list: a future wave adding a new capability extends this CHECK
-- constraint the same way ai_runs.workflow_type has been extended twice
-- (0027, this migration) — it is never widened by application code alone.
create table if not exists public.copilot_tool_calls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  copilot_conversation_id uuid not null references public.copilot_conversations (id) on delete cascade,
  copilot_message_id uuid not null references public.copilot_messages (id) on delete cascade,
  tool_name text not null check (tool_name in (
    'summarize_recruitment_project',
    'explain_scorecard',
    'find_missing_job_requirements',
    'summarize_candidate',
    'explain_candidate_match',
    'compare_approved_candidates',
    'identify_missing_evidence',
    'draft_verification_questions',
    'draft_interview_questions',
    'draft_outreach_message',
    'summarize_candidate_responses',
    'explain_poc_metrics',
    'suggest_next_workflow_action'
  )),
  -- The structured input actually sent to the tool (brief: "structured
  -- tool inputs") — validated server-side against a Zod schema before this
  -- row is written; the DB only enforces it is a JSON object.
  input jsonb not null check (jsonb_typeof(input) = 'object'),
  -- Nullable only because this table is written as ONE completed insert per
  -- invocation (see the append-only note below) rather than insert-then-
  -- update; a denied call (see `denied` below) never gets an output at
  -- all, hence the nullability.
  output jsonb check (output is null or jsonb_typeof(output) in ('object', 'array')),
  -- Brief: "tool output validation". 'pending' is not in the brief's
  -- literal three-value list ('valid'|'invalid'|'error') but is added here
  -- as the only way to represent "not yet resolved" for a row that, per
  -- the append-only design below, is committed once as a single insert —
  -- in practice a resolved row is always 'valid'/'invalid'/'error' by the
  -- time it is written; 'pending' exists for schema completeness / a
  -- future async execution model, not for normal synchronous use.
  output_validation_status text not null default 'pending'
    check (output_validation_status in ('pending', 'valid', 'invalid', 'error')),
  -- Brief: "validate resource ownership on every tool call". Defaults
  -- false and must be explicitly set true by the tool-execution code after
  -- it has actually checked the caller may access every resource_id the
  -- call touches — never implied by anything else. The CHECK below makes
  -- "output marked valid without ownership having been validated" a
  -- structural impossibility, not just an application-code convention.
  resource_ownership_validated boolean not null default false,
  denied boolean not null default false,
  denial_reason text,
  -- Two-step (propose -> confirm) mutation-flow scaffolding for wave 2. No
  -- mutation TOOLS exist yet as of this migration (the copilot may not
  -- alter candidate records without confirmation, and this wave builds no
  -- tools that alter anything at all) — these columns exist so wave 2 can
  -- represent "this tool call proposed a change and is waiting on an
  -- explicit human confirmation" without a schema change of its own.
  requires_confirmation boolean not null default false,
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users (id),
  ai_run_id uuid references public.ai_runs (id) on delete set null,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  created_at timestamptz not null default now(),
  -- A denied call was never executed: it can never carry an output, and it
  -- must always explain why.
  constraint copilot_tool_calls_denied_shape check (
    (not denied) or (output is null and denial_reason is not null)
  ),
  constraint copilot_tool_calls_denial_reason_requires_denied check (
    denial_reason is null or denied
  ),
  -- The structural guarantee behind "resource ownership validated on every
  -- tool call": a call can never be marked output_validation_status =
  -- 'valid' unless resource_ownership_validated is true. A row that
  -- violates this at the application layer (marks output valid without
  -- having run the ownership check) is impossible to persist — the
  -- earlier-than-this-constraint version of that bug is exactly the
  -- "detectable violation" the brief asks later eval tests to check for;
  -- this makes it undetectable-because-unrepresentable instead, which is
  -- stronger.
  constraint copilot_tool_calls_valid_requires_ownership check (
    output_validation_status <> 'valid' or resource_ownership_validated
  ),
  -- Confirmation fields are meaningless (and must stay unset) unless this
  -- call actually required confirmation, and both fields are set together
  -- or not at all.
  constraint copilot_tool_calls_confirmation_requires_flag check (
    (confirmed_at is null and confirmed_by is null) or requires_confirmation
  ),
  constraint copilot_tool_calls_confirmation_pair check (
    (confirmed_at is null) = (confirmed_by is null)
  ),
  -- A denied call was never executed, so it can never be "confirmed" —
  -- there is nothing to confirm.
  constraint copilot_tool_calls_denied_not_confirmed check (
    confirmed_at is null or not denied
  )
);

comment on table public.copilot_tool_calls is
  'One row per tool invocation inside an assistant turn (Build Phase 11 brief). tool_name is DB-CHECK-allowlisted to the 13 copilot capabilities the brief lists, independent of the application-layer allowlist wave 2 also enforces (defense in depth). copilot_tool_calls_valid_requires_ownership is the structural guarantee that resource_ownership_validated must be true before any output can be trusted as valid.';

create index if not exists copilot_tool_calls_conversation_idx
  on public.copilot_tool_calls (copilot_conversation_id, created_at);
create index if not exists copilot_tool_calls_message_idx
  on public.copilot_tool_calls (copilot_message_id);
create index if not exists copilot_tool_calls_tool_name_idx
  on public.copilot_tool_calls (tool_name);

create or replace function public.enforce_copilot_tool_call_consistency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message_org uuid;
  v_message_conversation uuid;
begin
  select m.organization_id, m.copilot_conversation_id into v_message_org, v_message_conversation
    from public.copilot_messages m where m.id = new.copilot_message_id;

  if v_message_org is distinct from new.organization_id
    or v_message_conversation is distinct from new.copilot_conversation_id
  then
    raise exception 'copilot_tool_calls: organization_id/copilot_conversation_id must match the referenced copilot_message''s'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists copilot_tool_calls_enforce_consistency on public.copilot_tool_calls;
create trigger copilot_tool_calls_enforce_consistency
  before insert on public.copilot_tool_calls
  for each row execute function public.enforce_copilot_tool_call_consistency();

-- Append-only EXCEPT for one narrow, trigger-gated exception: setting
-- confirmed_at/confirmed_by exactly once, from null, on a row that already
-- has requires_confirmation = true and denied = false. Every other column
-- is frozen from the moment of insert — mirrors metric_definitions'
-- "immutable except status" pattern (0021) rather than outreach_approvals'
-- fully-append-only pattern, because the brief explicitly asks this table
-- to carry the confirm step itself rather than a separate table.
create or replace function public.enforce_copilot_tool_call_confirm_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.id <> old.id
    or new.organization_id <> old.organization_id
    or new.copilot_conversation_id <> old.copilot_conversation_id
    or new.copilot_message_id <> old.copilot_message_id
    or new.tool_name <> old.tool_name
    or new.input <> old.input
    or new.output is distinct from old.output
    or new.output_validation_status <> old.output_validation_status
    or new.resource_ownership_validated <> old.resource_ownership_validated
    or new.denied <> old.denied
    or new.denial_reason is distinct from old.denial_reason
    or new.requires_confirmation <> old.requires_confirmation
    or new.ai_run_id is distinct from old.ai_run_id
    or new.latency_ms is distinct from old.latency_ms
    or new.created_at <> old.created_at
  then
    raise exception 'copilot_tool_calls: only confirmed_at/confirmed_by may ever be set after insert (from null, once)'
      using errcode = '23514';
  end if;

  if old.confirmed_at is not null then
    raise exception 'copilot_tool_calls: % is already confirmed and cannot be re-confirmed or unconfirmed', old.id
      using errcode = '23514';
  end if;

  if not old.requires_confirmation then
    raise exception 'copilot_tool_calls: % does not require confirmation', old.id
      using errcode = '23514';
  end if;

  if old.denied then
    raise exception 'copilot_tool_calls: a denied tool call cannot be confirmed'
      using errcode = '23514';
  end if;

  if new.confirmed_at is null or new.confirmed_by is null then
    raise exception 'copilot_tool_calls: confirmation update must set both confirmed_at and confirmed_by together'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists copilot_tool_calls_confirm_only on public.copilot_tool_calls;
create trigger copilot_tool_calls_confirm_only
  before update on public.copilot_tool_calls
  for each row execute function public.enforce_copilot_tool_call_confirm_only();

-- No DELETE grant at all — audit integrity: a tool-call record must never
-- be removed.
revoke delete on public.copilot_tool_calls from authenticated, anon;

alter table public.copilot_tool_calls enable row level security;

create policy copilot_tool_calls_select_own_or_oversight
  on public.copilot_tool_calls
  for select
  using (
    exists (
      select 1 from public.copilot_conversations c
      where c.id = copilot_tool_calls.copilot_conversation_id
        and (
          c.user_id = auth.uid()
          or public.is_platform_admin()
          or public.has_org_role(c.organization_id, array['agency_admin']::public.app_role[])
        )
    )
  );

create policy copilot_tool_calls_insert_own
  on public.copilot_tool_calls
  for insert
  with check (
    exists (
      select 1 from public.copilot_conversations c
      where c.id = copilot_tool_calls.copilot_conversation_id
        and c.user_id = auth.uid()
        and c.organization_id = copilot_tool_calls.organization_id
    )
  );

-- The one allowed post-insert write: the owning user confirming a
-- requires_confirmation call. Oversight (admin) access is read-only, same
-- as copilot_conversations/copilot_messages — an admin can review but never
-- act on someone else's pending confirmation.
create policy copilot_tool_calls_update_own_confirm
  on public.copilot_tool_calls
  for update
  using (
    exists (
      select 1 from public.copilot_conversations c
      where c.id = copilot_tool_calls.copilot_conversation_id
        and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.copilot_conversations c
      where c.id = copilot_tool_calls.copilot_conversation_id
        and c.user_id = auth.uid()
    )
    and confirmed_by = auth.uid()
  );

-- ---------------------------------------------------------------------------
-- copilot_usage_counters — persisted, auditable rate-limit/cost state per
-- (organization, user, day). Chosen over an in-memory-only limiter because
-- this is a Vercel/serverless stack (docs/17-deployment-operations.md) —
-- in-memory state does not reliably survive a cold start or span
-- concurrent instances, and the brief lists "Rate limits" and "Cost
-- tracking" as first-class architecture requirements, not best-effort
-- ones.
-- ---------------------------------------------------------------------------

create table if not exists public.copilot_usage_counters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- A simple daily rolling window. wave 2's rate-limit check reads/upserts
  -- today's row; a finer sub-day window, if ever needed, is a future
  -- migration, not a reason to complicate this one now.
  window_date date not null default current_date,
  message_count integer not null default 0 check (message_count >= 0),
  tool_call_count integer not null default 0 check (tool_call_count >= 0),
  total_input_tokens bigint not null default 0 check (total_input_tokens >= 0),
  total_output_tokens bigint not null default 0 check (total_output_tokens >= 0),
  total_cost_usd numeric(10, 6) not null default 0 check (total_cost_usd >= 0),
  -- How many requests in this window were BLOCKED for exceeding the limit
  -- — itself an auditable signal (brief: "copilot.rate_limited" audit
  -- action), not just an internal counter.
  rate_limited_count integer not null default 0 check (rate_limited_count >= 0),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id, window_date)
);

comment on table public.copilot_usage_counters is
  'Persisted, auditable per-(organization, user, day) rate-limit and cost-tracking state for the copilot (Build Phase 11 brief §ARCHITECTURE "Rate limits"/"Cost tracking"). Chosen over an in-memory limiter because this is a serverless (Vercel) stack — see this migration''s header note. Counts are monotonic (copilot_usage_counters_monotonic_only trigger) so a client can never reset its own usage by re-upserting a lower value.';

create index if not exists copilot_usage_counters_org_idx
  on public.copilot_usage_counters (organization_id, window_date);

drop trigger if exists copilot_usage_counters_set_updated_at on public.copilot_usage_counters;
create trigger copilot_usage_counters_set_updated_at
  before update on public.copilot_usage_counters
  for each row execute function public.set_updated_at();

-- Monotonic-only: every counter may only increase (or stay the same) on
-- UPDATE — a usage counter that could be silently reset would defeat both
-- the rate limit and the cost-tracking audit trail.
create or replace function public.enforce_copilot_usage_counters_monotonic()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.organization_id <> old.organization_id
    or new.user_id <> old.user_id
    or new.window_date <> old.window_date
  then
    raise exception 'copilot_usage_counters: organization_id/user_id/window_date are immutable once created'
      using errcode = '23514';
  end if;

  if new.message_count < old.message_count
    or new.tool_call_count < old.tool_call_count
    or new.total_input_tokens < old.total_input_tokens
    or new.total_output_tokens < old.total_output_tokens
    or new.total_cost_usd < old.total_cost_usd
    or new.rate_limited_count < old.rate_limited_count
  then
    raise exception 'copilot_usage_counters: counters may only increase, never decrease'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists copilot_usage_counters_monotonic_only on public.copilot_usage_counters;
create trigger copilot_usage_counters_monotonic_only
  before update on public.copilot_usage_counters
  for each row execute function public.enforce_copilot_usage_counters_monotonic();

alter table public.copilot_usage_counters enable row level security;

-- Self-scoped (a user sees only their own usage) plus the same oversight
-- exception as the other three tables — an agency admin legitimately needs
-- an org-wide cost/rate-limit view for budgeting, without that becoming a
-- path to read anyone's conversation CONTENT (this table carries no
-- message/tool-call content, only counts).
create policy copilot_usage_counters_select_own_or_oversight
  on public.copilot_usage_counters
  for select
  using (
    user_id = auth.uid()
    or public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
  );

create policy copilot_usage_counters_write_own
  on public.copilot_usage_counters
  for all
  using (user_id = auth.uid() and public.is_org_member(organization_id))
  with check (user_id = auth.uid() and public.is_org_member(organization_id));

-- ---------------------------------------------------------------------------
-- ai_runs.workflow_type extension — admits a copilot workflow type so a
-- copilot_messages/copilot_tool_calls row's ai_run_id can point at a real,
-- fully-audited ai_runs record (model/prompt version/tokens/cost/
-- confidence) instead of a parallel, duplicate audit table.
--
-- CROSS-PHASE FIX (bonus, in scope per this wave's brief: "if you have
-- appetite/time... recommended"): docs/build-phase-9-report.md §9.7 and
-- docs/09-ai-architecture.md §9.7/§9.8 both flagged that 0029 (Build Phase
-- 9, outreach) left ai_runs.workflow_type NOT extended for
-- 'outreach_draft_generation'/'response_classification' — a real,
-- twice-documented gap, never fixed. Since this migration is already
-- touching this exact CHECK constraint, both missing values are added here
-- alongside the new copilot one, closing that gap rather than leaving it
-- open a third time. This does NOT retroactively backfill the existing
-- outreach_messages.ai_run_id / candidate_responses.ai_run_id rows, which
-- remain null for data written before this migration (that data's audit
-- trail already lives on the corresponding audit_events row's metadata,
-- per §9.7) — it only means FUTURE outreach draft/classification runs CAN
-- now insert a real ai_runs row, going forward. Whether apps/web/lib/
-- outreach/*.ts is actually updated to start doing so is out of scope for
-- this migration (a TypeScript change, not a schema one) and is flagged
-- here as a ready, low-risk follow-up for whichever wave next touches that
-- code path.
-- ---------------------------------------------------------------------------

alter table public.ai_runs drop constraint if exists ai_runs_workflow_type_check;
alter table public.ai_runs
  add constraint ai_runs_workflow_type_check
  check (workflow_type in (
    'requirement_extraction',
    'candidate_document_extraction',
    'candidate_matching',
    'outreach_draft_generation',
    'response_classification',
    'copilot_response'
  ));

alter table public.ai_prompt_versions drop constraint if exists ai_prompt_versions_workflow_type_check;
alter table public.ai_prompt_versions
  add constraint ai_prompt_versions_workflow_type_check
  check (workflow_type in (
    'requirement_extraction',
    'candidate_document_extraction',
    'candidate_matching',
    'outreach_draft_generation',
    'response_classification',
    'copilot_response'
  ));

-- ---------------------------------------------------------------------------
-- Grants (roles created in 0001; RLS above is the real gate). Append-only
-- tables receive no update grant at the role-privilege level except the
-- one narrow, trigger-gated exception on copilot_tool_calls; none receive
-- a delete grant at all.
-- ---------------------------------------------------------------------------

grant select, insert, update on public.copilot_conversations to authenticated;
grant select, insert on public.copilot_messages to authenticated;
grant select, insert, update on public.copilot_tool_calls to authenticated;
grant select, insert, update on public.copilot_usage_counters to authenticated;
