-- 0027_candidate_matching.sql
-- docs/07-data-model.md §7.1/§7.9, docs/08-candidate-scoring.md (Build Phase
-- 7 brief "Candidate Matching": "Implement transparent candidate-to-role
-- evaluation using mandatory gates, deterministic scoring, semantic
-- assistance and evidence confidence.").
--
-- Seven new tables, in dependency order:
--
--   matching_runs          — append-only execution history, one row per
--                             evaluation ATTEMPT (mirrors
--                             candidate_document_processing_jobs' job-row
--                             convention from Build Phase 6). Every
--                             recalculation (brief §8.8: scorecard
--                             re-approved, document re-uploaded, manual
--                             re-score) is a NEW row here — history is
--                             never overwritten in place.
--   candidate_role_matches — the mutable "current state" projection for one
--                             (candidate, job) pair: the latest run's
--                             eligibility/score/coverage/review status, what
--                             the rest of the UI (shortlist, pipeline)
--                             actually reads. Always points at its
--                             `latest_matching_run_id`.
--   mandatory_gate_results — one row per mandatory requirement per run.
--                             Brief's five gate states (Passed/Failed/
--                             Unknown/Requires Verification/Human Override)
--                             live in `state`; `deterministic_result` is the
--                             immutable raw pass/fail/insufficient_evidence
--                             computation a human override can never mutate
--                             (brief: "AI does not calculate or control the
--                             final numeric score" / a deterministic
--                             re-check, not a judgment call, produces this).
--   requirement_evidence   — one row per evidence item backing a gate or a
--                             scored preferred requirement (brief:
--                             "Retrieve relevant candidate evidence").
--   scoring_breakdowns     — one row per PREFERRED requirement per run: the
--                             deterministic weighted-contribution arithmetic
--                             (docs/08-candidate-scoring.md §8.3), never an
--                             AI output itself even though `raw_score` came
--                             from an AI semantic-similarity call.
--   human_reviews          — a reviewer's decision on a candidate_role_match
--                             (approve for outreach / reject / request
--                             verification / gate override), append-only.
--   review_decisions       — structured before/after detail for one
--                             human_reviews decision (mirrors the existing
--                             human_reviews/review_decisions relationship
--                             already named in docs/07-data-model.md §7.1).
--
-- Quality thresholds (brief "Use configurable defaults... Do not hardcode
-- these globally") are nullable per-scorecard override columns added to
-- `scorecards` at the end of this file; a null falls back to the system
-- default constants in packages/types/src/matching.ts, never a literal
-- inlined in scoring logic.

-- ---------------------------------------------------------------------------
-- matching_runs
-- ---------------------------------------------------------------------------

create table if not exists public.matching_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  recruitment_project_id uuid not null references public.recruitment_projects (id) on delete cascade,
  scorecard_id uuid not null references public.scorecards (id) on delete cascade,
  -- Step 1 of the pipeline: "Freeze the scorecard version" — every run
  -- pins the exact approved version it was scored against (docs/08-
  -- candidate-scoring.md §8.9), never the live, possibly-since-edited
  -- scorecard.
  scorecard_version_id uuid not null references public.scorecard_versions (id) on delete restrict,
  status text not null default 'queued'
    check (status in (
      'queued', 'evaluating_gates', 'assessing_semantic', 'scoring', 'completed', 'failed'
    )),
  -- Why this run happened — never blank, so "was this an initial score or a
  -- rescore, and why" is always answerable (docs/08-candidate-scoring.md
  -- §8.8's three recalculation triggers, plus an explicit manual reason).
  trigger_reason text not null
    check (trigger_reason in (
      'initial_evaluation', 'scorecard_version_changed', 'candidate_document_updated', 'manual_reevaluation'
    )),
  trigger_note text,
  ai_run_id uuid references public.ai_runs (id) on delete set null,
  error_kind text check (error_kind in (
    'ai_not_configured', 'timeout', 'network', 'provider_error', 'validation_failed', 'internal_error'
  )),
  error_message text,
  requested_by uuid references auth.users (id),
  started_at timestamptz,
  completed_at timestamptz,
  -- <candidate_id>:<job_id>:<attempt_no>, guarantees a retried request never
  -- double-runs the pipeline (same convention as ai_runs.idempotency_key /
  -- candidate_document_processing_jobs.idempotency_key).
  idempotency_key text,
  created_at timestamptz not null default now()
);

