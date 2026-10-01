# Build Phase 11 report — Recruiter AI Copilot

Per docs/21-implementation-contract.md §21.14 and the Build Phase 11
completion gate. Covers exactly what this phase implements: docs/09-ai-
architecture.md §9.2 workflow #17 ("Recruiter copilot... advisory, cites
its sources... cannot answer -> says so, never fabricates a citation") — a
permission-aware, evidence-grounded, 13-tool AI copilot with a database
schema, a role/tool allowlist, a full orchestration pipeline with cost/
latency bounds, server actions and UI, and a ten-category adversarial
evaluation suite — built across five waves (DB schema/RLS; tool
allowlist/retrieval/redaction; AI orchestration; server actions/UI; this
wave: adversarial evals, final verification and documentation).

**This is the highest-security-stakes phase built so far.** Every prior
phase's central risk was getting one workflow's data correct; this phase's
central risk is a general-purpose conversational surface that could, if
any single guardrail failed, make an unconfirmed candidate-record change,
override a mandatory gate, approve outreach, submit a shortlist, leak
cross-tenant data, leak a hidden recruiter note to a client, or fabricate
evidence — the exact MUST-NOT list Core Principles #3–#6 already establish
for the rest of the platform, now exposed through a surface where the
_caller_ (an LLM) is not fully trusted to begin with. §7 states explicitly
how that risk is closed at multiple independent layers, not one.

**The same blockers carried into every prior phase's report remain
unchanged in kind:**

1. No live Supabase project is connected to this repository's environment
   (no `apps/web/.env.local`, no `SUPABASE_*` env vars) — the full schema
   and RLS policy set were instead functionally verified against a real
   local PostgreSQL 16 instance (§4).
2. No `ANTHROPIC_API_KEY` is configured. `AnthropicCopilotProvider` is
   structurally complete and type-correct but has never made a live call —
   every test in this repository, including all ten adversarial eval
   files, exercises the deterministic `TestCopilotProvider` double
   instead, the same convention every AI-touching phase since Build Phase
   4 has used.
3. No `RESEND_API_KEY` is configured — irrelevant to this phase specifically
   (the copilot never sends outreach; `draft_outreach_message` only ever
   drafts text, never calls a channel adapter).

Everything below is code-complete, typechecked, linted, and tested at
every layer that does not require a live backend, and the full schema and
its Row Level Security policies were functionally verified against a real
local PostgreSQL 16 instance, including live role-switching RLS tests
specific to the four new tables and a from-scratch, zero-regression replay
of migrations `0001`–`0031` (§4).

## 0. Pre-wave state

Waves 1–4 of this phase (DB schema/RLS; tool allowlist/retrieval/
redaction; AI orchestration; server actions/UI) were already built and
verified clean by prior sessions before this wave started. This wave's own
starting point, confirmed by re-reading every file it had already written
before doing anything else: ten eval test files already existed under
`apps/web/lib/copilot/eval/` (`fixtures.ts` plus nine — later confirmed
ten — adversarial test files), but `docs/build-phase-11-report.md` did not
exist yet, meaning documentation (this report and the doc updates) had not
been done. This wave's actual work was therefore: (1) read every existing
eval test file in full to confirm real adversarial coverage rather than
trivial passthrough tests, (2) run the full verification gate and fix
anything broken, (3) rebuild `/tmp/pgverify` fresh and re-run TEST1–TEST17,
(4) write this report and update every doc the brief named.

## 1. What was built (organized by wave)

### Wave 1 — Database schema + RLS (migration `0031_copilot.sql`)

Four new tables, in dependency order: `copilot_conversations` (one row per
chat thread, carrying an immutable-once-created scope snapshot —
organization, `role_at_creation`, `client_id`/`recruitment_project_id`,
`data_classification`), `copilot_messages` (append-only turns, carrying
`citations`), `copilot_tool_calls` (one allowlisted tool invocation per
assistant turn, with `resource_ownership_validated` and a narrow,
trigger-enforced confirm-step scaffold unused this phase),
`copilot_usage_counters` (persisted per-org/user/day rate-limit/cost
state, chosen over an in-memory limiter for this serverless deployment).
Full detail is in docs/07-data-model.md §7.12 (written this wave).
`ai_runs.workflow_type`'s CHECK constraint was extended to admit
`'copilot'` and, as a cross-phase bonus fix already flagged by two prior
reports, the still-missing `'outreach_draft_generation'`/
`'response_classification'` values from Build Phase 9 — see
docs/09-ai-architecture.md §9.7 for the full note on why this is a
schema-only fix, not a backfill.

