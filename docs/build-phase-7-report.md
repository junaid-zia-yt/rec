# Build Phase 7 report — Candidate Matching

Per docs/21-implementation-contract.md §21.14 and the Build Phase 7
completion gate. Covers exactly what this phase implements: the full
docs/08-candidate-scoring.md evaluation pipeline — deterministic mandatory
gates, deterministic weighted scoring, an AI-assisted semantic-relevance/
evidence/risk-note assessment layer, configurable quality thresholds, a
human review/override workflow with a full audit trail, and the candidate
detail page's new "Evaluation" tab. A client-facing shortlist or finalist-
comparison view is explicitly **out of scope** for this phase and deferred
to a future Shortlist build (see §6 below).

**The same two blockers carried into every prior phase's report remain
unchanged in kind, with no new blocker this phase**:

1. No live Supabase project is connected to this repository's environment
   (no `apps/web/.env.local`, no `SUPABASE_*` env vars) — the full schema
   and RLS policy set were instead functionally verified against a real
   local PostgreSQL 16 instance (§2.2).
2. No `ANTHROPIC_API_KEY` is configured — this phase's entire AI-assisted
   assessment path (`AnthropicMatchingProvider`) has never been exercised
   against the real API; its behavior is verified via the deterministic
   `TestMatchingAIProvider` double instead, run against real candidate/
   scorecard fixtures through the actual orchestration/validation code
   (§1.3, §2).

Everything below is code-complete, typechecked, linted, and tested at every
layer that does not require a live backend or a real AI provider, and — as
with every prior phase — the full schema and its Row Level Security
policies were functionally verified against a real local PostgreSQL 16
instance, including live role-switching RLS tests specific to the seven new
tables (§2.2).

## 0. Pre-build verification