comment on table public.matching_runs is
  'Append-only execution history for the candidate-matching pipeline (docs/08-candidate-scoring.md). One row per evaluation attempt; candidate_role_matches is the mutable "current result" projection this feeds.';

create unique index if not exists matching_runs_org_idempotency_key_idx
  on public.matching_runs (organization_id, idempotency_key)
  where idempotency_key is not null;

-- At most one truly in-flight run per (candidate, job) — mirrors 0025's
-- narrowed in-flight index: only states doing active work block a new
-- attempt, never a terminal one.
create unique index if not exists matching_runs_one_inflight_idx
  on public.matching_runs (candidate_id, job_id)
  where status in ('queued', 'evaluating_gates', 'assessing_semantic', 'scoring');

create index if not exists matching_runs_candidate_job_idx
  on public.matching_runs (candidate_id, job_id, created_at desc);
create index if not exists matching_runs_project_idx
  on public.matching_runs (recruitment_project_id, created_at desc);

revoke update, delete on public.matching_runs from authenticated, anon;

-- ---------------------------------------------------------------------------
-- candidate_role_matches
-- ---------------------------------------------------------------------------

create table if not exists public.candidate_role_matches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  recruitment_project_id uuid not null references public.recruitment_projects (id) on delete cascade,
  scorecard_version_id uuid not null references public.scorecard_versions (id) on delete restrict,
  latest_matching_run_id uuid not null references public.matching_runs (id) on delete restrict,
  -- Deterministic eligibility, derived purely from mandatory_gate_results
  -- (brief: "A failed mandatory gate makes the candidate ineligible for
  -- ranked shortlisting" / "Unknown is not equivalent to passed"). Never
  -- set directly by AI.
  eligibility text not null default 'pending'
    check (eligibility in ('eligible', 'ineligible', 'pending_verification')),
  -- Null whenever eligibility <> 'eligible' — a failed/unresolved gate
  -- suppresses the candidate from ranked output entirely (docs/08-
  -- candidate-scoring.md §8.3), enforced by the check constraint below, not
  -- just application code.
  overall_score numeric(5, 2) check (overall_score is null or overall_score between 0 and 100),
  evidence_coverage_pct numeric(5, 2) not null default 0 check (evidence_coverage_pct between 0 and 100),
  data_completeness_pct numeric(5, 2) not null default 0 check (data_completeness_pct between 0 and 100),
  -- Aggregate confidence across scored criteria (Layer D), shown separately
  -- from overall_score per the brief's "Do not combine these into one
  -- misleading number."
  confidence numeric(4, 3) check (confidence is null or confidence between 0 and 1),
  review_status text not null default 'pending'
    check (review_status in ('pending', 'approved_for_outreach', 'rejected', 'requires_verification')),
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (candidate_id, job_id),
  constraint candidate_role_matches_score_only_when_eligible check (
    eligibility = 'eligible' or overall_score is null
  )
);

comment on table public.candidate_role_matches is
  'Current-state projection for one (candidate, job) pair (docs/08-candidate-scoring.md). Always the latest matching_runs result; the full evaluation history for a pair lives across matching_runs/mandatory_gate_results/scoring_breakdowns rows, never overwritten.';

comment on column public.candidate_role_matches.overall_score is
  'Weighted score (0-100). NULL whenever eligibility is not eligible — a failed or unresolved mandatory gate excludes the candidate from ranked output by construction (docs/08-candidate-scoring.md §8.3), not just by UI filtering.';

create index if not exists candidate_role_matches_job_idx
  on public.candidate_role_matches (job_id, eligibility, overall_score desc nulls last);
create index if not exists candidate_role_matches_project_idx
  on public.candidate_role_matches (recruitment_project_id);
create index if not exists candidate_role_matches_candidate_idx
  on public.candidate_role_matches (candidate_id);

drop trigger if exists candidate_role_matches_set_updated_at on public.candidate_role_matches;
create trigger candidate_role_matches_set_updated_at
  before update on public.candidate_role_matches
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- mandatory_gate_results
-- ---------------------------------------------------------------------------