### Wave 2 — Tool allowlist, retrieval, redaction

- `apps/web/lib/copilot/tool-registry.ts` — the central, exhaustive
  13-tool `TOOL_REGISTRY`, the only place any orchestration code looks up
  a tool's schema, allowed roles, or handler. Resolves the "open design
  question" `packages/types/src/permissions.ts`'s `copilot` resource
  comment flagged: `agency_admin`/`recruiter` get all 13; `client_
decision_maker` gets a deliberately narrow 5-tool subset
  (`summarize_recruitment_project`, `explain_candidate_match`,
  `compare_approved_candidates`, `explain_poc_metrics`, `suggest_next_
workflow_action`); `platform_admin`/`read_only_reviewer` get none.
- `apps/web/lib/copilot/resource-ownership.ts` — `assertResourceOwnership()`,
  re-validating organization/role/client scope against the actual record a
  tool call addresses, independent of and in addition to RLS.
- `apps/web/lib/copilot/redaction.ts` — field-level redaction of
  `candidate_profiles.recruiter_notes`, `shortlist_candidates.recruiter_
note`, and `human_reviews`-derived reviewer notes for any `restricted_
notes_excluded` conversation, applied inside the tool handler before a
  prompt is ever assembled.
- `apps/web/lib/copilot/gate-override-guard.ts` — the structural,
  mechanically-checkable statement that no tool handler can mutate
  anything (`FORBIDDEN_COPILOT_WRITE_TARGETS`, `EXPECTED_COPILOT_TOOL_
NAMES`), written as a documentation + test-support module rather than a
  runtime interceptor, on the reasoning that the real guarantee is "no
  tool handler ever imports a write path," not "a write attempt gets
  caught at the last moment."
- `apps/web/lib/copilot/tools/{project,candidate,shortlist,drafting,
responses,poc,workflow}.ts` — the 13 tool handlers themselves.

### Wave 3 — AI orchestration

- `apps/web/lib/copilot/orchestration/run-copilot-turn.ts` — the single
  entry point every caller goes through: load-conversation-scoped-to-org →
  live-role-re-check → rate-limit-check-before-any-provider-call →
  provider-call-under-a-45s-timeout-and-8-iteration-cap → per-tool-call
  allowlist-and-ownership-and-redaction → evidence-guardrail →
  persist-and-return-a-typed-outcome. Full pipeline detail in docs/09-ai-
  architecture.md §9.9 (written this wave).
- `apps/web/lib/copilot/orchestration/{conversation-loop,system-prompt,
anthropic-copilot-provider,copilot-test-provider,test-fake-supabase,
zod-json-schema}.ts` — the tool-calling loop, the Rule-0 untrusted-data
  system prompt, the real (never-exercised-here) Anthropic provider, the
  deterministic offline test double, the in-memory fake Supabase this
  wave's own eval fixtures build on, and JSON-schema generation from Zod
  for the provider's tool definitions.
- `apps/web/lib/copilot/evidence-guardrail.ts` — `validateCopilotEvidenceCitations()`,
  deterministically re-checking every claim's citation against the
  records a tool call actually returned this turn.

### Wave 4 — Server actions, UI

- `apps/web/lib/copilot/copilot-actions.ts` — server actions wrapping
  `runCopilotTurn`, plus a feedback-capture action recording helpful/
  not-helpful on an assistant message.
- `apps/web/lib/copilot/load.ts` — `listAllowedToolNames`,
  `getSuggestedQuestions` (role-aware, project-scope-aware suggested
  questions, each independently checked against the tool allowlist).
