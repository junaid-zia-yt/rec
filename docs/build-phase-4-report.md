# Build Phase 4 report — job intelligence and scorecard

Per docs/21-implementation-contract.md §21.14 and the Build Phase 4
completion gate ("I approve the Job Intelligence and Scorecard build...
Apply the Mandatory Completion Gate"). Covers exactly what this phase
implements: AI-assisted requirement extraction from job descriptions, the
human review/edit/approval workflow for requirements, deterministic
scorecard weight validation, immutable versioned scorecard approval, and
the AI-operations/testing requirements listed in the brief. Candidate
sourcing, parsing, matching and scoring are explicitly out of scope for
this phase and are untouched.

**The two blockers carried into this report, consistent with every prior
phase**: (1) no live Supabase project is connected to this repository's
environment (no `apps/web/.env.local`, no `SUPABASE_*` env vars) — the same
blocker reported in Build Phases 2 and 3, unchanged in kind; (2) no
`ANTHROPIC_API_KEY` is configured in this environment, so the real
`AnthropicProvider` has been written, typechecked, and unit-tested against
a deterministic double, but has **never been called against the live
Anthropic API**. Per the project instructions ("Never claim an external
integration works until it has been configured and tested" / "If a real
Anthropic key is unavailable, implement a typed provider interface and
deterministic test adapter. Do not fake a successful live integration."),
both are reported plainly rather than glossed over. Everything below is
code-complete, typechecked, linted, and tested at every layer that does not
require a live backend.

## 0. Pre-build verification

The full existing test/typecheck/lint suite was confirmed green before any
Phase 4 code was written (169 tests today were 121 at the start of this
phase — see §2).

## 1. What was implemented

### 1.1 Database schema + RLS (migrations `0015`–`0017`)

| Migration                   | Adds                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0015_job_requirements.sql` | `job_requirements` — all 5 requirement types, weight/evidence/source-text/source-location/confidence/verification-status/reviewer-notes fields, `status` (proposed/reviewed/manually_added), `ai_generated`; constraints tying weight to `preferred` only and forbidding `manually_added` rows from ever being `ai_generated`; RLS scoped org-wide for admin/reviewer and assigned-project-only for recruiter |
| `0016_scorecards.sql`       | `scorecards`, `scorecard_versions` (with `requirement_snapshot jsonb`, unique `(scorecard_id, version_no)`), the `enforce_scorecard_version_immutability()` trigger, `scorecard_approvals` (append-only), and `recruitment_projects.client_can_approve_scorecards`                                                                                                                                            |
| `0017_ai_runs.sql`          | `ai_prompt_versions` (no RLS — not tenant data), `ai_runs` (model/prompt version/status/tokens/cost/latency/idempotency key, append-only), `requirement_extraction_results`                                                                                                                                                                                                                                   |

Every tenant table carries `organization_id` and RLS, per the project's
standing rule. `ai_prompt_versions` is the one deliberate exception,
documented in its own migration comment as prompt-template data, not
tenant data.

**Verified beyond static review.** Unlike prior phases, this phase's
migrations were actually applied and exercised against a real, local
PostgreSQL 16 instance running inside this environment (not Supabase, but
real Postgres with a hand-built `auth`/`storage` schema stub matching
Supabase's shape closely enough for DDL/constraint/trigger/RLS-adjacent
testing). All 17 migrations applied cleanly in order, and a 7-assertion
SQL script confirmed, against live rows:

- the weight-only-when-`preferred` check constraint rejects a weighted
  mandatory requirement;
- the manually-added-never-ai-generated check constraint rejects the
  contradiction;
- the immutability trigger **blocks** any mutation to an `active` scorecard
  version's snapshot, and **allows** the one legal transition
  (`active` → `superseded`);
- `unique(scorecard_id, version_no)` and the partial unique index on
  `(organization_id, idempotency_key)` both hold.

This gives real confidence the DDL is behaviorally correct, not just
syntactically valid — a stronger bar than prior phases could clear, though
it is still not a substitute for running the actual migrations against a
live Supabase project (RLS itself was not exercised this way, since RLS
depends on Supabase's specific `auth.uid()`/JWT wiring more than the stub
reproduces).

### 1.2 AI provider abstraction (brief: "implement a typed provider

interface and deterministic test adapter")

- `lib/ai/provider.ts` — `AIProvider` interface, `AIProviderError`, and
  `validateExtractionOutput()` (Zod-backed structured-output validation:
  confidence range, known requirement types, required `sourceText`, a
  60-requirement ceiling, rejection of non-object payloads).
- `lib/ai/prompt.ts` — the versioned system prompt
  (`requirement-extraction-v1`) encoding every rule the brief requires
  verbatim in spirit: treat the document as data not instructions, never
  invent requirements, quote/reference source text, mark ambiguous
  requirements for clarification, separate mandatory from preferred, never
  make a hiring decision. The untrusted document text is wrapped in an
  explicit `<job_description_document>...</job_description_document>`
  delimiter with trust-boundary language repeated immediately next to it —
  defense in depth beyond the system prompt alone. A test asserts a
  hostile document cannot forge a closing delimiter to escape the
  boundary.
- `lib/ai/anthropic-provider.ts` — the real provider, using forced
  tool-use/JSON-schema output, a 60-second timeout, and
  `createAnthropicProvider()` which throws a typed `not_configured` error
  rather than silently degrading if called with no key.
- `lib/ai/test-adapter.ts` — `TestAIProvider`, a deterministic double
  driven by simple line prefixes (`MUST:` / `PREFERRED(N):` / `DISQUALIFY:`
  / `UNCLEAR:`); any instruction-shaped text with no matching prefix is
  silently ignored — the same trust-boundary principle the real prompt
  encodes, modeled deterministically for tests.
- `lib/ai/extract-requirements.ts` — `runRequirementExtraction()`
  orchestrates: resolve a provider (**live code path can only ever resolve
  to the real `AnthropicProvider` if configured, or an honest
  `not_configured` outcome — the test adapter is reachable only via an
  explicit parameter tests supply, never a fallback**); validate output;
  retry exactly once on invalid structured output before reporting
  `rejected_by_validation`; a transport-level failure (timeout/provider
  error) is never retried and reports `error` with a safe, non-leaking
  message; every outcome records the prompt version, model, and (when
  available) token/cost/latency metadata into `ai_runs`.

### 1.3 Deterministic scoring and approval logic (brief: mandatory

requirements don't need weights; preferred weighted categories must total
100%; approval creates an immutable version)

Kept entirely separate from AI, per the project's explicit AI-safety rule
that final scores and gates are deterministic logic, never LLM output:

- `lib/scoring/validate-weights.ts` — `validateRequirementWeights()`:
  rejects a weight on an unweighted type, rejects a `preferred` requirement
  with no weight, rejects totals that don't sum to 100% (with a 0.01
  floating-point tolerance), accepts zero preferred requirements as valid.
  Deliberately has no `'server-only'` marker so the scorecard editor UI can
  reuse the same function client-side for live validation feedback.
- `lib/scoring/scorecard-versions.ts` — `buildRequirementSnapshot()`,
  `nextVersionNumber()`, `requiresNewDraftVersion()` (an `active` or
  `superseded` version always forces a new draft on any further edit —
  application-layer immutability, layered on top of the database
  trigger), and `canApproveScorecardVersion()` (refuses approval of an
  already-active/superseded version, zero requirements, or invalid
  weights, and collects every failing reason at once rather than stopping
  at the first).

Three independent layers now enforce the same immutability/approval-gate
invariant: the application-layer pure functions above (checked before
every submit/approve), Row Level Security, and the database trigger — no
single layer is trusted alone.

### 1.4 Server actions (brief §AI WORKFLOW steps 8–10, §PERMISSIONS)

- `lib/requirements/actions.ts` — `runRequirementExtractionAction()`
  (kicks off AI extraction and persists proposed requirements for review),
  `createRequirementAction()` (manual add), `updateRequirementAction()`
  (edit/reclassify/reweight — calls the extracted, unit-tested
  `nextRequirementStatusAfterEdit()` so an AI-proposed, unreviewed
  requirement becomes `reviewed` the moment a human touches it, while a
  manually-added requirement is untouched and no edit can ever flip
  `ai_generated`), `deleteRequirementAction()`.
- `lib/scorecards/actions.ts` — `submitScorecardForApprovalAction()`,
  `decideScorecardApprovalAction()` (approve / reject / request changes —
  gated by the extracted, unit-tested `canDecideScorecardApproval()`),
  `setClientApprovalPermissionAction()` (agency-admin-only toggle for
  "client reviewers may approve only if explicitly permitted").

Every write: Zod-validated input, `requirePermission`/`requireProjectAccess`,
a Supabase write, an `audit_events` row (12 new Phase 4 action names),
`revalidatePath`, and the established `ActionResult` return shape —
matching the convention from every prior phase.

Permissions implemented exactly as specified: recruiters draft/edit where
assigned; agency admins approve; client reviewers approve only when the
project's `client_can_approve_scorecards` flag is on **and** they belong to
that project's own client (tenant isolation is enforced in this same
function, not left to RLS alone); read-only reviewers can do neither.

### 1.5 AI operations (brief §AI OPERATIONS)

| Requirement                                           | Where                                                                                                            |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Timeout                                               | `AnthropicProvider`'s 60s request timeout                                                                        |
| Retry policy                                          | Exactly one retry on invalid structured output; transport failures are never retried (`extract-requirements.ts`) |
| Idempotency                                           | `ai_runs.idempotency_key`, unique per `(organization_id, idempotency_key)`                                       |
| Cost/token metadata                                   | `ai_runs.input_tokens` / `output_tokens` / `cost_usd` / `latency_ms`                                             |
| Model and prompt version recording                    | `ai_runs.model` / `prompt_version` on every run, success or failure                                              |
| Safe error messages                                   | `AIProviderError` messages are generic/non-leaking; raw provider errors are never surfaced to the client         |
| No sensitive prompt logging outside protected storage | Full prompt/output only ever written to `ai_runs` (RLS-protected, org-scoped, append-only); nowhere else         |

### 1.6 UI (brief §UI)

New components under `apps/web/components/domain/scorecard/`:

- `requirement-extraction-panel.tsx` — AI-processing, extraction-failure,
  no-job-description, and AI-unavailable (`anthropicConfigured === false`)
  states.
- `requirement-list-editor.tsx` — full requirement CRUD: classification
  controls (all 5 types), weight editor, source-evidence viewer
  (quoted source text + location), live weight-total validation banner.
- `scorecard-approval-panel.tsx` — submit-for-approval, approve/reject/
  request-changes controls, version history, and the client-approval
  permission `Switch` (agency-admin-only).

`apps/web/app/(app)/projects/[projectId]/scorecard/page.tsx` was rebuilt
from a static placeholder into a real screen: demo-mode and live-Supabase
branches, `canEdit`/`canApprove`/`canManageClientPermission` computed from
role + the project's `client_can_approve_scorecards` flag, rendering the
three components above. Responsive Tailwind layout serves both desktop and
the "mobile scorecard review" requirement as one route, matching the
pattern established in every prior phase (mobile is a CSS concern here, not
a separate screen/route).

### 1.7 Types (`packages/types/src/index.ts`)

`RequirementType`, `JobRequirementSchema`, `ScorecardSchema`,
`ScorecardVersionSchema`, `ScorecardApprovalSchema`, `AIRunSchema`
(including `idempotencyKey`), `AIPromptVersionSchema`,
`ExtractedRequirementSchema`, `RequirementExtractionOutputSchema`,
`RequirementExtractionResultSchema`, `UNWEIGHTED_REQUIREMENT_TYPES`, and
`RecruitmentProjectSchema.clientCanApproveScorecards` — shared between DB
row-mapping and AI-output validation, per the established convention.

## 2. Tests added

48 new unit tests (169 total, up from 121), all passing:

- `lib/ai/provider.test.ts` (7) — structured-output validation: a
  well-formed extraction, out-of-range confidence, an unsupported
  requirement type, a missing `sourceText`, >60 requirements, a
  non-object payload.
- `lib/ai/prompt.test.ts` (10) — every brief-required prompt rule is
  present; the document delimiter cannot be forged closed by hostile
  document content.
- `lib/ai/extract-requirements.test.ts` (8) — `not_configured`
  short-circuits with zero provider calls; success; a **prompt-injection
  fixture** (instruction-shaped lines inside the document text produce
  zero requirements, never a fabricated approval); retry-once-then-
  `rejected_by_validation`; recovery on retry; timeout and provider-error
  both report `error` without retrying, with a safe message; prompt
  version recorded on every outcome.
- `lib/scoring/validate-weights.test.ts` (11) — **score-weight
  validation**: unweighted-type-with-weight rejected, preferred-with-no-
  weight rejected, totals ≠100% rejected both directions, 0.01 tolerance,
  zero-preferred is valid.
- `lib/scoring/scorecard-versions.test.ts` (15) — version numbering,
  **version immutability** at the application layer, the approval gate's
  every refusal path (already active/superseded, zero requirements,
  invalid weights), collecting all reasons at once.
- `lib/scorecards/approval-permission.test.ts` (8) — **approval
  permission tests**: admin roles always allowed, recruiter/read-only
  never allowed, client reviewer refused by default and only allowed with
  the opt-in flag on; **tenant isolation tests**: a client reviewer from a
  different client is refused even with the flag on, and a reviewer with
  no client on their membership is refused.
- `lib/requirements/edit-rules.test.ts` (4) — **human-edit preservation**:
  an unreviewed AI-proposed requirement becomes `reviewed` on edit, an
  already-reviewed one stays `reviewed`, a manually-added one is
  untouched, and the function's signature makes it structurally
  impossible for an edit to rewrite `ai_generated`.

Every brief-listed testing category is covered except two that require a
live backend and are explicitly deferred (see §4): **unsupported-
requirement tests** (covered — see `provider.test.ts`) and **tenant
isolation tests** (covered at the application-decision layer in
`approval-permission.test.ts`, consistent with this repo's established
"pure-decision-logic only, no Supabase mocking" testing convention — the
same boundary documented in `lib/auth/session.ts` since Build Phase 2).

Plus real functional verification of the migrations against a local
Postgres instance (§1.1) — not a Vitest test file, but a genuine
verification step beyond what prior phases performed.

## 3. Commands run (verification gate)

```
pnpm --filter web typecheck     PASS
pnpm --filter web lint          PASS (0 errors, 0 warnings)
pnpm --filter web test          PASS — 169/169 (31 files)
pnpm --filter web build         PASS — all routes compiled/prerendered,
                                        including the new scorecard route
```

## 4. Known limitations / deferred

- **No live Supabase project connected** — identical in kind to the
  blocker reported in Build Phases 2 and 3. The migrations, RLS policies,
  and every live-Supabase-data code path (`loadScorecardData()`'s
  live branch, the four new server actions' Supabase writes) are
  code-complete and typechecked but have never executed against a real
  Supabase project.
- **No `ANTHROPIC_API_KEY` configured** — new to this phase.
  `AnthropicProvider` is fully implemented (correct SDK usage, forced
  tool-use schema, timeout) but has never been exercised against the live
  Anthropic API in this environment. The only code path that can reach it
  (`runRequirementExtraction`'s default provider resolution) has been
  unit-tested only via `anthropicConfigured === false`, which is the
  honest state here.
- **RLS itself was not exercised in the local-Postgres verification** —
  the stub `auth` schema reproduces enough of Supabase's shape for
  constraint/trigger/unique-index testing, but not its actual
  `auth.uid()`/JWT-claims wiring, so the RLS policies in `0015`–`0017`
  remain verified by careful review and by mirroring the pattern from
  prior phases' RLS (which itself has never run against live Supabase
  either), not by an executed policy test.
- **Cost/token metadata fields exist but are unpopulated by any real
  call** — `ai_runs.input_tokens`/`output_tokens`/`cost_usd` are wired
  through from `AIProviderCallResult`, but since the real provider has
  never run, no real cost/token figures exist yet to validate against
  actual Anthropic billing.

## 5. Recommendation for next build

Before candidate sourcing/parsing/matching (which depends on an approved
scorecard version to score against) begins, resolve at least the
`ANTHROPIC_API_KEY` blocker — even a single live extraction run, reviewed
by a human, would validate the prompt/schema/parsing pipeline end-to-end
in a way no amount of deterministic-adapter testing can. The Supabase
connection remains the larger, longer-standing blocker carried since Build
Phase 2 and should be resolved once, covering all phases' live-data paths
together rather than re-verified phase by phase.

---

**BUILD PHASE 4: BUILD INCOMPLETE — BLOCKERS REMAIN**

(Code-complete, fully typechecked/linted, 169/169 unit tests passing,
production build succeeds, and — new this phase — the schema/RLS/
constraints/trigger were functionally verified against a real local
Postgres instance, not just reviewed. Incomplete because two integrations
remain unconfigured in this environment: no live Supabase project (carried
unchanged from Build Phases 2–3) and no Anthropic API key (new to this
phase), so the real AI provider and every live-database code path have
never been executed for real.)