create table if not exists public.mandatory_gate_results (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  matching_run_id uuid not null references public.matching_runs (id) on delete cascade,
  candidate_role_match_id uuid not null references public.candidate_role_matches (id) on delete cascade,
  requirement_id uuid not null references public.job_requirements (id) on delete restrict,
  -- Denormalized so this row stays legible even if the live requirement is
  -- later edited/reclassified — history reads the snapshot, not a join.
  requirement_name text not null,
  -- The immutable, deterministic re-check outcome (docs/08-candidate-
  -- scoring.md §8.5) — a rule, never a judgment call, and never itself
  -- mutated by a human override below.
  deterministic_result text not null
    check (deterministic_result in ('pass', 'fail', 'insufficient_evidence')),
  -- AI's draft suggestion feeding the deterministic re-check (brief: "AI
  -- only proposes... which a deterministic re-check confirms"). Purely
  -- informational — never the stored authoritative value.
  ai_suggested_result text
    check (ai_suggested_result is null or ai_suggested_result in ('pass', 'fail', 'insufficient_evidence')),
  ai_suggestion_note text,
  -- e.g. "12-month notice-period conflict with the role's start date" —
  -- workflow #11 risk detection (brief §UI: "Risks"). Carried straight from
  -- the AI assessment's evidence-grounded riskNotes for this requirement;
  -- empty array rather than fabricated when nothing is actually supported.
  risk_notes text[] not null default '{}',
  -- The brief's five displayed gate states. Derived from
  -- deterministic_result (pass->passed, fail->failed,
  -- insufficient_evidence->unknown), 'requires_verification' when a
  -- reviewer has explicitly flagged an unknown for follow-up, and
  -- 'human_override' once a reviewer has recorded an override below.
  state text not null
    check (state in ('passed', 'failed', 'unknown', 'requires_verification', 'human_override')),
  verification_requested_by uuid references auth.users (id),
  verification_requested_at timestamptz,
  verification_note text,
  -- A human override always requires: authorized role (enforced by the
  -- write RLS policy + application-layer requirePermission check on
  -- 'human_reviews'), a reason, supporting evidence, and a timestamp
  -- (brief §"A human override must require"). The check constraint below
  -- makes all four mandatory together at the database layer, not just in
  -- application code.
  override_result text check (override_result is null or override_result in ('pass', 'fail')),
  override_by uuid references auth.users (id),
  override_reason text,
  override_evidence_note text,
  override_at timestamptz,
  created_at timestamptz not null default now(),
  constraint mandatory_gate_results_override_requires_full_record check (
    state <> 'human_override'
    or (
      override_result is not null
      and override_by is not null
      and override_reason is not null and char_length(btrim(override_reason)) > 0
      and override_evidence_note is not null and char_length(btrim(override_evidence_note)) > 0
      and override_at is not null
    )
  ),
  unique (matching_run_id, requirement_id)
);

comment on table public.mandatory_gate_results is
  'One row per mandatory requirement per matching_runs attempt (docs/08-candidate-scoring.md §8.5). deterministic_result is the immutable rule outcome; state is what the UI shows, including any human override recorded here.';

create index if not exists mandatory_gate_results_run_idx
  on public.mandatory_gate_results (matching_run_id);
create index if not exists mandatory_gate_results_match_idx
  on public.mandatory_gate_results (candidate_role_match_id);

revoke delete on public.mandatory_gate_results from authenticated, anon;

-- ---------------------------------------------------------------------------
-- requirement_evidence
-- ---------------------------------------------------------------------------