- `apps/web/app/(app)/copilot/page.tsx` / `[conversationId]/page.tsx` +
  `apps/web/components/domain/copilot/{copilot-start-form,copilot-
conversation-workspace}.tsx` — the two-route UI (docs/03-screen-
  inventory.md §3.4, screens 28/29, updated this wave). The workspace
  renders tool-call activity, citations, and two safety caveats
  (unsupported-claims-stripped, missing-citation) directly in the
  rendered turn via a **text-heuristic**, `detectSafetyCaveats()`, that
  pattern-matches the guardrail's own caveat phrasing rather than reading
  a dedicated structured field — a known fragility, not fixed this wave
  (see §5).

### Wave 5 — Adversarial evals, final verification, documentation (this wave)

Covered in §2–§4 below.

## 2. Eval test files — confirmed adversarial coverage per file

All ten files were read in full before any other work this wave. Every
one drives the **full orchestration path** (`runCopilotTurn`) rather than
only unit-testing the guardrail function in isolation (guardrail unit
tests already exist separately: `evidence-guardrail.test.ts`,
`redaction.test.ts`, `resource-ownership.test.ts`) — each file's own
header comment states this distinction explicitly. Summary per file (full
category-by-category detail is now also in docs/10-ai-evaluation-
guardrails.md §10.14, written this wave):

1. **`unsupported-claims.test.ts`** (3 tests) — a fabricated citation is
   stripped from both the returned outcome and the persisted
   `copilot_messages` row, with a visible caveat appended, never a
   silently rewritten sentence; a real citation id with a fabricated/
   paraphrased excerpt is rejected too, not just a wholly invented id.
2. **`cross-tenant-extraction.test.ts`** (4 tests) — a resource id
   belonging to a different org is denied even for an org-wide role
   (agency_admin); a conversation whose own row belongs to a different
   org is treated as not-found, never partially loaded; a project-scoped
   conversation whose project has since moved to a different org fails
   safe. Explicitly documents the DB-layer half of the identical
   guarantee (pgverify TEST17r, §4) as neither layer alone being the
   whole guarantee.
3. **`hidden-note-leakage.test.ts`** (3 tests) — `recruiterNote` is
   entirely absent (not nulled) from `compareApprovedCandidates`'s raw
   output for a restricted conversation, present for a standard one
   (proving real redaction, not accidental universal omission), and still
   absent from a full `runCopilotTurn`'s final text even against a
   worst-case "model" that echoes the raw tool result verbatim. **A
   genuine wave 2/3 bug was found and fixed while writing this test**:
   `compareApprovedCandidates` was calling `loadShortlistDetail` with no
   Supabase client at all, silently constructing its own and discarding
   `ctx.supabase` — untestable against the fake-Supabase harness and
   inconsistent with `runCopilotTurn`'s single-client-per-turn invariant.
   Fixed to accept and use `ctx.supabase`, per `load-detail.ts`'s existing
   `existingClient` parameter. **Flagged prominently per this wave's
   brief**: this is the one source-logic change made this wave, made
   because it was a genuine bug discovered while adversarially testing,
   not a stylistic edit.
4. **`prompt-injection.test.ts`** (4 tests) — injected instruction-like
   text seeded into a real `job_requirements.name` row genuinely reaches a
   tool result verbatim (not a synthetic fabricated citation) yet produces
   no unauthorized tool call (the allowlist check is purely name-based)
   and no unsupported claim (still fails the evidence guardrail without a
   real authorized record); the system prompt's Rule 0 framing is
   asserted present for every role/classification combination.
5. **`unauthorized-tool-calls.test.ts`** (2 tests) — `client_decision_
maker` attempting `draft_outreach_message` (a staff-only tool, not just
   the pre-existing `explain_scorecard` case) is denied before the handler
   ever runs (a handler spy proves zero invocations), with a persisted
   denial row and audit event; every staff-only tool is confirmed
   structurally never offered to `client_decision_maker` at all.
6. **`missing-citations.test.ts`** (3 tests) — the soft-fail caveat fires
   only when citable records genuinely existed and were not cited, never
   for a purely procedural answer with nothing to cite; confirmed as a
   soft caveat, never a hard `validation_rejected`.
7. **`candidate-comparison-integrity.test.ts`** (5 tests) — never blends a
   different job's shortlist into the requested comparison; a nonexistent
   or cross-org shortlist id fails closed via `ResourceOwnershipError`
   before any data read; a shortlist with no current version returns an
   empty comparison, never an invented placeholder; a client_decision_
   maker can only compare their own represented client's shortlist.