The full existing test/typecheck/lint/build suite was confirmed green
before any Phase 7 code was written (280 tests, matching the Phase 6
report's final count).

## 1. What was implemented

### 1.1 Database schema + RLS (migration `0027_candidate_matching.sql`)

Seven new tables, in dependency order:

| Table                    | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `matching_runs`          | Append-only execution history — one row per evaluation attempt (mirrors `candidate_document_processing_jobs`'s job-row convention). Every recalculation (scorecard re-approved, document re-uploaded, manual re-score — docs/08-candidate-scoring.md §8.8) is a new row, history is never overwritten. `status` state machine (queued → evaluating_gates → assessing_semantic → scoring → completed/failed), `trigger_reason` (initial_evaluation/scorecard_version_changed/candidate_document_updated/manual_reevaluation, never blank), idempotency key + partial in-flight unique index (same narrowed-states pattern as Build Phase 6's `0025` fix). |
| `candidate_role_matches` | The mutable "current state" projection for one (candidate, job) pair — always points at `latest_matching_run_id`. `eligibility` (eligible/ineligible/pending_verification) is derived purely from gate results, never set directly by AI. `overall_score` is CHECK-constrained to null whenever `eligibility <> 'eligible'` — the failed-gate-suppresses-ranking rule enforced at the database layer, not just in application code.                                                                                                                                                                                                                      |
| `mandatory_gate_results` | One row per mandatory requirement per run. `deterministic_result` (pass/fail/insufficient_evidence) is the immutable rule outcome; `ai_suggested_result` is the AI's draft proposal, purely informational; `state` is the brief's five displayed states (passed/failed/unknown/requires_verification/human_override); `risk_notes text[]`. A human override requires `override_result`+`override_by`+`override_reason`+`override_evidence_note`+`override_at` all present together, enforced by the `mandatory_gate_results_override_requires_full_record` CHECK constraint.                                                                             |
| `requirement_evidence`   | One evidence unit per requirement×candidate per run — `source_kind` plus a nullable FK to the specific source row (experience/education/certification/skill/extracted_field/profile), `excerpt`, `location`, `relevance_score` (Layer C), `confidence` (Layer D), `is_direct_statement` (the §8.6 directness component, retained separately rather than folded into confidence).                                                                                                                                                                                                                                                                         |
| `scoring_breakdowns`     | One row per preferred requirement per run — `weight`, `raw_score` (Layer C, may be AI-sourced), `confidence_discount` (Layer D), `effective_score` = raw_score × discount, `weighted_contribution` = effective_score × weight (the §8.3 formula's numerator term — arithmetic only, never an AI output), `has_evidence`, `risk_notes text[]`.                                                                                                                                                                                                                                                                                                            |
| `human_reviews`          | Append-only reviewer decision (approved_for_outreach/rejected/requires_verification/gate_overridden). Reason required unless approving.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `review_decisions`       | Structured before/after detail for one `human_reviews` decision — `field`, `before_value`/`after_value` (jsonb), `reason` (required, non-empty).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

Two `scorecards` columns were also added: nullable `ranked_consideration_threshold_pct` and `preferred_shortlist_threshold_pct` (both CHECK-constrained 0–100) — the brief's "use configurable defaults, do not hardcode these globally," resolved by `apps/web/lib/matching/thresholds.ts` (§1.2) rather than any literal in scoring code.

`ai_runs.workflow_type` and `ai_prompt_versions.workflow_type` CHECK constraints were both extended (drop-and-recreate, same pattern as Build Phase 6's `0026` `error_kind` extension) to additionally admit `'candidate_matching'`, alongside the existing `'requirement_extraction'`/`'candidate_document_extraction'` values.

**RLS**, following the established §6.2.2/§6.2.3/§6.2.4 shape: Platform Admin/Agency Admin/Read-Only Reviewer org-wide; Recruiter scoped to `can_access_candidate(candidate_id)` **and** `is_assigned_to_project(recruitment_project_id)` together (directly on `matching_runs`/`candidate_role_matches`, or via a join back to the parent `candidate_role_matches` row for the four child tables); `human_reviews` inserts additionally require `reviewer_id = auth.uid()` so a review can never be recorded on another user's behalf. **Client Decision-Maker has no policy at all on any of the seven tables** — a deliberate scope decision, not an oversight (docs/06-roles-permissions.md §6.2.5). Append-only enforcement via `REVOKE UPDATE, DELETE` at the database-role level on `matching_runs`, `requirement_evidence`, `scoring_breakdowns`, `human_reviews`, `review_decisions`; `mandatory_gate_results` instead gets `REVOKE DELETE` plus an explicit `UPDATE` policy scoped identically to its insert policy, since the human-override fields are legitimately set via UPDATE.

All migrations `0001`–`0027` were applied to a freshly created local PostgreSQL 16 database in strict numeric order with zero errors.

**Self-correction found and fixed during this build, before verification, not a late patch:** `risk_notes text[]` on `mandatory_gate_results` and `scoring_breakdowns` was not in the original migration draft — the brief's "Risks" UI requirement (surfacing e.g. a notice-period conflict or an adjacent-not-direct domain match) had no column to land in. Both columns were added to the migration itself during this build phase, before the pgverify RLS run, so the migration verified in §2.2 already includes them — this is part of the shipped schema, not a follow-up fix.

### 1.2 Deterministic gate/scoring engine

- `apps/web/lib/matching/gates.ts` — `evaluateMandatoryGate()`: the deterministic pass/fail/insufficient_evidence re-check against a mandatory requirement's evidence, independent of and never overridden by the AI's `ai_suggested_result`.
- `apps/web/lib/matching/scoring.ts` — the weighted-scoring arithmetic (docs/08-candidate-scoring.md §8.3): per-criterion `effective_score = raw_score × confidence_discount`, `weighted_contribution = effective_score × weight`, aggregated into `weighted_score`/`evidence_pct`/`completeness` — pure functions, no AI call inside them.
- `apps/web/lib/matching/evaluate.ts` — `computeDeterministicMatchResult()`: ties gates + scoring together into the final `eligibility`/`overall_score` result, enforcing the "null score unless eligible" rule in code as well as at the database CHECK-constraint layer; `computeRawWeightedScoreForOverride()` supports a reviewer's override recompute.
- `apps/web/lib/matching/thresholds.ts` — `resolveQualityThresholds()`/`classifyByQualityThreshold()`: the one place either quality-threshold number is read, resolving the nullable per-scorecard override to the `DEFAULT_RANKED_CONSIDERATION_THRESHOLD_PCT`(90)/`DEFAULT_PREFERRED_SHORTLIST_THRESHOLD_PCT`(95) constants in `packages/types` when unset. A null `overallScore` is always classified `not_eligible`, never silently compared as if it were 0.
- `apps/web/lib/matching/evidence-bundle.ts` — assembles the candidate's evidence (experience/education/certification/skill/extracted-field/profile rows) into the bundle handed to the AI assessment call, and back into `requirement_evidence` rows from its structured response.
- `apps/web/lib/matching/matching-pipeline.ts` — `runMatchingPipeline()`: the pure, database-free orchestration (not_configured → AI assessment → deterministic gate re-check → deterministic scoring → result), mirroring Build Phase 6's `document-processing-pipeline.ts` pattern.

### 1.3 AI provider layer

Mirrors Build Phase 4/6's extraction pattern field-for-field:

- `apps/web/lib/ai/matching-provider.ts` — typed provider interface.
- `apps/web/lib/ai/matching-prompt.ts` — system prompt with the same trust-boundary framing as docs/09-ai-architecture.md §9.1: candidate evidence text is DATA inside delimited tags, never instructions; explicit instruction that the AI proposes evidence/relevance/risk notes but never determines the final gate outcome or score.
- `apps/web/lib/ai/anthropic-matching-provider.ts` — the real (never-exercised-here) Anthropic implementation with a hand-maintained tool-use JSON schema.
- `apps/web/lib/ai/matching-test-adapter.ts` — deterministic offline test double.
- `apps/web/lib/ai/run-matching-assessment.ts` — `runMatchingAssessment()`: the same not_configured → call → validate → retry-once-then-reject state machine as `extract-requirements.ts`/`parse-candidate-document.ts`.

### 1.4 Server actions

`apps/web/lib/matching/matching-actions.ts`:

- `runMatchingEvaluationAction` — creates a `matching_runs` row and runs the full pipeline (AI assessment → deterministic gates → deterministic scoring) inline and synchronously, same no-background-queue caveat as Build Phase 6.
- `requestGateVerificationAction` — flags an `insufficient_evidence` gate for follow-up (`state = 'requires_verification'`).
- `overrideMandatoryGateAction` — records a human override, requiring reason + evidence note, writing both `mandatory_gate_results` (UPDATE) and a `human_reviews`/`review_decisions` audit pair.
- `recordReviewDecisionAction` — the general approve-for-outreach/reject/requires-verification decision on a `candidate_role_match`.

Every write action is gated on the `human_reviews`/`candidate_role_matches` permission resources per docs/06-roles-permissions.md §6.2.5, matching the RLS write policies exactly.

### 1.5 UI

`apps/web/components/domain/candidates/candidate-evaluation-panel.tsx`, wired into the candidate detail page as a new "Evaluation" tab (alongside the existing Profile/Background/Documents/AI Processing/Pipeline/Duplicates/Privacy/AI match preview tabs): run-evaluation control, eligibility summary, per-gate cards (state badge, evidence excerpt, AI suggestion vs. deterministic result, risk notes, verify/override controls with required reason+evidence fields), the weighted-scoring breakdown table, evidence coverage/completeness/confidence figures shown separately (never collapsed into one number, per §8.3), quality-threshold tier badge, and the review-decision controls. Confirmed via `next build`: the candidate detail page including this new tab still prerenders successfully against the demo-data path.

## 2. Tests added

**280 → 340 tests** (60 new — includes tests beyond the 62 counted at the matching-specific file level below, plus incidental coverage in shared files), all passing, zero regressions:

- `lib/matching/gates.test.ts` — deterministic gate evaluation: pass/fail/insufficient_evidence across evidence-present/absent/ambiguous cases, AI-suggestion independence (a wrong AI suggestion never flips the deterministic result).
- `lib/matching/scoring.test.ts` — weighted-score arithmetic: confidence-discount application, zero-evidence-contributes-zero, aggregation correctness against the docs/08-candidate-scoring.md §8.12 worked example.
- `lib/matching/evaluate.test.ts` — the full deterministic orchestration: eligible-with-score, ineligible-with-null-score, insufficient-evidence routing to human review rather than silent pass/fail.
- `lib/matching/evidence-bundle.test.ts` — evidence assembly from candidate records into the AI-assessment input bundle, and mapping the AI's structured response back into `requirement_evidence` rows.
- `lib/matching/matching-pipeline.test.ts` — the full pipeline against fixtures: not_configured honesty, end-to-end success, gate-fail-suppresses-score.
- `lib/matching/thresholds.test.ts` — default fallback when scorecard override is null, override takes precedence when set, null-score always classifies `not_eligible`.
- `lib/ai/run-matching-assessment.test.ts` — not_configured, success, retry-once-then-rejected, prompt-injection-produces-no-fabrication (candidate evidence containing instruction-like text has zero effect on the output), prompt-version recorded on every outcome.

## 3. Commands run (verification gate)

```
pnpm --filter @rqi/types typecheck   # clean
pnpm typecheck                        # clean, all 5 packages
pnpm lint                             # clean
pnpm test                             # 340 passed, 0 failed
pnpm --filter web build               # succeeds, candidate detail page (incl. new Evaluation tab) prerenders
```

## 4. RLS functional verification (`/tmp/pgverify`)

`/tmp/pgverify/verify_candidates.sql` extended with a new **TEST 13** block (13a–13l), run against a from-scratch replay of every migration `0001`–`0027` on a real local PostgreSQL 16 database (the full prior TEST 1–12 suite was re-run and reconfirmed green in the same pass). **56 assertions** across this block confirm:

- **13a** — an assigned recruiter can read every one of the 7 new tables for a candidate/project they're scoped to.
- **13b** — an unassigned recruiter (same org, not on the project) sees none of it.
- **13c** — `client_decision_maker` never sees any of the 7 tables, even for a candidate shared/shortlisted with `client_visible = true` — confirming the §6.2.5 scope decision holds at the database layer, not just in the RLS SQL source.
- **13d** — cross-tenant denial: an admin/recruiter in a second, unrelated organization sees none of it.
- **13e** — append-only enforcement via `REVOKE`: direct UPDATE/DELETE attempts against `matching_runs`/`requirement_evidence`/`scoring_breakdowns`/`human_reviews`/`review_decisions` fail at the privilege level, not just the RLS level.
- **13f** — `mandatory_gate_results` DOES allow UPDATE (the human-override path), confirming it is the deliberate exception to 13e, not a gap.
- **13g** — unauthorized override: an unassigned recruiter cannot write a gate override, denied by RLS.
- **13h** — `human_reviews` insert cannot impersonate another reviewer — an insert with `reviewer_id` set to someone else's id is denied.
- **13i** — a legitimate `human_reviews` insert (reviewer_id = the acting, assigned recruiter's own id) succeeds.
- **13j** — the `candidate_role_matches_score_only_when_eligible` CHECK constraint: an attempt to insert/update a non-null `overall_score` alongside `eligibility <> 'eligible'` is rejected by the database, independent of application code.
- **13k** — the `mandatory_gate_results_override_requires_full_record` CHECK constraint: an attempt to set `state = 'human_override'` with any of the five override fields missing is rejected.
- **13l** — ranking exclusion: a query mirroring the ranked-shortlist read confirms ineligible candidates never appear regardless of any non-null score value a bug might otherwise have let through.

## 5. Known blockers / not configured in this environment

- **No live Supabase project connected.** Same as every prior phase — no `apps/web/.env.local`, no `SUPABASE_*` env vars. The schema and RLS were instead verified functionally against local PostgreSQL 16 (§4), which is a real functional check but not a substitute for running against the actual managed Postgres/Auth/Storage stack this app will deploy on.
- **No `ANTHROPIC_API_KEY` configured.** The AI-assisted assessment path (`AnthropicMatchingProvider`) has never made a real network call. It is fully typed, structurally identical in shape to the Build Phase 4/6 pattern, and honestly reports `not_configured` rather than fabricating a response — but its actual output quality against real CVs/scorecards is unverified. This environment can never claim the Claude API integration "works" — only that the code path is correct and honestly reports its own unconfigured state.
- **No background job queue.** As with Build Phase 6, `runMatchingEvaluationAction` runs the pipeline synchronously inside the request. A genuinely slow AI call will hold the request open rather than returning immediately with a pollable state.
- **No client-facing shortlist/finalist-comparison view.** Explicitly deferred, not partially built: RLS gives `client_decision_maker` zero access to any of the 7 new tables (§1.1, docs/06-roles-permissions.md §6.2.5). Workflow #13 (candidate comparison narrative, docs/09-ai-architecture.md) is likewise unbuilt. This is the natural next phase's scope.
- **No matching-specific prompt-injection fixture library.** The existing CV-parsing fixture library's adversarial-content coverage (docs/10-ai-evaluation-guardrails.md §10.8) carries over structurally, since matching evaluates already-extracted, already-fixture-tested candidate evidence, but a dedicated matching-workflow fixture set (e.g. adversarial text inside a requirement's evidence bundle) was not built this phase — a reasonable follow-up, not a gap this phase's brief required closing.

## 6. Recommendation for next build

The natural next phase is the client-facing shortlist and finalist-comparison view (workflow #13, docs/09-ai-architecture.md; the deferred scope named throughout this report and in docs/06-roles-permissions.md §6.2.5) — now that gate results, evidence, and deterministic scores exist to build a narrow, methodology-free client read view against. A live Supabase project and Anthropic API key remain the two blockers that would let every AI-touching phase since Build Phase 4 actually run instead of just being verified structurally.

Related documents: [[07-data-model]] · [[06-roles-permissions]] · [[08-candidate-scoring]] · [[09-ai-architecture]] · [[10-ai-evaluation-guardrails]]