create table if not exists public.requirement_evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  matching_run_id uuid not null references public.matching_runs (id) on delete cascade,
  candidate_role_match_id uuid not null references public.candidate_role_matches (id) on delete cascade,
  requirement_id uuid not null references public.job_requirements (id) on delete restrict,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  -- Which candidate record this excerpt was pulled from, so the evidence
  -- viewer can always resolve back to a real, inspectable source (brief
  -- §DATABASE / docs/08-candidate-scoring.md §8.2's "evidence source").
  source_kind text not null
    check (source_kind in (
      'experience', 'education', 'certification', 'skill', 'extracted_field', 'profile'
    )),
  source_experience_id uuid references public.candidate_experiences (id) on delete set null,
  source_education_id uuid references public.candidate_education (id) on delete set null,
  source_certification_id uuid references public.candidate_certifications (id) on delete set null,
  source_skill_id uuid references public.candidate_skills (id) on delete set null,
  source_extracted_field_id uuid references public.candidate_extracted_fields (id) on delete set null,
  excerpt text not null check (char_length(btrim(excerpt)) > 0),
  location text,
  -- Layer C: semantic similarity strength (requirement <-> evidence).
  relevance_score numeric(4, 3) check (relevance_score is null or relevance_score between 0 and 1),
  -- Layer D: combined evidence confidence (docs/08-candidate-scoring.md
  -- §8.6) — similarity strength + directness + source reliability.
  confidence numeric(4, 3) check (confidence is null or confidence between 0 and 1),
  -- Direct ("managed P&L for 42 units") vs inferred ("extensive multi-unit
  -- experience") — §8.6's directness component, retained explicitly rather
  -- than folded silently into confidence, for explainability.
  is_direct_statement boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.requirement_evidence is
  'One evidence unit per requirement x candidate per matching run (docs/08-candidate-scoring.md §8.2/§8.6). Each component of the confidence calculation is retained separately, never collapsed into a single black-box number.';

create index if not exists requirement_evidence_run_idx
  on public.requirement_evidence (matching_run_id);
create index if not exists requirement_evidence_match_idx
  on public.requirement_evidence (candidate_role_match_id, requirement_id);

revoke update, delete on public.requirement_evidence from authenticated, anon;

-- ---------------------------------------------------------------------------
-- scoring_breakdowns
-- ---------------------------------------------------------------------------

create table if not exists public.scoring_breakdowns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  matching_run_id uuid not null references public.matching_runs (id) on delete cascade,
  candidate_role_match_id uuid not null references public.candidate_role_matches (id) on delete cascade,
  requirement_id uuid not null references public.job_requirements (id) on delete restrict,
  requirement_name text not null,
  -- Snapshot from scorecard_versions.requirement_snapshot at freeze time
  -- (docs/08-candidate-scoring.md §8.9) — never re-read from the live,
  -- possibly-since-edited job_requirements row.
  weight numeric(5, 2) not null check (weight between 0 and 100),
  -- Layer C: AI semantic-similarity judgment, 0-1. Null when no evidence at
  -- all was found (docs/08-candidate-scoring.md §8.7: contributes 0, never
  -- imputed).
  raw_score numeric(4, 3) check (raw_score is null or raw_score between 0 and 1),
  -- Layer D: the confidence discount multiplier applied to raw_score
  -- (e.g. x0.6 for an unverified/low-confidence match) — never scored at
  -- face value per §8.3.
  confidence_discount numeric(4, 3) not null default 1
    check (confidence_discount between 0 and 1),
  -- raw_score * confidence_discount, retained as its own column so the
  -- discount's effect is independently inspectable, not just implied by
  -- comparing raw_score to weighted_contribution.
  effective_score numeric(4, 3) check (effective_score is null or effective_score between 0 and 1),
  -- effective_score * weight — this run's deterministic contribution to
  -- the un-normalized weighted sum (docs/08-candidate-scoring.md §8.3's
  -- formula numerator term). Arithmetic only, never an AI output itself.
  weighted_contribution numeric(7, 3) not null default 0,
  has_evidence boolean not null default false,
  -- Same risk-note carry-through as mandatory_gate_results.risk_notes above
  -- (brief §UI: "Risks") — a preferred requirement can surface a risk too
  -- (e.g. "domain exposure is adjacent, not direct").
  risk_notes text[] not null default '{}',
  created_at timestamptz not null default now()
);

comment on table public.scoring_breakdowns is
  'One row per PREFERRED requirement per matching run — the deterministic weighted-score arithmetic (docs/08-candidate-scoring.md §8.3). raw_score may come from an AI semantic-similarity call, but the aggregation into weighted_contribution is a fixed formula, computed in application code, never an LLM output.';

create index if not exists scoring_breakdowns_run_idx
  on public.scoring_breakdowns (matching_run_id);
create index if not exists scoring_breakdowns_match_idx
  on public.scoring_breakdowns (candidate_role_match_id);

revoke update, delete on public.scoring_breakdowns from authenticated, anon;

-- ---------------------------------------------------------------------------
-- human_reviews
-- ---------------------------------------------------------------------------

create table if not exists public.human_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  candidate_role_match_id uuid not null references public.candidate_role_matches (id) on delete cascade,
  matching_run_id uuid not null references public.matching_runs (id) on delete cascade,
  reviewer_id uuid not null references auth.users (id),
  decision text not null
    check (decision in ('approved_for_outreach', 'rejected', 'requires_verification', 'gate_overridden')),
  -- Required for every decision here (brief §UI: "Reject with reason";
  -- §"A human override must require... Reason"). Approving for outreach is
  -- the one decision where a reason is informative rather than mandatory,
  -- so it alone may be blank.
  reason text,
  created_at timestamptz not null default now(),
  constraint human_reviews_reason_required_unless_approved check (
    decision = 'approved_for_outreach' or (reason is not null and char_length(btrim(reason)) > 0)
  )
);