8. **`gate-override-attempts.test.ts`** (7 tests, plus dynamic per-file
   assertions) — a mechanical grep over every `tools/*.ts` handler file
   confirms none contains a Supabase write call at all, and specifically
   none chained off a `FORBIDDEN_COPILOT_WRITE_TARGETS` table name;
   `EXPECTED_COPILOT_TOOL_NAMES` matches `TOOL_REGISTRY`'s actual keys
   exactly; every tool carries `requiresConfirmation: false`.
9. **`client-reviewer-restrictions.test.ts`** (8 base tests + `it.each`
   expansion covering all 13 tools twice, ~34 assertions total) — an
   exhaustive truth table over every one of the 13 tools × every role,
   re-derived independently of `tool-registry.ts`'s own constant; `getSuggestedQuestions`
   never surfaces a question whose tool the caller cannot invoke.
10. **`cost-latency-thresholds.test.ts`** (4 tests) — the provider is
    spied on directly and proven never invoked once the 200-message or
    $5 daily cap is met; a runaway turn is bounded by the hard 45s
    timeout with clean DB state left behind (message persisted, one
    failed `ai_runs` row, no fabricated assistant message); a tool-call
    loop that never finishes is stopped at exactly 8 iterations.

**Coverage verdict: all ten categories the brief names have dedicated
files, and every file was confirmed by direct reading — not by filename
alone — to adversarially exercise what its name claims, not a trivial
passthrough test.** No file was found incomplete or missing coverage for
a brief-listed item; no bug beyond the one named in item 3 was found.

## 3. Commands run (verification gate)

```
pnpm --filter web test       # 627 passed, 0 failed (83 test files)
pnpm typecheck                 # clean, all 5 packages
pnpm --filter web lint         # clean
pnpm --filter web build        # succeeds; /copilot prerenders static,
                                # /copilot/[conversationId] server-renders
                                # on demand (ƒ), every pre-existing route
                                # unchanged
```

All four commands were re-run directly for this report, not taken on
trust from an earlier pass: `pnpm --filter web test` reported `Test Files
83 passed (83)` / `Tests 627 passed (627)` — **568 → 627, 59 new tests**
(exactly the ten eval files' own counts), **zero regressions**;
`pnpm typecheck` completed with no errors across all five packages
(`@rqi/config`, `@rqi/types`, `@rqi/testing`, `@rqi/ui`, `web`);
`pnpm --filter web lint` completed with no errors or warnings;
`pnpm --filter web build` compiled successfully and listed `/copilot` as
a static (○) route and `/copilot/[conversationId]` as dynamic (ƒ),
alongside every pre-existing route unchanged.

## 4. pgverify RLS functional verification (`/tmp/pgverify`)

The verification was re-run from a **completely fresh database**, not
reused from an earlier pass. `pgverify` was dropped and recreated; the
`postgresql-16-pgvector` system package was (re-)installed to provide the
`vector` extension this environment's Postgres did not already have; the
full migration set (`0001`–`0031`) plus the two non-migration stub files
(`00_stub_supabase_auth.sql`, `01_stub_storage.sql` — a minimal `auth`/
`storage` schema stand-in for local Postgres) were copied fresh from
`supabase/migrations/` and applied in strict numeric order with **zero
errors**. The full `scripts/verify_candidates.sql` script (TEST1 through
TEST17, including TEST17's full lettered sequence a–r covering the four
new copilot tables) was then run against that fresh database —
**exit code 0, zero `| f` (false) rows in any `pass` column, zero `FAIL`
lines, zero `ERROR`/`FATAL` noise**, confirmed by direct grep across the
full run log, not a naive spot-check. TEST17 alone confirms, among its
lettered sub-parts:

- The `copilot_conversations_scope_by_role` CHECK forces `data_
classification = 'restricted_notes_excluded'` and a single project/
  client for every `client_decision_maker` conversation, never `standard`
  or org-wide.
- `copilot_tool_calls.tool_name`'s CHECK constraint rejects a tool name
  outside the 13 allowlisted values.
- **TEST17q** — `ai_runs` accepts the Build Phase 9 outreach workflow
  types this wave's migration retroactively admitted (the cross-phase fix
  described in §1/docs/09-ai-architecture.md §9.7), confirmed against real
  Postgres.
