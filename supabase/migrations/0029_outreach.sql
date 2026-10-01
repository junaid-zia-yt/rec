-- 0029_outreach.sql
-- docs/07-data-model.md §7.1/§7.2 (`outreach_contacts`/`outreach_sequences`/
-- `outreach_messages`/`candidate_responses`), Build Phase 9 brief
-- "Outreach": "Implement human-approved candidate outreach, communication
-- history and response management. Do not implement unsafe LinkedIn
-- automation."
--
-- `outreach_contacts` already exists as `candidate_contact_points`
-- (0018_candidates.sql, explicitly documented there as "supersedes the
-- outreach_contacts name docs/07-data-model.md originally sketched for this
-- concept, same shape, brief-specified name") — this migration ALTERs it to
-- add `verified`/`verified_at`/`verified_by` rather than creating a
-- duplicate table.
--
-- Seven new tables, in dependency order:
--
--   communication_preferences — per (candidate, channel) opt-in/opt-out
--                                status. DIFFERENT from the existing
--                                candidate_consents (0021, a broad 1:1
--                                GDPR-style consent record): a candidate can
--                                opt out of SMS while staying reachable by
--                                email, so this is keyed by channel. This is
--                                the DETERMINISTIC, hard, never-AI-
--                                overridable opt-out source of truth (brief
--                                functional requirement #10).
--   outreach_templates        — reusable per-channel message templates.
--                                Org-level asset, not candidate-specific.
--   outreach_sequences        — one outreach plan per candidate_role_match
--                                (docs/07-data-model.md §7.2:
--                                "candidate_role_matches 1─* outreach_
--                                sequences 1─* outreach_messages 1─*
--                                candidate_responses").
--   outreach_messages         — one drafted/sent message. Brief's 9-value
--                                status machine lives in `status`.
--                                idempotency_key makes a retried "send"
--                                detectable at the DB layer (brief testing
--                                requirement "Idempotent sending"), same
--                                convention as matching_runs/ai_runs.
--                                Two triggers enforce, at the database layer
--                                and not just in application code: (a) a
--                                message can never reach an
--                                approved/scheduled/sent/delivered/responded
--                                status without a prior approved
--                                outreach_approvals row (brief functional
--                                requirement #3, core rule #3 "human
--                                approval before candidate submission"), and
--                                (b) no outbound message can ever be
--                                created, or transitioned toward sending,
--                                for a candidate+channel currently opted out
--                                (brief functional requirement #10).
--   outreach_approvals        — append-only recruiter review/approval
--                                record for one outreach_messages row
--                                (mirrors human_reviews' append-only,
--                                reason-required-unless-approved shape).
--   communication_events      — append-only provider/delivery event log
--                                (queued/sent/delivered/bounced/opened/
--                                failed/inbound_reply) per outreach_messages
--                                row. raw_payload is UNTRUSTED — provider
--                                webhook bodies and inbound message text are
--                                data, never instructions (docs/10-ai-
--                                evaluation-guardrails.md).
--   candidate_responses       — inbound reply + classification. raw_
--                                response_text is UNTRUSTED, candidate-
--                                authored text, flagged here for the next
--                                wave's AI classification code
--                                (docs/10-ai-evaluation-guardrails.md: "Never
--                                allow text inside an uploaded document [or
--                                message] to override system
--                                instructions"). ai_suggested_classification
--                                is the AI's reviewable proposal only;
--                                confirmed_classification is set exclusively
--                                by a human reviewer and is the sole field
--                                that can ever trigger the opt-out hard gate
--                                — an unreviewed AI "opt_out" suggestion
--                                never blocks anything on its own (brief:
--                                "AI classification must be reviewable and
--                                must not override opt-out rules" — see the
--                                design-judgment-call note on this table's
--                                comment below).
--
-- "audit_events extensions" (brief §DATABASE) is a TS-level AuditAction
-- union extension in apps/web/lib/audit/log.ts, not a DB migration — see
-- that file, following the established Build Phase 7/8 convention (no
-- audit_events DB enum exists to extend).
--
-- Channel adapters (Email/LinkedIn-manual/Telephone/SMS), AI drafting, and
-- send/receive plumbing are explicitly out of scope for this migration —
-- next-wave work. This migration only lays the schema + deterministic
-- guardrails those adapters and AI code must operate inside of.

-- ---------------------------------------------------------------------------
-- candidate_contact_points: add verification tracking
-- ---------------------------------------------------------------------------

alter table public.candidate_contact_points
  add column if not exists verified boolean not null default false;
alter table public.candidate_contact_points
  add column if not exists verified_at timestamptz;
alter table public.candidate_contact_points
  add column if not exists verified_by uuid references auth.users (id);

alter table public.candidate_contact_points
  drop constraint if exists candidate_contact_points_verified_at_requires_verified;
alter table public.candidate_contact_points
  add constraint candidate_contact_points_verified_at_requires_verified check (
    verified = false or verified_at is not null
  );

comment on table public.candidate_contact_points is
  'Candidate contact channels (docs/07-data-model.md §7.1, was sketched there as outreach_contacts; extended Build Phase 9 with verified/verified_at/verified_by for outreach). PII — high sensitivity.';

comment on column public.candidate_contact_points.verified is
  'Build Phase 9: whether a recruiter has confirmed this contact point is correct/reachable (e.g. after a successful send or a candidate-confirmed reply) — never set by AI inference alone.';

-- ---------------------------------------------------------------------------
-- communication_preferences
-- ---------------------------------------------------------------------------

create table if not exists public.communication_preferences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  channel text not null check (channel in ('email', 'phone', 'linkedin', 'sms')),
  status text not null default 'unknown' check (status in ('opted_in', 'opted_out', 'unknown')),
  -- How this preference was established — informational, for explainability
  -- only (never itself a gate).
  consent_source text
    check (consent_source is null or consent_source in (
      'candidate_request', 'recruiter_recorded', 'response_classification', 'import'
    )),
  opted_out_at timestamptz,
  opted_out_reason text,
  opted_out_by uuid references auth.users (id),
  updated_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, candidate_id, channel),
  constraint communication_preferences_opted_out_fields_together check (
    (status = 'opted_out') = (opted_out_at is not null)
  )
);

comment on table public.communication_preferences is
  'Per (candidate, channel) opt-in/opt-out status (Build Phase 9 brief functional requirement #6/#10). Distinct from candidate_consents (0021), which is a broad 1:1 GDPR-style consent record — a candidate can opt out of SMS while staying reachable by email. This is the deterministic, never-AI-overridable source of truth the opt-out hard-gate triggers below read from.';

create index if not exists communication_preferences_candidate_idx
  on public.communication_preferences (candidate_id);

drop trigger if exists communication_preferences_set_updated_at on public.communication_preferences;
create trigger communication_preferences_set_updated_at
  before update on public.communication_preferences
  for each row execute function public.set_updated_at();

alter table public.communication_preferences enable row level security;

create policy communication_preferences_select_scoped
  on public.communication_preferences
  for select
  using (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin', 'read_only_reviewer']::public.app_role[])
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and public.can_access_candidate(candidate_id)
    )
  );

create policy communication_preferences_write_internal
  on public.communication_preferences
  for all
  using (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and public.can_access_candidate(candidate_id)
    )
  )
  with check (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and public.can_access_candidate(candidate_id)
    )
  );

-- ---------------------------------------------------------------------------
-- outreach_templates
-- ---------------------------------------------------------------------------

create table if not exists public.outreach_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(btrim(name)) > 0),
  channel text not null check (channel in ('email', 'phone', 'linkedin', 'sms')),
  subject_template text,
  body_template text not null check (char_length(btrim(body_template)) > 0),
  description text,
  is_active boolean not null default true,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.outreach_templates is
  'Org-level reusable per-channel message template library (Build Phase 9 brief §DATABASE). Not candidate-specific; outreach_messages.template_id references the template a draft started from.';