comment on table public.human_reviews is
  'Append-only reviewer decision on a candidate_role_match (docs/08-candidate-scoring.md §8.10, Build Phase 7 brief §UI). review_decisions below carries the structured before/after detail for a given decision.';

create index if not exists human_reviews_match_idx
  on public.human_reviews (candidate_role_match_id, created_at desc);

revoke update, delete on public.human_reviews from authenticated, anon;

-- ---------------------------------------------------------------------------
-- review_decisions
-- ---------------------------------------------------------------------------

create table if not exists public.review_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  human_review_id uuid not null references public.human_reviews (id) on delete cascade,
  -- e.g. 'eligibility', 'gate:<requirement_id>', 'overall_score' — which
  -- field this decision changed, mirroring the existing human_reviews /
  -- review_decisions relationship already named in docs/07-data-model.md
  -- §7.1 for the (not-yet-built at the time) candidate_role_matches entity.
  field text not null,
  before_value jsonb,
  after_value jsonb,
  reason text not null check (char_length(btrim(reason)) > 0),
  created_at timestamptz not null default now()
);

comment on table public.review_decisions is
  'Structured before/after detail for one human_reviews decision (docs/07-data-model.md §7.1, docs/08-candidate-scoring.md §8.10).';

create index if not exists review_decisions_human_review_idx
  on public.review_decisions (human_review_id);

revoke update, delete on public.review_decisions from authenticated, anon;

-- ---------------------------------------------------------------------------
-- Row Level Security — every table above follows the same shape as
-- job_requirements/scorecards (docs/06-roles-permissions.md §6.2.2):
-- Platform Admin + Agency Admin + Read-Only Reviewer org-wide; Recruiter
-- scoped to can_access_candidate(candidate_id) AND
-- is_assigned_to_project(recruitment_project_id); Client Decision-Maker
-- NONE on all seven tables this phase — matching internals (gate detail,
-- evidence, review reasoning) are recruiter/admin-facing only in this
-- build; a client-facing shortlist view is explicitly out of scope for
-- this phase and left to a future Shortlist build (see
-- docs/build-phase-7-report.md).
-- ---------------------------------------------------------------------------

alter table public.matching_runs enable row level security;
alter table public.candidate_role_matches enable row level security;
alter table public.mandatory_gate_results enable row level security;
alter table public.requirement_evidence enable row level security;
alter table public.scoring_breakdowns enable row level security;
alter table public.human_reviews enable row level security;
alter table public.review_decisions enable row level security;

do $$
declare
  t text;
begin
  -- Tables scoped directly by (organization_id, candidate_id, recruitment_project_id).
  foreach t in array array['matching_runs', 'candidate_role_matches']
  loop
    execute format(
      $p$create policy %I_select_scoped
        on public.%I
        for select
        using (
          public.is_platform_admin()
          or public.has_org_role(organization_id, array['agency_admin', 'read_only_reviewer']::public.app_role[])
          or (
            public.has_org_role(organization_id, array['recruiter']::public.app_role[])
            and public.can_access_candidate(candidate_id)
            and public.is_assigned_to_project(recruitment_project_id)
          )
        )$p$,
      t, t
    );

    execute format(
      $p$create policy %I_write_internal
        on public.%I
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
        )$p$,
      t, t
    );
  end loop;
end
$$;

-- mandatory_gate_results / requirement_evidence / scoring_breakdowns are
-- reached via their parent candidate_role_matches row rather than carrying
-- recruitment_project_id/candidate_id scoping columns of their own for
-- is_assigned_to_project — join back to candidate_role_matches for the
-- project check, and use requirement_evidence/mandatory_gate_results/
-- scoring_breakdowns' own candidate linkage where present.
do $$
declare
  t text;
  candidate_col text;