- **TEST17r** — a cross-tenant admin (a different organization entirely)
  sees zero rows in another org's `copilot_conversations`,
  `copilot_messages`, `copilot_tool_calls`, and `copilot_usage_counters`,
  and a cross-tenant insert attempt into `copilot_conversations` is
  rejected by a CHECK/RLS combination (error code `23514`) — the DB-layer
  half of the identical guarantee `eval/cross-tenant-extraction.test.ts`
  proves at the application layer (§2, item 2); the two together, not
  either alone, are what closes this MUST-NOT.

## 5. Known limitations, flagged honestly

- **No live Anthropic, Supabase, or Resend credentials exist in this
  environment.** Nothing in this report or the codebase claims a tested
  live integration for any of the three (§ intro). `AnthropicCopilotProvider`
  is structurally complete and type-correct but has never made a real
  network call.
- **No true cancel-in-flight.** `runCopilotTurn` accepts an optional
  `AbortSignal` and correctly distinguishes a caller-initiated cancel from
  an internal timeout in its return status — but no caller (server action
  or UI) actually wires one up. A long-running turn is bounded only by the
  orchestration layer's own hard 45-second wall-clock timeout, not a
  user-triggered cancel button. The UI's `cancelled` status-rendering
  branch exists and is correct, but nothing in this build ever produces
  that status today — it is dormant, ready for a future wave that wires a
  real cancel affordance through.
- **The UI safety-indicator is a text heuristic, not a structured field.**
  `copilot-conversation-workspace.tsx`'s `detectSafetyCaveats()` pattern-
  matches the evidence guardrail's own caveat phrasing ("could not be
  verified against retrieved records", "did not cite specific records")
  inside the persisted `copilot_messages.content` string, rather than
  reading a dedicated boolean/structured field the guardrail itself sets.
  `copilot_messages` does carry `unsupported_claims_stripped`/
  `citations_caveat_applied` columns at the schema layer (docs/07-data-
  model.md §7.12) that a future wave should wire the UI to read directly
  instead — today, a future change to either caveat's exact prose would
  silently break this heuristic with no compile-time signal.
- **Feedback persistence is audit-log metadata today, not a dedicated
  table.** `copilot-actions.ts`'s helpful/not-helpful capture writes to
  `audit_events.metadata` rather than a first-class feedback table — fine
  for Core Principle #10 auditability, but not queryable as its own
  reporting surface without scanning audit events. A dedicated
  `copilot_message_feedback` table is a reasonable, low-risk follow-up
  migration if this feedback signal needs its own dashboard later.