create index if not exists outreach_templates_org_idx
  on public.outreach_templates (organization_id, channel, is_active);

drop trigger if exists outreach_templates_set_updated_at on public.outreach_templates;
create trigger outreach_templates_set_updated_at
  before update on public.outreach_templates
  for each row execute function public.set_updated_at();

alter table public.outreach_templates enable row level security;

create policy outreach_templates_select_scoped
  on public.outreach_templates
  for select
  using (
    public.is_platform_admin()
    or public.has_org_role(
      organization_id,
      array['agency_admin', 'read_only_reviewer', 'recruiter']::public.app_role[]
    )
  );

create policy outreach_templates_write_internal
  on public.outreach_templates
  for all
  using (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin', 'recruiter']::public.app_role[])
  )
  with check (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin', 'recruiter']::public.app_role[])
  );

-- ---------------------------------------------------------------------------
-- outreach_sequences
-- ---------------------------------------------------------------------------

create table if not exists public.outreach_sequences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  candidate_role_match_id uuid not null references public.candidate_role_matches (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  recruitment_project_id uuid not null references public.recruitment_projects (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  name text,
  status text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  started_by uuid references auth.users (id),
  started_at timestamptz not null default now(),
  cancelled_by uuid references auth.users (id),
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outreach_sequences_cancel_requires_reason check (
    status <> 'cancelled'
    or (
      cancelled_by is not null and cancelled_at is not null
      and cancel_reason is not null and char_length(btrim(cancel_reason)) > 0
    )
  )
);

comment on table public.outreach_sequences is
  'One outreach plan per candidate_role_match (docs/07-data-model.md §7.2). candidate_id/recruitment_project_id/job_id are denormalized from candidate_role_match_id at insert time (validated by trigger below) so RLS/is_assigned_to_project() need no join.';

create index if not exists outreach_sequences_match_idx
  on public.outreach_sequences (candidate_role_match_id);
create index if not exists outreach_sequences_project_idx
  on public.outreach_sequences (recruitment_project_id);

drop trigger if exists outreach_sequences_set_updated_at on public.outreach_sequences;
create trigger outreach_sequences_set_updated_at
  before update on public.outreach_sequences
  for each row execute function public.set_updated_at();

-- Denormalization consistency: candidate_id/recruitment_project_id/job_id/
-- organization_id must match the referenced candidate_role_match's, same
-- pattern as enforce_shortlist_candidate_rules() in 0028. Also enforces the
-- brief's implicit precondition that only a candidate approved for outreach
-- may have a sequence started for them (core rule #3: human approval before
-- outreach/submission).
create or replace function public.enforce_outreach_sequence_consistency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match_org uuid;
  v_match_candidate uuid;
  v_match_project uuid;
  v_match_job uuid;
  v_review_status text;
begin
  select crm.organization_id, crm.candidate_id, crm.recruitment_project_id, crm.job_id, crm.review_status
    into v_match_org, v_match_candidate, v_match_project, v_match_job, v_review_status
    from public.candidate_role_matches crm
    where crm.id = new.candidate_role_match_id;

  if v_match_org is distinct from new.organization_id
    or v_match_candidate is distinct from new.candidate_id
    or v_match_project is distinct from new.recruitment_project_id
    or v_match_job is distinct from new.job_id
  then
    raise exception 'outreach_sequences: organization_id/candidate_id/recruitment_project_id/job_id must match the referenced candidate_role_match''s'
      using errcode = '23514';
  end if;

  if v_review_status <> 'approved_for_outreach' then
    raise exception 'outreach_sequences: candidate_role_match % has not been approved for outreach (review_status = %) — core rule: human approval before outreach', new.candidate_role_match_id, v_review_status
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists outreach_sequences_enforce_consistency on public.outreach_sequences;
create trigger outreach_sequences_enforce_consistency
  before insert on public.outreach_sequences
  for each row execute function public.enforce_outreach_sequence_consistency();

alter table public.outreach_sequences enable row level security;

create policy outreach_sequences_select_scoped
  on public.outreach_sequences
  for select
  using (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin', 'read_only_reviewer']::public.app_role[])
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and public.can_access_candidate(candidate_id)
      and public.is_assigned_to_project(recruitment_project_id)
    )
  );