begin
  foreach t in array array['mandatory_gate_results', 'scoring_breakdowns']
  loop
    execute format(
      $p$create policy %I_select_scoped
        on public.%I
        for select
        using (
          public.is_platform_admin()
          or public.has_org_role(organization_id, array['agency_admin', 'read_only_reviewer']::public.app_role[])
          or (
            public.has_org_role(organization_id, array['recruiter']::public.app_role[])
            and exists (
              select 1 from public.candidate_role_matches crm
              where crm.id = %I.candidate_role_match_id
                and public.can_access_candidate(crm.candidate_id)
                and public.is_assigned_to_project(crm.recruitment_project_id)
            )
          )
        )$p$,
      t, t, t
    );

    execute format(
      $p$create policy %I_write_internal
        on public.%I
        for insert
        with check (
          public.is_platform_admin()
          or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
          or (
            public.has_org_role(organization_id, array['recruiter']::public.app_role[])
            and exists (
              select 1 from public.candidate_role_matches crm
              where crm.id = %I.candidate_role_match_id
                and public.can_access_candidate(crm.candidate_id)
                and public.is_assigned_to_project(crm.recruitment_project_id)
            )
          )
        )$p$,
      t, t, t
    );
  end loop;

  -- mandatory_gate_results also needs an UPDATE policy (the human-override
  -- fields are set via UPDATE, not insert-only, unlike scoring_breakdowns).
  execute $p$create policy mandatory_gate_results_update_override
    on public.mandatory_gate_results
    for update
    using (
      public.is_platform_admin()
      or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
      or (
        public.has_org_role(organization_id, array['recruiter']::public.app_role[])
        and exists (
          select 1 from public.candidate_role_matches crm
          where crm.id = mandatory_gate_results.candidate_role_match_id
            and public.can_access_candidate(crm.candidate_id)
            and public.is_assigned_to_project(crm.recruitment_project_id)
        )
      )
    )
    with check (
      public.is_platform_admin()
      or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
      or (
        public.has_org_role(organization_id, array['recruiter']::public.app_role[])
        and exists (
          select 1 from public.candidate_role_matches crm
          where crm.id = mandatory_gate_results.candidate_role_match_id
            and public.can_access_candidate(crm.candidate_id)
            and public.is_assigned_to_project(crm.recruitment_project_id)
        )
      )
    )$p$;

  candidate_col := 'candidate_id';
  execute format(
    $p$create policy requirement_evidence_select_scoped
      on public.requirement_evidence
      for select
      using (
        public.is_platform_admin()
        or public.has_org_role(organization_id, array['agency_admin', 'read_only_reviewer']::public.app_role[])
        or (
          public.has_org_role(organization_id, array['recruiter']::public.app_role[])
          and exists (
            select 1 from public.candidate_role_matches crm
            where crm.id = requirement_evidence.candidate_role_match_id
              and public.can_access_candidate(crm.candidate_id)
              and public.is_assigned_to_project(crm.recruitment_project_id)
          )
        )
      )$p$
  );

  execute $p$create policy requirement_evidence_write_internal
    on public.requirement_evidence
    for insert
    with check (
      public.is_platform_admin()
      or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
      or (
        public.has_org_role(organization_id, array['recruiter']::public.app_role[])
        and exists (
          select 1 from public.candidate_role_matches crm
          where crm.id = requirement_evidence.candidate_role_match_id
            and public.can_access_candidate(crm.candidate_id)
            and public.is_assigned_to_project(crm.recruitment_project_id)
        )
      )
    )$p$;
end
$$;

-- human_reviews / review_decisions: gated on the SAME row-level scope, but
-- writes additionally require reviewer_id = auth.uid() (a review is always
-- recorded as the acting user's own decision, never on another user's
-- behalf) — this is the 'human_reviews' permission-matrix resource
-- (docs/06-roles-permissions.md §6.2: agency_admin/recruiter = full,
-- client_decision_maker = none).

create policy human_reviews_select_scoped
  on public.human_reviews
  for select
  using (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin', 'read_only_reviewer']::public.app_role[])
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and exists (
        select 1 from public.candidate_role_matches crm
        where crm.id = human_reviews.candidate_role_match_id
          and public.can_access_candidate(crm.candidate_id)
          and public.is_assigned_to_project(crm.recruitment_project_id)
      )
    )
  );

