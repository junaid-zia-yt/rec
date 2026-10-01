-- 0032_integrations_jobs_notifications.sql
-- Build Phase 12 ("Integrations and Workflow Reliability"), Wave 1 — DB +
-- types foundation only. No job-execution engine, no integration adapter
-- client code, no UI: those are later waves' job. This migration lays the
-- schema + deterministic guardrails those waves must operate inside of.
--
-- GOVERNING BRIEF (abbreviated): durable background jobs (document
-- processing, AI extraction, candidate evaluation, notifications, email
-- delivery, integration sync, report generation) with idempotency, retry
-- limits, exponential backoff, job status, failure reason, manual retry,
-- correlation ID, audit event, no sensitive payloads in ordinary logs;
-- integration connection boundaries for TA Tracker (adapter interface with
-- API/CSV/manual-exchange modes), Apollo, Calendar, SMS; inbound webhook
-- handling with duplicate/signature-invalid detection; in-app + email user
-- notifications with read/unread state, preferences, and permission-safe
-- deep links.
--
-- FOUR new table groups, in dependency order:
--
--   background_jobs          -- one row per durable job. Deterministic
--                                job-type/status allowlists (CHECK), an
--                                idempotency_key unique per (org, job_type)
--                                so a duplicate enqueue is rejected at the
--                                DB layer (mirrors outreach_messages/ai_runs
--                                0017/0029), a correlation_id that
--                                cross-references audit_events rows sharing
--                                the same id rather than a duplicate audit
--                                mechanism, and backoff/retry bookkeeping.
--   integration_connections  -- one row per (org, provider) connection.
--                                See "TA TRACKER MODE HONESTY" below — this
--                                is the table's single trickiest guarantee.
--   webhook_events            -- inbound webhook dedup/signature-validation
--                                record. UNIQUE (provider, external_event_id)
--                                is the literal mechanism behind "duplicate
--                                webhooks are rejected".
--   notifications /
--   notification_preferences -- personal, own-recipient-only in-app/email
--                                notification records. See "PERMISSION-SAFE
--                                DEEP LINKS" below.
--
-- TA TRACKER MODE HONESTY (judgment call carried over verbatim from
-- docs/11-integration-plan.md §11.2 / docs/18-blocking-questions.md
-- Q-P2-03, both already-confirmed findings, not re-litigated here): there
-- is NO TA Tracker API, NO documentation, and NO credentials — a
-- confirmed, permanent blocker for API-mode integration specifically. The
-- adapter interface this schema supports has THREE modes because the
-- brief lists three, but only two of them need zero vendor-specific
-- knowledge to build legitimately: CSV import/export (a generic file
-- format; this platform already knows its own candidate/job schema) and
-- secure manual exchange (a documented manual handoff workflow — a
-- recruiter uploads to/from a secure location and logs that it happened).
-- Neither of those requires inventing anything about a vendor API. The
-- API mode is the one the project instructions ("do not invent a TA
-- Tracker API") forbid ever faking: `integration_connections_ta_tracker_
-- api_mode_honesty` below makes it STRUCTURALLY IMPOSSIBLE for a row with
-- provider = 'ta_tracker' and mode = 'api' to ever report any status other
-- than 'not_connected' or 'pending_documentation' — connected/sync_error/
-- disconnected are unreachable for that (provider, mode) pair by CHECK
-- constraint, not merely by application-code discipline. A later wave
-- CAN legitimately build and enable CSV/manual-exchange modes; it can
-- NEVER make the API mode "connect" in this environment, and this
-- constraint is what makes that promise durable across every future wave
-- that touches this table, including ones that never read this comment.
--
-- PERMISSION-SAFE DEEP LINKS (the other trickiest guarantee this wave
-- establishes): a notification's target is NEVER stored as a raw URL
-- string to trust blindly at click time. `resource_type` + `resource_id`
-- are structured references a later wave's route handler re-validates
-- against the RECIPIENT'S LIVE permissions at click time (the same
-- pattern docs/09-ai-architecture.md and lib/copilot/resource-ownership.ts
-- already established for "never trust a snapshot, always re-check
-- current access") — a stale or forwarded notification link can never
-- become a path to a resource the clicking user cannot currently access,
-- because there is no stored URL to forward in the first place, only an
-- opaque (type, id) pair a permission-aware handler resolves fresh every
-- time. This migration cannot enforce the re-validation itself (that is
-- server-side route-handler code, a later wave's job) but it makes the
-- correct shape the ONLY shape available: there is no `action_url` column
-- to accidentally trust instead.
--
-- Calculation/orchestration logic (the job runner, retry scheduler,
-- adapter clients, webhook route handlers, notification dispatch) and all
-- UI are explicitly OUT OF SCOPE for this migration.

-- ---------------------------------------------------------------------------
-- background_jobs
-- ---------------------------------------------------------------------------

create table if not exists public.background_jobs (
  id uuid primary key default gen_random_uuid(),
  -- NOT NULL by default per this wave's design brief: every job type
  -- listed (document processing, AI extraction, candidate evaluation,
  -- notification dispatch, email delivery, integration sync, report
  -- generation) is an org-scoped operation in this codebase today. If a
  -- genuine platform-level job type emerges (e.g. a cross-org maintenance
  -- sweep) a later migration should relax this — not assumed here.
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- The brief's 7 durable-job categories, closed-allowlist (defense in
  -- depth alongside whatever the job-runner's own TypeScript union
  -- enforces — mirrors copilot_tool_calls.tool_name's structural-allowlist
  -- pattern, 0031).
  job_type text not null check (job_type in (
    'document_processing',
    'ai_extraction',
    'candidate_evaluation',
    'notification_dispatch',
    'email_delivery',
    'integration_sync',
    'report_generation'
  )),
  -- 'retry-in-progress' is deliberately NOT a separate status: a job
  -- awaiting its next backoff attempt is still 'queued' (next_attempt_at
  -- in the future), and a job actively re-running its handler is still
  -- 'running' — the same two statuses cover a first attempt and a retried
  -- one. 'dead_lettered' is distinct from 'failed': 'failed' means this
  -- particular attempt errored and another retry may still be scheduled;
  -- 'dead_lettered' means max_attempts was exhausted and the job will
  -- never be automatically retried again (manual retry only, see below).
  status text not null default 'queued' check (status in (
    'queued', 'running', 'succeeded', 'failed', 'dead_lettered', 'cancelled'
  )),
  -- The job's input. Brief: "no sensitive payloads in ordinary logs" — this
  -- JSONB column is fine as structured, RLS-protected, org-scoped DATABASE
  -- storage (exactly like ai_runs.output_json or candidate_document_
  -- processing_jobs.extracted_text before it); the requirement this
  -- comment preserves for later waves is an APPLICATION-CODE discipline —
  -- nothing about a job's payload (candidate PII, document text, contact
  -- details) may ever be written to a plaintext application/console log,
  -- only to this protected row. A job's own console/observability logging
  -- must reference job id + job_type + correlation_id only, never payload
  -- contents.
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  -- Brief: "correlation ID". Cross-references audit_events rows sharing
  -- this same id (application code passes the same UUID as both this
  -- column and, where relevant, audit_events.entity_id or a metadata
  -- field) — a deliberate choice to reuse the EXISTING audit_events table
  -- (0006) as the audit mechanism rather than duplicating a parallel log
  -- here. This column's own existence is what makes that cross-reference
  -- possible; it carries no audit content itself.
  correlation_id uuid not null default gen_random_uuid(),
  -- Brief: "idempotency". A caller-supplied key so a duplicate enqueue of
  -- the "same" job (e.g. a webhook retried by the sender, or a UI double-
  -- submit) is rejected at the DB layer rather than silently double-
  -- processed — unique per (organization_id, job_type), mirroring
  -- outreach_messages.idempotency_key (0029) and ai_runs.idempotency_key
  -- (0017) exactly. Nullable for callers that don't supply one (not every
  -- job type necessarily has a natural idempotency key yet); when present
  -- it must be unique.
  idempotency_key text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  -- Sensible default: enough retries for transient failures (network,
  -- rate limit) without letting a permanently-broken job retry forever.
  -- Individual job types may set a lower/higher value at enqueue time.
  max_attempts integer not null default 5 check (max_attempts >= 1),
  -- Brief: "exponential backoff" scheduling. Null until the first attempt
  -- fails; the job runner (later wave) computes this as
  -- now() + base_delay * 2^attempt_count (capped), not computed here.
  next_attempt_at timestamptz,
  -- Brief: "failure reason". Populated on 'failed'/'dead_lettered' only.
  failure_reason text,
  -- Structured error metadata (provider error code, HTTP status, error
  -- class) — explicitly NOT the sensitive job payload, same "safe,
  -- non-sensitive" discipline as ai_runs.error_message (0017) /
  -- candidate_document_processing_jobs.error_message (0022), just
  -- structured instead of a single string here since a job's error
  -- surface is more varied across 7 job types.
  last_error jsonb check (last_error is null or jsonb_typeof(last_error) = 'object'),
  dead_lettered_at timestamptz,
  -- Brief: "manual retry". A dead-lettered job may be manually re-queued
  -- by an admin; these columns record who/when, distinct from the
  -- automatic attempt_count/next_attempt_at bookkeeping above.
  manually_retried_by uuid references auth.users (id),
  manually_retried_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint background_jobs_dead_lettered_requires_reason check (
    status <> 'dead_lettered' or (dead_lettered_at is not null and failure_reason is not null)
  ),
  constraint background_jobs_failed_requires_reason check (
    status <> 'failed' or failure_reason is not null
  ),
  constraint background_jobs_manual_retry_pair check (
    (manually_retried_at is null) = (manually_retried_by is null)
  ),
  -- A manual retry only ever makes sense against a dead-lettered job — a
  -- still-queued/running job is already going to run on its own, and a
  -- succeeded/cancelled job is not something "retry" means anything for.
  -- Not a hard historical constraint (a job's status legitimately moves
  -- on to 'queued'/'running'/'succeeded' again after a manual retry
  -- re-queues it) — this only guards that manually_retried_by/_at are
  -- never set on a row that was never actually dead-lettered
  -- (dead_lettered_at is not null) at the time of the manual retry.
  constraint background_jobs_manual_retry_requires_prior_dead_letter check (
    manually_retried_at is null or dead_lettered_at is not null
  )
);

comment on table public.background_jobs is
  'One row per durable background job (Build Phase 12 brief). job_type/status are structurally allowlisted (defense in depth alongside the job-runner''s own TypeScript union, a later wave). idempotency_key is unique per (organization_id, job_type) so a duplicate enqueue is rejected at the DB layer. correlation_id cross-references audit_events rows sharing the same id rather than duplicating an audit mechanism. payload/last_error are protected, RLS-scoped DB storage — see this migration''s header note on the separate, application-code-only discipline of never writing payload contents to a plaintext log.';

comment on column public.background_jobs.payload is
  'Structured job input. Safe as protected database storage; the brief''s "no sensitive payloads in ordinary logs" requirement is an application-code discipline (never write this column''s contents to console/observability logs), not something a DB column can itself enforce.';

create unique index if not exists background_jobs_org_type_idempotency_key_idx
  on public.background_jobs (organization_id, job_type, idempotency_key)
  where idempotency_key is not null;

create index if not exists background_jobs_org_status_idx
  on public.background_jobs (organization_id, status, next_attempt_at);
create index if not exists background_jobs_correlation_id_idx
  on public.background_jobs (correlation_id);
create index if not exists background_jobs_job_type_idx
  on public.background_jobs (organization_id, job_type, created_at desc);

drop trigger if exists background_jobs_set_updated_at on public.background_jobs;
create trigger background_jobs_set_updated_at
  before update on public.background_jobs
  for each row execute function public.set_updated_at();

alter table public.background_jobs enable row level security;

-- RLS: platform_admin/agency_admin read (oversight — brief's "Job status"
-- UI requirement, a later wave). Jobs are enqueued/progressed by
-- server-side orchestration code, never directly by an arbitrary client
-- action the way a scorecard-create is a direct user action — there is no
-- separate "who may enqueue a document-processing job" permission check
-- the way there is for, say, creating a shortlist; the permission that
-- actually gates a job's existence is whatever permission gated the
-- higher-level action that enqueued it (uploading a document, approving a
-- match, etc.), checked by that action's own code before it ever calls
-- the job-enqueue helper. No table-precedent in this schema exists for a
-- dedicated "service role only" write path (grep confirms no other
-- migration relies on the service role bypassing RLS for its own writes
-- — every write so far goes through the caller's own RLS-scoped session,
-- e.g. ai_runs 0017, outreach_messages 0029), so this table follows that
-- same established convention: INSERT/UPDATE are granted to `authenticated`
-- and gated by org-membership RLS below, with the expectation — noted
-- here for the job-engine wave — that application server-side code (the
-- enqueue helper and the job-runner route/handler) is the only real
-- caller, exactly like ai_runs' insert policy comment already documents
-- for that table.
create policy background_jobs_select_oversight
  on public.background_jobs
  for select
  using (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
  );

create policy background_jobs_insert_org_member
  on public.background_jobs
  for insert
  with check (public.is_org_member(organization_id));

-- Update is required for the job runner to progress status/attempt_count/
-- next_attempt_at/failure_reason as it works through a job, and for the
-- manual-retry action to set manually_retried_by/_at — both are
-- server-side orchestration, not a direct end-user edit of a job row, so
-- this policy is intentionally as permissive as ai_runs' analogous
-- precedent while RLS still confines it to the job's own organization.
create policy background_jobs_update_org_member
  on public.background_jobs
  for update
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

-- No delete grant at all — a job's history (including dead-lettered ones)
-- is always reconstructible, mirroring every other append-heavy audit-
-- adjacent table in this schema.
revoke delete on public.background_jobs from authenticated, anon;

-- ---------------------------------------------------------------------------
-- integration_connections
-- ---------------------------------------------------------------------------

create table if not exists public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider text not null check (provider in (
    'ta_tracker', 'apollo', 'google_calendar', 'microsoft_calendar', 'sms'
  )),
  -- Only meaningful for provider = 'ta_tracker' (see this migration's
  -- header "TA TRACKER MODE HONESTY" note) — every other provider has
  -- exactly one real integration shape, so mode stays null for them
  -- rather than inventing a single-valued enum per provider.
  mode text check (mode in ('api', 'csv_import_export', 'secure_manual_exchange')),
  status text not null default 'not_connected' check (status in (
    'not_connected', 'pending_documentation', 'connected', 'sync_error', 'disconnected'
  )),
  -- Brief: "Account owner". Per docs/11-integration-plan.md §11.3/§11.4 and
  -- docs/18-blocking-questions.md Q-P1-01, whether Apollo/LinkedIn-style
  -- accounts are client-owned or agency-owned is an unresolved
  -- [CLIENT CONFIRM] business question — this column is honestly nullable
  -- and never defaulted to a guessed value; it is set only once a real
  -- decision is recorded for this specific connection.
  account_owner_label text,
  last_sync_at timestamptz,
  last_sync_status text check (last_sync_status in ('success', 'partial', 'failed')),
  last_sync_error text,
  connected_by uuid references auth.users (id),
  connected_at timestamptz,
  disconnected_at timestamptz,
  disconnected_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider),
  constraint integration_connections_connected_requires_detail check (
    status <> 'connected' or (connected_at is not null and connected_by is not null)
  ),
  constraint integration_connections_disconnected_requires_detail check (
    status <> 'disconnected' or (disconnected_at is not null and disconnected_by is not null)
  ),
  constraint integration_connections_sync_error_requires_message check (
    status <> 'sync_error' or last_sync_error is not null
  ),
  -- THE structural guarantee behind "do not invent a TA Tracker API": a
  -- row for provider = 'ta_tracker' with mode = 'api' can NEVER report
  -- status = 'connected' / 'sync_error' / 'disconnected' — those three
  -- statuses imply a live connection was actually established, which is
  -- categorically impossible for TA Tracker's API mode in this
  -- environment (no API, no documentation, no credentials exist — a
  -- confirmed, permanent blocker per docs/11-integration-plan.md §11.2).
  -- CSV import/export and secure manual exchange modes are NOT restricted
  -- by this constraint — both can be legitimately built and can honestly
  -- reach 'connected' in a later wave, since neither requires any
  -- vendor-specific API knowledge (see this migration's header note).
  -- Every other provider is unrestricted by this constraint (Apollo/
  -- Calendar/SMS all have real, documented APIs — they are simply
  -- `not_configured` today for lack of credentials, a later wave's
  -- concern, not a schema-level impossibility the way TA Tracker's API
  -- mode is).
  constraint integration_connections_ta_tracker_api_mode_honesty check (
    not (provider = 'ta_tracker' and mode = 'api')
    or status in ('not_connected', 'pending_documentation')
  ),
  -- mode is meaningful only for provider = 'ta_tracker' — every other
  -- provider must leave it null, so a future row can never accidentally
  -- imply e.g. Apollo has a "CSV import/export mode" that was never
  -- designed or documented.
  constraint integration_connections_mode_only_for_ta_tracker check (
    mode is null or provider = 'ta_tracker'
  )
);

comment on table public.integration_connections is
  'One row per (organization, provider) integration connection (Build Phase 12 brief). See this migration''s header "TA TRACKER MODE HONESTY" note: integration_connections_ta_tracker_api_mode_honesty makes it structurally impossible for TA Tracker''s API mode to ever report a connected/sync_error/disconnected status in this environment, independent of any application-code discipline — CSV import/export and secure manual exchange modes are the two TA Tracker modes that CAN be legitimately built and connected, since neither requires inventing anything about a vendor API.';

comment on column public.integration_connections.account_owner_label is
  'Free-text/structured label for who owns this connection''s underlying account (e.g. "Client-owned (Apollo)" vs "Agency-owned"). Honestly nullable — docs/18-blocking-questions.md Q-P1-01 is an unresolved [CLIENT CONFIRM] business question; never defaulted to a guess.';

create index if not exists integration_connections_org_idx
  on public.integration_connections (organization_id, provider);

drop trigger if exists integration_connections_set_updated_at on public.integration_connections;
create trigger integration_connections_set_updated_at
  before update on public.integration_connections
  for each row execute function public.set_updated_at();

alter table public.integration_connections enable row level security;

-- This is an org-configuration surface, not working data — agency_admin
-- full (connect/disconnect), platform_admin read-only oversight, no other
-- role (recruiter/client_decision_maker/read_only_reviewer) gets any DB-
-- layer access at all. This is deliberately NARROWER than the
-- packages/types/src/permissions.ts `integrations` resource row
-- (platform_admin: 'full', agency_admin: 'full', recruiter: 'read',
-- read_only_reviewer: 'read') which already existed before this wave —
-- see this migration's report for why that application-layer grant and
-- this RLS policy intentionally differ: RLS is the stricter, final gate;
-- a recruiter's application-layer 'read' on the `integrations` resource
-- is expected to be satisfied by a future wave's read-only summary view
-- or server action that itself runs with elevated (agency_admin-
-- equivalent) trust to surface connection status to a recruiter without
-- widening this table's own RLS — flagged as an open design question in
-- this wave's report for the UI wave to resolve.
create policy integration_connections_select_admin_or_oversight
  on public.integration_connections
  for select
  using (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
  );

create policy integration_connections_write_agency_admin
  on public.integration_connections
  for all
  using (public.has_org_role(organization_id, array['agency_admin']::public.app_role[]))
  with check (public.has_org_role(organization_id, array['agency_admin']::public.app_role[]));

-- ---------------------------------------------------------------------------
-- webhook_events — inbound webhook dedup + signature-validation record.
-- ---------------------------------------------------------------------------

create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  -- Nullable: the organization an inbound webhook belongs to can only be
  -- determined AFTER the payload is parsed (e.g. by matching a provider
  -- message id back to an outreach_messages row) — a webhook that fails
  -- signature validation, or whose payload cannot be matched to any known
  -- org, is still recorded (for audit/security-review purposes) with
  -- organization_id left null rather than being silently dropped.
  organization_id uuid references public.organizations (id) on delete cascade,
  provider text not null,
  -- The provider's own event/message id — the actual dedup key. Nullable
  -- only because a malformed payload (e.g. failed signature validation
  -- before the body could even be parsed) may not have one to extract yet;
  -- the uniqueness constraint below is scoped to exclude nulls so multiple
  -- unparseable events are never wrongly treated as duplicates of the same
  -- (unknown) external event.
  external_event_id text,
  signature_valid boolean not null,
  -- UNTRUSTED — mirrors communication_events.raw_payload's convention
  -- (0029) exactly: this is provider/candidate-originated data that must
  -- never be treated as instructions or trusted without independent
  -- validation, only ever parsed as inert data by the webhook handler.
  raw_payload jsonb not null default '{}'::jsonb,
  processing_status text not null default 'received' check (processing_status in (
    'received', 'processed', 'rejected_invalid_signature', 'duplicate_ignored', 'error'
  )),
  processed_at timestamptz,
  related_job_id uuid references public.background_jobs (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint webhook_events_rejected_requires_invalid_signature check (
    processing_status <> 'rejected_invalid_signature' or not signature_valid
  )
);

comment on table public.webhook_events is
  'Inbound webhook dedup + signature-validation record (Build Phase 12 brief testing requirements: "duplicate webhooks", "invalid signatures"). webhook_events_provider_external_event_id_idx (UNIQUE on (provider, external_event_id), nulls excluded) is the literal DB-layer mechanism proving a duplicate webhook is detected, not just assumed handled. raw_payload is UNTRUSTED provider/candidate-originated data — mirrors communication_events.raw_payload (0029) exactly. Writes are intended to be service-role/webhook-endpoint-only: see this table''s RLS section for why no INSERT/UPDATE grant exists for the authenticated role.';

comment on column public.webhook_events.raw_payload is
  'Untrusted external data (mirrors communication_events.raw_payload, 0029) — never treated as instructions, only ever parsed as inert data by the webhook handler.';

create unique index if not exists webhook_events_provider_external_event_id_idx
  on public.webhook_events (provider, external_event_id)
  where external_event_id is not null;

create index if not exists webhook_events_org_idx
  on public.webhook_events (organization_id, created_at desc);
create index if not exists webhook_events_related_job_idx
  on public.webhook_events (related_job_id) where related_job_id is not null;

alter table public.webhook_events enable row level security;

-- Read: platform_admin/agency_admin oversight only, same shape as every
-- other admin-oversight table in this schema.
create policy webhook_events_select_oversight
  on public.webhook_events
  for select
  using (
    public.is_platform_admin()
    or (
      organization_id is not null
      and public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
    )
  );

-- DELIBERATELY NO INSERT/UPDATE POLICY, AND NO GRANT, FOR authenticated OR
-- anon: a real webhook endpoint (Next.js route handler receiving a
-- provider callback) is invoked by the PROVIDER, not by any of this
-- platform's own authenticated users — there is no `auth.uid()` to scope
-- an RLS check against in the first place. The intended pattern for the
-- later wave that builds the actual webhook route handler: verify the
-- provider's signature first (outside any DB call), then write this row
-- using the Supabase SERVICE ROLE client (which bypasses RLS entirely,
-- like every other genuinely system-driven write anywhere a webhook
-- reaches this platform), never the caller's own session (there is no
-- caller session for an inbound webhook). No other migration in this
-- schema has needed this shape before now (grep confirms no existing
-- inbound-webhook table) — this is the first, and the pattern is
-- documented here precisely so that wave does not have to rediscover it.
revoke insert, update, delete on public.webhook_events from authenticated, anon;

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  recipient_user_id uuid not null references auth.users (id) on delete cascade,
  -- The brief's exact 8 notification events, closed-allowlist.
  event_type text not null check (event_type in (
    'scorecard_awaiting_approval',
    'candidate_awaiting_review',
    'verification_requested',
    'outreach_awaiting_approval',
    'candidate_responded',
    'shortlist_awaiting_client_decision',
    'integration_failed',
    'poc_completed'
  )),
  title text not null,
  body text,
  -- PERMISSION-SAFE DEEP LINK mechanism — see this migration's header
  -- note. Deliberately NOT a raw URL column: resource_type/resource_id
  -- are the opaque structured reference a later wave's route handler
  -- re-validates against the recipient's LIVE permissions at click time,
  -- so a stale or forwarded notification can never become a path to a
  -- resource the clicking user cannot currently access. Both nullable
  -- together only for an event with no single specific target resource
  -- (rare, but the schema does not force every notification to name one).
  resource_type text,
  resource_id uuid,
  -- null = unread. The ONLY column a recipient may ever change after
  -- insert — see the confirm-only-style trigger below, mirroring
  -- copilot_tool_calls.confirmed_at's narrow post-insert exception (0031).
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_resource_pair check (
    (resource_type is null) = (resource_id is null)
  )
);

comment on table public.notifications is
  'One in-app/email notification per row (Build Phase 12 brief), strictly own-recipient-visible — purely personal, more so even than copilot_conversations (0031), which at least grants admin oversight. resource_type/resource_id are the PERMISSION-SAFE DEEP LINK mechanism: see this migration''s header note for why there is deliberately no raw action_url column to trust blindly. Append-only except read_at, enforced by notifications_read_only_mutation below.';

comment on column public.notifications.resource_id is
  'Paired with resource_type as an opaque reference for permission-safe deep-link re-validation at click time — never a trusted URL. A later wave''s route handler must re-check the CURRENT recipient''s access to (resource_type, resource_id) before rendering the target, exactly as lib/copilot/resource-ownership.ts already does for copilot tool calls — a stored notification is not proof of continued access.';

create index if not exists notifications_recipient_idx
  on public.notifications (recipient_user_id, created_at desc);
create index if not exists notifications_recipient_unread_idx
  on public.notifications (recipient_user_id, read_at) where read_at is null;
create index if not exists notifications_org_idx
  on public.notifications (organization_id, created_at desc);

-- Append-only except read_at, from null, set once — mirrors
-- copilot_tool_calls_confirm_only (0031)'s narrow post-insert exception
-- shape exactly.
create or replace function public.enforce_notification_read_only_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.id <> old.id
    or new.organization_id <> old.organization_id
    or new.recipient_user_id <> old.recipient_user_id
    or new.event_type <> old.event_type
    or new.title <> old.title
    or new.body is distinct from old.body
    or new.resource_type is distinct from old.resource_type
    or new.resource_id is distinct from old.resource_id
    or new.created_at <> old.created_at
  then
    raise exception 'notifications: only read_at may ever be set after insert'
      using errcode = '23514';
  end if;

  if old.read_at is not null and new.read_at is distinct from old.read_at then
    raise exception 'notifications: % is already marked read and read_at cannot be changed again', old.id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists notifications_read_only_mutation on public.notifications;
create trigger notifications_read_only_mutation
  before update on public.notifications
  for each row execute function public.enforce_notification_read_only_mutation();

alter table public.notifications enable row level security;

-- Strictly own-recipient-only — no admin oversight exception at all
-- (deliberately narrower than copilot_conversations, 0031): a
-- notification is purely personal content generated ABOUT the recipient's
-- own workflow state, not a record an admin needs to audit the way an AI
-- action or a copilot conversation is.
create policy notifications_select_own
  on public.notifications
  for select
  using (recipient_user_id = auth.uid());

-- Notifications are generated by server-side orchestration (the
-- notification-dispatch job, a later wave) reacting to a platform event —
-- never inserted directly by the recipient describing their own event.
-- Scoped to org membership only (mirrors background_jobs_insert_org_member
-- above) since there is no single "role that creates notifications" the
-- way there is for, say, a scorecard.
create policy notifications_insert_org_member
  on public.notifications
  for insert
  with check (public.is_org_member(organization_id));

-- The one allowed post-insert write: the recipient marking their own
-- notification read. The trigger above is what actually confines this to
-- read_at only; this policy just confines WHO may attempt an update at
-- all.
create policy notifications_update_own_read_at
  on public.notifications
  for update
  using (recipient_user_id = auth.uid())
  with check (recipient_user_id = auth.uid());

-- No delete grant — a notification's history (read or unread) is always
-- reconstructible, same append-only-except-one-field convention as every
-- other table in this migration.
revoke delete on public.notifications from authenticated, anon;

-- ---------------------------------------------------------------------------
-- notification_preferences
-- ---------------------------------------------------------------------------

create table if not exists public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  event_type text not null check (event_type in (
    'scorecard_awaiting_approval',
    'candidate_awaiting_review',
    'verification_requested',
    'outreach_awaiting_approval',
    'candidate_responded',
    'shortlist_awaiting_client_decision',
    'integration_failed',
    'poc_completed'
  )),
  in_app_enabled boolean not null default true,
  -- Opt-IN, not opt-out, for email specifically: sending unwanted email is
  -- a worse failure mode for a recipient than a missed one, so the default
  -- for a preference row that does not yet exist is "no email" (the
  -- absence of a row is read by application code as in_app: true,
  -- email: false — this default column value is what a row created by an
  -- explicit user action starts from, consistent with that same
  -- no-row-yet default).
  email_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, event_type)
);

comment on table public.notification_preferences is
  'Per-(user, event_type) notification channel preference (Build Phase 12 brief). email_enabled defaults false (opt-in, not opt-out) deliberately — sending unwanted email is a worse failure mode than a missed one. Strictly own-user CRUD.';

create index if not exists notification_preferences_user_idx
  on public.notification_preferences (user_id);

drop trigger if exists notification_preferences_set_updated_at on public.notification_preferences;
create trigger notification_preferences_set_updated_at
  before update on public.notification_preferences
  for each row execute function public.set_updated_at();

alter table public.notification_preferences enable row level security;

create policy notification_preferences_own_full
  on public.notification_preferences
  for all
  using (user_id = auth.uid() and public.is_org_member(organization_id))
  with check (user_id = auth.uid() and public.is_org_member(organization_id));

-- ---------------------------------------------------------------------------
-- Grants (roles created in 0001; RLS above is the real gate). See each
-- table's own section above for exactly which grants are withheld and why
-- (webhook_events withholds insert/update/delete entirely from
-- authenticated/anon; every append-only-except-one-field table withholds
-- delete).
-- ---------------------------------------------------------------------------

grant select, insert, update on public.background_jobs to authenticated;
grant select, insert, update on public.integration_connections to authenticated;
grant select on public.webhook_events to authenticated;
grant select, insert, update on public.notifications to authenticated;
grant select, insert, update, delete on public.notification_preferences to authenticated;