create policy outreach_sequences_write_internal
  on public.outreach_sequences
  for all
  using (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and public.can_access_candidate(candidate_id)
      and public.is_assigned_to_project(recruitment_project_id)
    )
  )
  with check (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and public.can_access_candidate(candidate_id)
      and public.is_assigned_to_project(recruitment_project_id)
    )
  );

-- ---------------------------------------------------------------------------
-- outreach_messages
-- ---------------------------------------------------------------------------

create table if not exists public.outreach_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  outreach_sequence_id uuid not null references public.outreach_sequences (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  recruitment_project_id uuid not null references public.recruitment_projects (id) on delete cascade,
  candidate_role_match_id uuid not null references public.candidate_role_matches (id) on delete cascade,
  template_id uuid references public.outreach_templates (id) on delete set null,
  contact_point_id uuid references public.candidate_contact_points (id) on delete set null,
  channel text not null check (channel in ('email', 'phone', 'linkedin', 'sms')),
  status text not null default 'drafted'
    check (status in (
      'drafted', 'awaiting_approval', 'approved', 'scheduled', 'sent',
      'delivered', 'failed', 'responded', 'cancelled'
    )),
  subject text,
  -- The outbound draft content — AI- or recruiter-authored, never candidate-
  -- authored (contrast with candidate_responses.raw_response_text below,
  -- which IS untrusted candidate-authored text).
  draft_body text not null check (char_length(btrim(draft_body)) > 0),
  -- Which candidate evidence backed this draft's personalized claims (brief
  -- functional requirement #2: "Show which candidate evidence was used for
  -- personalization"). Array of {requirementEvidenceId | sourceKind+
  -- sourceId, excerpt} objects — shape defined by the next wave's AI
  -- drafting code; empty array (never fabricated) when no evidence was
  -- used. "Prevent unsupported claims" (functional requirement #5) is
  -- enforced by that AI code validating every personalized claim against
  -- this array before persisting the draft — a DB CHECK cannot verify
  -- semantic groundedness, only that the field exists and is populated.
  personalization_evidence jsonb not null default '[]'::jsonb,
  generated_by text not null default 'ai' check (generated_by in ('ai', 'recruiter')),
  ai_run_id uuid references public.ai_runs (id) on delete set null,
  -- Brief functional requirement #4: "Allow editing before approval." Set
  -- true by application code the first time draft_body/subject differ from
  -- the AI-generated original.
  edited_by_human boolean not null default false,
  -- Brief functional requirement #7: "Record sender account ownership."
  -- Required once a message leaves drafting (see the CHECK constraint
  -- below) — the recruiter whose mailbox/account/phone line actually sends
  -- it, never inferred or defaulted.
  sender_user_id uuid references auth.users (id),
  sender_account_identifier text,
  scheduled_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users (id),
  cancel_reason text,
  -- Brief testing requirement "Idempotent sending": a caller-supplied key
  -- (e.g. `<message_id>:<attempt_no>`), set once the first send attempt is
  -- made, so a retried send is rejected by the unique index below rather
  -- than double-sending — same convention as matching_runs/ai_runs.
  idempotency_key text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outreach_messages_sender_required_before_send check (
    status in ('drafted', 'awaiting_approval') or sender_user_id is not null
  ),
  constraint outreach_messages_cancel_requires_detail check (
    status <> 'cancelled' or (cancelled_by is not null and cancelled_at is not null)
  ),
  constraint outreach_messages_failed_requires_detail check (
    status <> 'failed'
    or (failed_at is not null and failure_reason is not null and char_length(btrim(failure_reason)) > 0)
  )
);