create policy human_reviews_insert_scoped
  on public.human_reviews
  for insert
  with check (
    reviewer_id = auth.uid()
    and (
      public.is_platform_admin()
      or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
      or (
        public.has_org_role(organization_id, array['recruiter']::public.app_role[])
        and exists (
          select 1 from public.candidate_role_matches crm
          where crm.id = human_reviews.candidate_role_match_id
            and public.can_access_candidate(crm.candidate_id)
            and public.is_assigned_to_project(crm.recruitment_project_id)
        )
      )
    )
  );

create policy review_decisions_select_scoped
  on public.review_decisions
  for select
  using (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin', 'read_only_reviewer']::public.app_role[])
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and exists (
        select 1
        from public.human_reviews hr
        join public.candidate_role_matches crm on crm.id = hr.candidate_role_match_id
        where hr.id = review_decisions.human_review_id
          and public.can_access_candidate(crm.candidate_id)
          and public.is_assigned_to_project(crm.recruitment_project_id)
      )
    )
  );

create policy review_decisions_insert_scoped
  on public.review_decisions
  for insert
  with check (
    public.is_platform_admin()
    or public.has_org_role(organization_id, array['agency_admin']::public.app_role[])
    or (
      public.has_org_role(organization_id, array['recruiter']::public.app_role[])
      and exists (
        select 1
        from public.human_reviews hr
        join public.candidate_role_matches crm on crm.id = hr.candidate_role_match_id
        where hr.id = review_decisions.human_review_id
          and public.can_access_candidate(crm.candidate_id)
          and public.is_assigned_to_project(crm.recruitment_project_id)
      )
    )
  );

-- ---------------------------------------------------------------------------
-- ai_runs / ai_prompt_versions: extend workflow_type to admit
-- 'candidate_matching' (Layer C semantic-relevance calls). Same pattern as
-- 0022's error_kind extension in 0026 — drop and recreate the check.
-- ---------------------------------------------------------------------------

alter table public.ai_runs drop constraint if exists ai_runs_workflow_type_check;
alter table public.ai_runs
  add constraint ai_runs_workflow_type_check
  check (workflow_type in ('requirement_extraction', 'candidate_document_extraction', 'candidate_matching'));

alter table public.ai_prompt_versions drop constraint if exists ai_prompt_versions_workflow_type_check;
alter table public.ai_prompt_versions
  add constraint ai_prompt_versions_workflow_type_check
  check (workflow_type in ('requirement_extraction', 'candidate_document_extraction', 'candidate_matching'));

-- ---------------------------------------------------------------------------
-- Configurable quality thresholds (brief: "Use configurable defaults...
-- Do not hardcode these globally"). Nullable per-scorecard overrides; a
-- null falls back to the system default constants in
-- packages/types/src/matching.ts (DEFAULT_RANKED_CONSIDERATION_THRESHOLD_PCT
-- = 90, DEFAULT_PREFERRED_SHORTLIST_THRESHOLD_PCT = 95), resolved by
-- apps/web/lib/matching/thresholds.ts — never a literal inlined into
-- scoring logic. Mandatory-gate compliance is always 100% and unsupported
-- claims are always zero-tolerance — those two are structural guarantees
-- (docs/10-ai-evaluation-guardrails.md §10.13), not configurable numbers,
-- so they have no column here.
-- ---------------------------------------------------------------------------

alter table public.scorecards
  add column if not exists ranked_consideration_threshold_pct numeric(5, 2)
    check (ranked_consideration_threshold_pct is null or ranked_consideration_threshold_pct between 0 and 100);
alter table public.scorecards
  add column if not exists preferred_shortlist_threshold_pct numeric(5, 2)
    check (preferred_shortlist_threshold_pct is null or preferred_shortlist_threshold_pct between 0 and 100);

comment on column public.scorecards.ranked_consideration_threshold_pct is
  'Configurable per-scorecard override of the "ranked consideration" quality threshold (Build Phase 7 brief §"Quality thresholds"). NULL means "use the system default" (90%), never hardcoded in scoring logic.';
comment on column public.scorecards.preferred_shortlist_threshold_pct is
  'Configurable per-scorecard override of the "preferred shortlist" quality threshold (Build Phase 7 brief §"Quality thresholds"). NULL means "use the system default" (95%), never hardcoded in scoring logic.';