- **The confirmation-before-mutation UI is inert.** `PendingToolConfirmation`
  and `copilot_tool_calls.requires_confirmation`/`confirmed_at`/
  `confirmed_by` exist as scaffolding for a future mutating tool — every
  one of the 13 tools in this build has `requiresConfirmation: false`, so
  this code path never fires today. This is by design, not an oversight:
  building the confirm scaffolding now means a future mutating tool (if
  one is ever added, which would itself need very careful design against
  every one of this phase's MUST-NOTs) does not need a new UI pattern
  invented from scratch.
- **Rate-limit constants (200 messages/day, $5/day) are placeholders**,
  not a calibrated product decision — recorded honestly rather than
  presented as tuned numbers. A real limit should come from actual usage
  data or an explicit product/business decision once the copilot has real
  traffic.
- **The `ai_runs.workflow_type` fix is schema-only** (§1) — pre-existing
  `null` `ai_run_id` rows from Build Phase 9/10 outreach workflows are not
  backfilled, and `apps/web/lib/outreach/*.ts` was not updated this wave
  to start writing real `ai_runs` rows going forward (out of scope: a
  TypeScript change in a different subsystem, not something this wave's
  brief asked for).

## 6. Recommendation for next build

Two small, well-scoped follow-ups, neither a blocker: (1) wire the UI's
`detectSafetyCaveats()` to read `copilot_messages.unsupported_claims_
stripped`/`citations_caveat_applied` directly instead of pattern-matching
prose (§5); (2) wire a real `AbortSignal` from the UI's cancel affordance
(once one is designed) through the server action into `runCopilotTurn`'s
already-correct cancel/timeout-disambiguation logic. Beyond those, the two
cross-phase-relevant follow-ups already on record from Build Phase 9/10
remain: updating `apps/web/lib/outreach/*.ts` to start inserting real
`ai_runs` rows now that the schema admits its workflow types (§1), and a
live Anthropic API key / live Supabase project, which is what would let
this phase's orchestration, redaction, and evidence-guardrail code
actually run against real model output instead of only being verified
against the deterministic test provider and a local Postgres instance.

## 7. Mandatory Completion Gate

- **This is the highest-security-stakes phase built so far.** A general-
  purpose conversational AI surface, not a single fixed workflow, is now
  live in the codebase — the attack surface this phase closes is broader
  by construction than any single-workflow phase before it.
- **Every explicit MUST-NOT in the governing brief — no hiring decision,
  no unconfirmed mutation, no gate override, no outreach approval, no
  shortlist submission, no cross-tenant reveal, no hidden-note leakage to
  clients, no invented evidence — is enforced at MULTIPLE independent
  layers, never a single point of failure:**
  - **Database layer** — `copilot_tool_calls.tool_name` CHECK
    (independent allowlist), `copilot_conversations_scope_by_role` CHECK
    (forces restricted classification + single-client/project scope for
    `client_decision_maker`), Row Level Security on all four tables
    (organization + owning-user scoped), pgverify TEST17 confirmed against
    real role-switched Postgres sessions (§4).
  - **Structural / registry layer** — `TOOL_REGISTRY`'s role allowlist
    (13 tools, no mutation tool exists at all), `gate-override-guard.ts`'s
    mechanically-checkable `FORBIDDEN_COPILOT_WRITE_TARGETS` grep, proving
    by construction — not by runtime interception — that no tool handler
    can attempt a forbidden write in the first place.
  - **Orchestration layer** — live-role re-validation every turn
    (never trusting the conversation's creation-time scope snapshot
    alone), `resource-ownership.ts`'s per-tool-call re-check, `redaction.ts`'s
    pre-prompt field stripping, `evidence-guardrail.ts`'s deterministic
    citation re-validation, all independent of and in addition to what the
    database and registry layers already guarantee.
  - **UI layer** — honest rendering of whichever guardrail actually fired
    (tool-call activity, citations, safety caveats), never a generic
    swallowed error that would hide which layer caught a problem.
- **All four are now covered by dedicated, adversarial, full-orchestration-
  path tests, not resting on code review or a single point of failure to
  catch a regression** — the ten eval files in `apps/web/lib/copilot/eval/`
  (§2), confirmed by direct reading this wave to genuinely adversarially
  test what each file's name claims.
- **RLS, deterministic-logic, and unit-test verification is complete and
  passing.** 627/627 tests green (83 test files, 59 new this wave, zero
  regressions, one genuine wave-2/3 bug found and fixed — §2 item 3),
  `pnpm typecheck`/`pnpm --filter web lint`/`pnpm --filter web build` all
  clean, and the full `verify_candidates.sql` suite (TEST1–TEST17, TEST17's
  full lettered sequence including the four new copilot tables and
  cross-tenant isolation) passes with zero failures against a from-scratch
  replay of migrations `0001`–`0031` on real PostgreSQL 16.
- **No live Supabase, Anthropic, or Resend credentials exist in this
  environment** (§ intro, §5). Nothing in this report or the codebase
  claims a tested live integration for any of the three.
- **Known limitations are recorded honestly, not silently accepted**:
  no true cancel-in-flight (§5), the UI safety-indicator's text-heuristic
  fragility (§5), feedback persistence as audit-metadata rather than a
  dedicated table (§5), the confirmation-before-mutation UI's current
  inertness (§5), and rate-limit constants as placeholders pending a real
  product decision (§5).
- **The phase is complete. Stopping at the phase boundary**, per project
  convention — no further build work follows this report.

Related documents: [[07-data-model]] · [[09-ai-architecture]] ·
[[10-ai-evaluation-guardrails]] · [[06-roles-permissions]] ·
[[03-screen-inventory]] · [[12-security-compliance]]