comment on table public.outreach_messages is
  'One drafted/sent outreach message (Build Phase 9 brief §DATABASE). Status machine: drafted -> awaiting_approval -> approved -> scheduled -> sent -> delivered/failed -> responded, or cancelled at any point before sent. Two triggers below make the approval requirement and the opt-out hard-gate unbypassable at the database layer, not just in application code.';

comment on column public.outreach_messages.personalization_evidence is
  'Evidence references used for this draft''s personalized claims (brief functional requirement #2). AI must never invent candidate qualifications or evidence (core rule #5) — this field is what the next wave''s AI drafting/validation code is answerable to; an empty array means no evidence-backed personalization was used, never a fabricated one.';

create unique index if not exists outreach_messages_org_idempotency_key_idx
  on public.outreach_messages (organization_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists outreach_messages_sequence_idx
  on public.outreach_messages (outreach_sequence_id, created_at desc);
create index if not exists outreach_messages_candidate_idx
  on public.outreach_messages (candidate_id);
create index if not exists outreach_messages_status_idx
  on public.outreach_messages (organization_id, status);

drop trigger if exists outreach_messages_set_updated_at on public.outreach_messages;
create trigger outreach_messages_set_updated_at
  before update on public.outreach_messages
  for each row execute function public.set_updated_at();

-- Approval-required hard gate (brief functional requirement #3, core rule
-- #3 "human approval before candidate submission"). A message can never
-- reach approved/scheduled/sent/delivered/responded without a prior
-- outreach_approvals row recording decision = 'approved' for this exact
-- message id. Applies on INSERT too, so a row cannot be created directly in
-- an already-approved state to bypass the check (and could not pass anyway,
-- since no outreach_approvals row can reference a not-yet-existing message
-- id).
create or replace function public.enforce_outreach_message_approval_required()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.status = old.status then
    return new;
  end if;

  if new.status in ('approved', 'scheduled', 'sent', 'delivered', 'responded') then
    if not exists (
      select 1 from public.outreach_approvals oa
      where oa.outreach_message_id = new.id and oa.decision = 'approved'
    ) then
      raise exception 'outreach_messages: status % requires a prior approved outreach_approvals record (core rule: human approval before candidate submission)', new.status
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists outreach_messages_enforce_approval on public.outreach_messages;
create trigger outreach_messages_enforce_approval
  before insert or update of status on public.outreach_messages
  for each row execute function public.enforce_outreach_message_approval_required();

-- Opt-out hard gate (brief functional requirement #10: "Prevent further
-- automated communication after opt-out"). Blocks creating a new outbound
-- message, and blocks moving an existing drafted message toward sending,
-- for any candidate+channel currently opted_out in communication_
-- preferences. This is deliberately independent of, and cannot be
-- bypassed by, any AI response-classification code (see candidate_
-- responses below) — only a human-reviewed opt-out actually flips
-- communication_preferences.status.
create or replace function public.enforce_outreach_message_opt_out_gate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if tg_op = 'UPDATE' and new.status = old.status then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.status not in ('approved', 'scheduled', 'sent') then
    return new;
  end if;

  select cp.status into v_status
    from public.communication_preferences cp
    where cp.organization_id = new.organization_id
      and cp.candidate_id = new.candidate_id
      and cp.channel = new.channel;

  if v_status = 'opted_out' then
    raise exception 'outreach_messages: candidate % has opted out of channel % — further automated communication is blocked (core rule: candidate consent/opt-out is deterministic and unbypassable)', new.candidate_id, new.channel
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists outreach_messages_enforce_opt_out on public.outreach_messages;
create trigger outreach_messages_enforce_opt_out
  before insert or update of status on public.outreach_messages
  for each row execute function public.enforce_outreach_message_opt_out_gate();

alter table public.outreach_messages enable row level security;

create policy outreach_messages_select_scoped
  on public.outreach_messages
  for select
  using (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin', 'read_only_reviewer']::public.app_role[])
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and public.can_access_candidate(candidate_id)
      and public.is_assigned_to_project(recruitment_project_id)
    )
  );

create policy outreach_messages_write_internal
  on public.outreach_messages
  for all
  using (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and public.can_access_candidate(candidate_id)
      and public.is_assigned_to_project(recruitment_project_id)
    )
  )
  with check (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and public.can_access_candidate(candidate_id)
      and public.is_assigned_to_project(recruitment_project_id)
    )
  );

-- ---------------------------------------------------------------------------
-- outreach_approvals
-- ---------------------------------------------------------------------------

create table if not exists public.outreach_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  outreach_message_id uuid not null references public.outreach_messages (id) on delete cascade,
  approver_id uuid not null references auth.users (id),
  decision text not null check (decision in ('approved', 'rejected', 'changes_requested')),
  -- Required for every decision except approving, mirroring human_reviews'
  -- reason-required-unless-approved shape (0027).
  reason text,
  -- Brief functional requirement #4 traceability: did the approver (or a
  -- prior recruiter) edit the draft before this decision was recorded.
  edited_before_approval boolean not null default false,
  created_at timestamptz not null default now(),
  constraint outreach_approvals_reason_required_unless_approved check (
    decision = 'approved' or (reason is not null and char_length(btrim(reason)) > 0)
  )
);

comment on table public.outreach_approvals is
  'Append-only recruiter review/approval record for one outreach_messages row (Build Phase 9 brief functional requirement #3). outreach_messages_enforce_approval reads decision = ''approved'' rows from here to gate the message status machine.';

create index if not exists outreach_approvals_message_idx
  on public.outreach_approvals (outreach_message_id, created_at desc);

revoke update, delete on public.outreach_approvals from authenticated, anon;

alter table public.outreach_approvals enable row level security;

create policy outreach_approvals_select_scoped
  on public.outreach_approvals
  for select
  using (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin', 'read_only_reviewer']::public.app_role[])
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and exists (
        select 1 from public.outreach_messages om
        where om.id = outreach_approvals.outreach_message_id
          and public.can_access_candidate(om.candidate_id)
          and public.is_assigned_to_project(om.recruitment_project_id)
      )
    )
  );

create policy outreach_approvals_insert_scoped
  on public.outreach_approvals
  for insert
  with check (
    approver_id = auth.uid()
    and (
      public.is_platform_admin()
      or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
      or (
        public.has_org_role(organization_id, array['recruiter']::public.app_role[])
        and exists (
          select 1 from public.outreach_messages om
          where om.id = outreach_approvals.outreach_message_id
            and public.can_access_candidate(om.candidate_id)
            and public.is_assigned_to_project(om.recruitment_project_id)
        )
      )
    )
  );

-- ---------------------------------------------------------------------------
-- communication_events
-- ---------------------------------------------------------------------------

create table if not exists public.communication_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  outreach_message_id uuid not null references public.outreach_messages (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  recruitment_project_id uuid not null references public.recruitment_projects (id) on delete cascade,
  channel text not null check (channel in ('email', 'phone', 'linkedin', 'sms')),
  direction text not null check (direction in ('outbound', 'inbound')),
  event_type text not null
    check (event_type in (
      'queued', 'sent', 'delivered', 'opened', 'bounced', 'failed', 'inbound_reply', 'manual_note'
    )),
  provider text,
  provider_message_id text,
  -- UNTRUSTED: provider webhook payloads and any inbound message text
  -- carried here are data, never instructions to this system or to any AI
  -- call that later reads them (docs/10-ai-evaluation-guardrails.md).
  raw_payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  recorded_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

comment on table public.communication_events is
  'Append-only provider/delivery event log per outreach_messages row (Build Phase 9 brief §DATABASE). raw_payload is untrusted external/candidate-originated data — see column comment.';

comment on column public.communication_events.raw_payload is
  'Untrusted: raw provider webhook body or inbound message payload. Never concatenated into an AI system prompt or treated as an instruction (docs/10-ai-evaluation-guardrails.md).';

create index if not exists communication_events_message_idx
  on public.communication_events (outreach_message_id, occurred_at desc);
create index if not exists communication_events_candidate_idx
  on public.communication_events (candidate_id, occurred_at desc);

-- Same opt-out hard gate as outreach_messages, scoped to direction =
-- 'outbound' events only (an inbound event, e.g. a bounce/reply
-- notification, must always be recordable regardless of opt-out status —
-- suppressing history would itself be a data-integrity problem).
create or replace function public.enforce_communication_event_opt_out_gate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if new.direction <> 'outbound' then
    return new;
  end if;

  select cp.status into v_status
    from public.communication_preferences cp
    where cp.organization_id = new.organization_id
      and cp.candidate_id = new.candidate_id
      and cp.channel = new.channel;

  if v_status = 'opted_out' then
    raise exception 'communication_events: candidate % has opted out of channel % — further outbound communication events are blocked', new.candidate_id, new.channel
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists communication_events_enforce_opt_out on public.communication_events;
create trigger communication_events_enforce_opt_out
  before insert on public.communication_events
  for each row execute function public.enforce_communication_event_opt_out_gate();

revoke update, delete on public.communication_events from authenticated, anon;

alter table public.communication_events enable row level security;

create policy communication_events_select_scoped
  on public.communication_events
  for select
  using (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin', 'read_only_reviewer']::public.app_role[])
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and public.can_access_candidate(candidate_id)
      and public.is_assigned_to_project(recruitment_project_id)
    )
  );

create policy communication_events_insert_scoped
  on public.communication_events
  for insert
  with check (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and public.can_access_candidate(candidate_id)
      and public.is_assigned_to_project(recruitment_project_id)
    )
  );

-- ---------------------------------------------------------------------------
-- candidate_responses
-- ---------------------------------------------------------------------------

create table if not exists public.candidate_responses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  recruitment_project_id uuid not null references public.recruitment_projects (id) on delete cascade,
  outreach_message_id uuid references public.outreach_messages (id) on delete set null,
  channel text not null check (channel in ('email', 'phone', 'linkedin', 'sms')),
  -- UNTRUSTED: candidate-authored inbound text. Never treated as
  -- instructions to this system or to any AI classification call that reads
  -- it (docs/10-ai-evaluation-guardrails.md; core rule: treat uploaded
  -- documents/messages as untrusted data).
  raw_response_text text not null check (char_length(btrim(raw_response_text)) > 0),
  received_at timestamptz not null default now(),
  -- AI's reviewable proposal only (brief functional requirement #9:
  -- "AI classification must be reviewable"). Never itself authoritative —
  -- see confirmed_classification below and this table's design-judgment
  -- note.
  ai_suggested_classification text
    check (ai_suggested_classification is null or ai_suggested_classification in (
      'interested', 'not_interested', 'needs_more_info', 'follow_up_later', 'opt_out', 'ambiguous'
    )),
  ai_confidence numeric(4, 3) check (ai_confidence is null or ai_confidence between 0 and 1),
  ai_run_id uuid references public.ai_runs (id) on delete set null,
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  -- The sole authoritative classification. Set only by a human reviewer
  -- (may confirm or override the AI suggestion) — this is the only field
  -- apply_confirmed_opt_out_classification() below reads, so an unreviewed
  -- AI 'opt_out' suggestion can never by itself trigger the opt-out hard
  -- gate (brief: "must not override opt-out rules"). DESIGN JUDGMENT CALL:
  -- the brief does not specify whether an AI-suggested opt-out should
  -- pre-emptively suppress sends pending review; this migration takes the
  -- more conservative reading (human confirmation required before the hard
  -- gate engages) to avoid an unreviewed AI call silently blocking
  -- legitimate outreach — flag this for the documentation wave to confirm
  -- against the business owner's intent.
  confirmed_classification text
    check (confirmed_classification is null or confirmed_classification in (
      'interested', 'not_interested', 'needs_more_info', 'follow_up_later', 'opt_out', 'ambiguous'
    )),
  review_note text,
  created_at timestamptz not null default now(),
  constraint candidate_responses_confirmed_requires_review check (
    confirmed_classification is null or (reviewed_by is not null and reviewed_at is not null)
  )
);

comment on table public.candidate_responses is
  'Inbound candidate reply + classification (Build Phase 9 brief §DATABASE, functional requirement #9). raw_response_text is untrusted candidate-authored data — see column comment. ai_suggested_classification is informational only; confirmed_classification (human-set) is the sole authoritative value and the only one the opt-out hard-gate trigger reads.';

create index if not exists candidate_responses_candidate_idx
  on public.candidate_responses (candidate_id, received_at desc);
create index if not exists candidate_responses_message_idx
  on public.candidate_responses (outreach_message_id);

-- Confirmed opt-out propagation: a human-reviewed 'opt_out' classification
-- deterministically upserts communication_preferences to opted_out for that
-- candidate+channel — this is the ONLY path (besides a direct recruiter
-- edit to communication_preferences itself) that can set opted_out, and it
-- requires reviewed_by/reviewed_at to already be set (enforced by the CHECK
-- constraint above), so an AI call alone can never reach it.
create or replace function public.apply_confirmed_opt_out_classification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.confirmed_classification = 'opt_out' then
    insert into public.communication_preferences (
      organization_id, candidate_id, channel, status, consent_source,
      opted_out_at, opted_out_reason, opted_out_by, updated_by
    )
    values (
      new.organization_id, new.candidate_id, new.channel, 'opted_out', 'response_classification',
      now(), 'Candidate response classified as opt-out (candidate_responses ' || new.id || ')',
      new.reviewed_by, new.reviewed_by
    )
    on conflict (organization_id, candidate_id, channel) do update
      set status = 'opted_out',
          consent_source = 'response_classification',
          opted_out_at = now(),
          opted_out_reason = excluded.opted_out_reason,
          opted_out_by = excluded.opted_out_by,
          updated_by = excluded.updated_by,
          updated_at = now()
      where public.communication_preferences.status <> 'opted_out';
  end if;

  return new;
end;
$$;

drop trigger if exists candidate_responses_apply_opt_out on public.candidate_responses;
create trigger candidate_responses_apply_opt_out
  after insert or update of confirmed_classification on public.candidate_responses
  for each row
  when (new.confirmed_classification = 'opt_out')
  execute function public.apply_confirmed_opt_out_classification();

alter table public.candidate_responses enable row level security;

create policy candidate_responses_select_scoped
  on public.candidate_responses
  for select
  using (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin', 'read_only_reviewer']::public.app_role[])
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and public.can_access_candidate(candidate_id)
      and public.is_assigned_to_project(recruitment_project_id)
    )
  );

create policy candidate_responses_insert_scoped
  on public.candidate_responses
  for insert
  with check (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and public.can_access_candidate(candidate_id)
      and public.is_assigned_to_project(recruitment_project_id)
    )
  );

-- Review/classification is recorded via UPDATE, always attributed to the
-- acting user (reviewed_by = auth.uid()), mirroring human_reviews'
-- reviewer_id = auth.uid() insert-time rule but applied at update time
-- since the row already exists when a reply first arrives.
create policy candidate_responses_update_review
  on public.candidate_responses
  for update
  using (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and public.can_access_candidate(candidate_id)
      and public.is_assigned_to_project(recruitment_project_id)
    )
  )
  with check (
    reviewed_by is null or reviewed_by = auth.uid()
  );

-- ---------------------------------------------------------------------------
-- Grants (roles created in 0001; RLS above is the real gate, these mirror
-- the existing table-privilege baseline established across every prior
-- migration). Append-only tables (outreach_approvals, communication_events)
-- deliberately receive no update/delete grant — see the revokes above.
-- ---------------------------------------------------------------------------

grant select, insert, update on public.communication_preferences to authenticated;
grant select, insert, update on public.outreach_templates to authenticated;
grant select, insert, update on public.outreach_sequences to authenticated;
grant select, insert, update on public.outreach_messages to authenticated;
grant select, insert on public.outreach_approvals to authenticated;
grant select, insert on public.communication_events to authenticated;
grant select, insert, update on public.candidate_responses to authenticated;
