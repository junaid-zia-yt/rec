# Client Feedback Reproduction Report — Build Phase 18

Date: 2026-09-30
Scope: Reproduce and document every failure Dave reported after testing the private demo, before any code is touched. Per the Build Phase 18 brief: **"Do not modify code until the failures are reproduced and documented."** This report is that documentation. No source files were changed to produce it.

Confirmed working (not investigated further here, since they were reported as working): candidate creation, project creation.

---

## 0. The one root cause behind five of the six reports

Every one of the six reported failures traces back to a single environment fact, confirmed directly in code rather than assumed:

```ts
// apps/web/lib/env.ts:183
export const supabaseConfigured = Boolean(
  env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
)
// apps/web/lib/env.ts:206
export const anthropicConfigured = Boolean(env.ANTHROPIC_API_KEY)
```

Neither variable has ever been set in this project's history (`docs/demo-limitations.md`, `docs/build-phase-17a-staging-verification-report.md`). Every route that needs live data branches on `supabaseConfigured`/`anthropicConfigured` and falls back to a demo-mode path when it's `false` — which it always is here.

**The defect is not that this fallback exists — it's supposed to exist.** The defect is that the fallback was built *inconsistently* across screens:

- Some screens (candidate list, scorecards, shortlists hub) get a real, interactive **demo-data preview** backed by fixtures in `lib/mock-data.ts`.
- Other screens (**Add candidate**, **Outreach**) get a **dead end** — a static card or empty state with no form, no CTA, nothing to interact with.
- One screen (**Shortlist review**) gets an interactive-*looking* demo view whose one primary button has **no handler wired to it at all** — a genuine bug, not a demo-mode design choice.
- One field (**project status**) is defined in the schema but **never written by any code path**, so a progress stepper that reads it is decorative regardless of `supabaseConfigured`.

So: two of the six reports (candidate matching/sorting, AI functionality) are the demo correctly and honestly refusing to fake a result it can't produce. Two (shortlisting, project flow) contain a real, fixable bug on top of the infra gap. Two (candidate sourcing, outreach) are a real UX gap — the underlying logic is implemented and tested, but the demo-mode page for that specific action was never given the same fixture-backed fallback every other screen has.

This distinction is not being used to excuse anything — sections 1–6 below give the concrete fix target for every one of the six items. It's stated up front only so the repair plan spends effort on the four screens that need work rather than on trying to fake live AI/DB behavior that this project's own rules ("never claim an external integration works until it has been configured and tested") forbid faking.

---

## 1. Candidate matching and sorting

**Classification: blocked-by-infra (matching), plus one real integration gap (the deterministic stand-in isn't wired to the click path). Sorting logic itself is correct.**

**Trace**
- UI: "Run evaluation" button → `apps/web/components/domain/candidates/candidate-evaluation-panel.tsx:421` → `runMatchingEvaluationAction(formData)`.
- Server action: `apps/web/lib/matching/matching-actions.ts:66-161`. Line 75-77 returns immediately — `if (!supabaseConfigured) return { success: false, message: 'This environment is not connected to a live database yet.' }` — before any matching logic runs.
- Live path (real, but unreachable without a live DB): `enqueueJob`/`executeJob` → `apps/web/lib/jobs/handlers/candidate-evaluation.ts`, writing `matching_runs`, `candidate_role_matches`, `mandatory_gate_results`, `scoring_breakdowns`.
- Candidate list/detail pages fall back to static `DEMO_CANDIDATE_RECORDS` fixtures with **no scores at all**, because scores live only in `candidate_role_matches`, a table this branch never queries.
- **Sorting is server-side/deterministic, not client-side or AI-driven**: `apps/web/lib/shortlists/load-detail.ts:183-215` filters to `eligibility = 'eligible'` in the query (line 188) *before* sorting by score (line 215). A gate-failed candidate is excluded from the pool at the query stage — it cannot be sorted above an eligible candidate. This is correct today.
- AI: `SampleAssessmentMatchingProvider` (`apps/web/lib/matching/demo-sample-assessment-provider.ts`), a deterministic, honestly-named (`ai_runs.model = 'sample-assessment-v1'`) stand-in, exists and is used by the **seed script only** — it is never imported by `matching-actions.ts` or `run-matching-assessment.ts`, so clicking "Run evaluation" in the demo cannot reach it. This is the specific, fixable gap: the stand-in that would make matching interactive in demo mode already exists and is not connected to the button.

**Tests run**: `npx vitest run lib/matching/matching-pipeline.test.ts lib/matching/evaluate.test.ts lib/matching/gates.test.ts lib/matching/scoring.test.ts lib/shortlists/*.test.ts` → **67/67 passed.**

**Root cause**: the gate/scoring/sorting engine is correct and fully tested in isolation. The demo cannot exercise it interactively because (a) there's no live Supabase project, and (b) the one thing that could stand in for that — the seed-only sample provider — was never wired into the live click path.

---

## 2. AI functionality

**Classification: blocked-by-infra, architecture is real and unexercised (correctly so, per project rules against faking live integrations).**

**Trace**
- Live provider: `apps/web/lib/ai/anthropic-matching-provider.ts:93-151` — a real Anthropic SDK call, model `claude-sonnet-5`, gated on `anthropicConfigured`.
- Orchestrator: `apps/web/lib/ai/run-matching-assessment.ts:57-75` — no key present → `provider = null` → returns `status: 'not_configured'` without ever calling the API.
- Pipeline: `apps/web/lib/matching/matching-pipeline.ts:34-82` maps `not_configured` → `errorKind: 'ai_not_configured'`, `status: 'failed'` — this is the actual result a click produces today (before even reaching the `supabaseConfigured` check above, in the live-DB scenario).
- The deterministic `SampleAssessmentMatchingProvider` (see §1) is distinct from this and is never presented as live AI anywhere it's used — it's honestly labelled.

**Tests run**: `npx vitest run lib/ai/run-matching-assessment.test.ts` → **8/8 passed**, covering exactly the not-configured/error/retry state machine above.

**Root cause**: no `ANTHROPIC_API_KEY` has ever existed in this project (confirmed, not assumed). The code correctly refuses to fake a live result. What's missing for the demo specifically is a visible, honestly-labelled deterministic evaluation path a client can actually click and see run — which is §1's fix, not a new AI feature.

---

## 3. Shortlisting

**Classification: blocked-by-infra for the real builder, plus one confirmed dead-button bug in the demo view.**

**Trace (live path — real, tested, unreachable without a live DB)**
- Routes: `apps/web/app/(app)/shortlists/page.tsx` (hub) → `.../[shortlistId]/page.tsx` (detail).
- Server actions: `apps/web/lib/shortlists/shortlist-actions.ts` — create (46), add candidate (131), remove (231), submit for approval (324), internally approve (397), send to client (484), record client decision (594). All Zod-validated, permission-gated, write `shortlist_activity` and an audit event.
- DB (`supabase/migrations/0028_human_review_shortlisting.sql`): max-3 rule and non-eligible-candidate block are enforced by a **server-side BEFORE INSERT trigger** (`enforce_shortlist_candidate_rules()`, lines 261-317), not just application code. Duplicate prevention: `UNIQUE(shortlist_version_id, candidate_id)`. Tenant isolation: RLS on every table.

**The actual bug** — `apps/web/app/(app)/shortlists/[shortlistId]/demo-view.tsx:185-187`:

```tsx
<Button className="mx-auto mt-2 flex w-full max-w-6xl" disabled={selected.length === 0}>
  Continue to Shortlist ({selected.length} Selected)
</Button>
```

This button has **no `onClick` and no `action` prop** (confirmed by grep — zero matches for either on this element). Once at least one candidate is checked, the button becomes enabled and looks fully functional — clicking it does nothing at all. This is the concrete, reproducible bug behind "shortlisting is not working." It is a genuine defect, not a demo-mode limitation.

**Tests run**: `npx vitest run lib/shortlists/rules.test.ts lib/shortlists/queue.test.ts lib/shortlists/visibility.test.ts` → **20/20 passed** — confirms the max-3/duplicate/eligibility rules are correct in isolation.

---

## 4. Project flow

**Classification: incomplete — the status field and its UI are disconnected from reality.**

- Schema: `recruitment_projects.status` enum = `intake | sourcing | shortlisting | client_review | closed` (`supabase/migrations/0009_recruitment_projects.sql:17-18`), CHECK-constrained only, **no transition-validating trigger**.
- The only write path, `updateProjectAction` (`apps/web/lib/projects/actions.ts:105-172`), accepts any value from that enum with **no transition rules** — nothing stops `intake → closed` directly if it were ever called with that value.
- **But nothing in the shipped UI ever calls it with a status change.** `ProjectForm` has no status control. `apps/web/lib/copilot/tools/workflow.ts:69-75` only *reads* `project.status`. No other write site exists anywhere in `apps/web/lib`.
- **Net effect: every project's `status` stays `'intake'` forever.** The `WorkflowStepper` on the project detail page (`apps/web/app/(app)/projects/[projectId]/page.tsx:143-162`) hardcodes "Intake", "Requirements", and "Scorecard" as `'complete'` unconditionally, and its "Sourcing"/"Shortlisting" ternaries fall through to `'complete'`/`'upcoming'` by default since `status` never actually changes. **The stepper can visually claim a stage is done that never happened** — it is decorative, not derived from real state.
- What *is* genuinely, correctly gated server-side: candidate evaluation cannot run without an `active` scorecard version (`apps/web/lib/jobs/handlers/candidate-evaluation.ts:98-116`, throws otherwise). This real gate just isn't tied to the `status` field or reflected in the stepper.

**Tests run**: `npx vitest run lib/jobs/handlers/candidate-evaluation.test.ts lib/auth/project-scope.test.ts` → **17/17 passed** — confirms the scorecard gate itself is correct; no test exists asserting on `recruitment_projects.status` transitions, because nothing in the app produces one to test.

---

## 5. Candidate sourcing

**Classification: incomplete demo-mode UX gap (the underlying CSV/manual-entry/dedup logic is implemented and tested); "not connected" states for external providers are honest and working as designed.**

**Trace**
- Route: `apps/web/app/(app)/candidates/new/page.tsx`. When `!supabaseConfigured` (always true here), lines 40-59 return **only a static info card** — "This is a preview using demo data. Creating real candidates requires a configured Supabase project" — and render **neither** the manual-entry form nor the CSV-import tab. There is no way to interact with this screen at all in demo mode.
- This is a direct asymmetry with `apps/web/app/(app)/candidates/page.tsx` (the list view), which has a proper fixture-backed fallback (`buildDemoListItems()`) and looks and behaves like a working screen.
- By contrast, `apps/web/app/(app)/integrations/page.tsx` (LinkedIn/Apollo/TA Tracker) shows a clear, honest `EmptyState` — "Not connected to a live database" — which is working exactly as intended and is not a bug.
- Server actions (`apps/web/lib/candidates/actions.ts` — `createCandidateAction`, `importCandidatesFromCsvAction`, `uploadCandidateDocumentAction`) are real, complete implementations; they're simply unreachable from this page in demo mode.

**Tests run**: `npx vitest run lib/candidates/csv-import.test.ts lib/candidates/dedup.test.ts` → **25/25 passed.**

**Root cause**: `/candidates/new` is the one candidate-related screen that was never given a fixture-backed interactive demo fallback, unlike the list view right next to it. That inconsistency, not any broken business logic, is what reads to a client as "sourcing doesn't work."

---

## 6. Outreach

**Classification: same demo-mode UX gap as sourcing for the workspace itself; the send-blocking behavior is correctly working as designed.**

**Trace**
- Route: `apps/web/app/(app)/outreach/page.tsx`. When `!supabaseConfigured`, lines 20-34 render **only** a bare `EmptyState` — "No outreach activity yet... This screen renders no send capability in this environment" — with **zero** interactive drafts, templates, or approve/reject controls. The file's own comment (lines 12-17) confirms this directly: "no mock outreach activity is defined in `lib/mock-data.ts`," so there was never a fixture path built for this screen, unlike candidates or shortlists.
- Server logic (`apps/web/lib/outreach/outreach-actions.ts`, `status-transitions.ts`, `idempotency.ts`, `opt-out.ts`) and channel adapters (`lib/outreach/channels/email.ts`, `linkedin.ts`, `sms.ts`, `telephone.ts`) are real and complete; unreachable in demo mode for the same reason.
- **Send-blocking is correct and intentional, not a bug**: `lib/outreach/channels/email.ts:26-40` hard-blocks whenever `!resendConfigured || demoModeEnabled`, returning `status: 'not_configured'` with the message "Outreach sending is disabled in this demo — no message was sent." `lib/outreach/channels/linkedin.ts` exports **no send function at all**, by design, per the project rule against automating LinkedIn.

**Tests run**: `npx vitest run lib/outreach app/(app)/outreach/page.test.tsx` → **8 files / 70 tests passed**, including confirmation that the email adapter always returns a simulated, non-real send result.

**Root cause**: identical shape to §5 — the workspace page was never given a demo-mode fixture fallback, so a client sees a dead page instead of an interactive draft/approve flow, even though every piece of logic behind it is implemented, tested, and safely blocked from ever sending anything.

---

## Summary table

| # | Feature | Underlying logic | What the client actually hit | Classification |
|---|---|---|---|---|
| 1 | Candidate matching | Correct, 67/67 tests pass | "Not connected to a live database" message on click; demo stand-in not wired to the button | Blocked-by-infra + one wiring gap |
| 2 | Sorting | Correct, server-side, gate-excluded pool | Same as above — no scores exist to sort without a matching run | Blocked-by-infra (no sorting bug found) |
| 3 | AI functionality | Real Anthropic integration, never exercised (no key, by design) | Honest `ai_not_configured` result | Blocked-by-infra, working as designed |
| 4 | Shortlisting | Correct, DB-trigger-enforced, 20/20 tests pass | A primary action button with no click handler at all | **Real bug** + blocked-by-infra for the full builder |
| 5 | Project flow | Scorecard-approval gate is real and enforced | A progress stepper that always shows early stages "complete" regardless of truth; a status field nothing ever writes | **Real gap** (dead field, decorative UI) |
| 6 | Candidate sourcing | Correct, 25/25 tests pass | A dead page with no form and no CTA | **Real UX gap** (missing demo fallback) |
| 7 | Outreach | Correct, safely send-blocked, 70/70 tests pass | A dead page with no drafts or controls | **Real UX gap** (missing demo fallback) |

## What this means for the repair phase

Four concrete, fixable items carry the actual client-visible failure, independent of any credential:

1. Wire the existing `SampleAssessmentMatchingProvider` into the live "Run evaluation" click path (labelled honestly as a demonstration evaluation), so matching/sorting/AI-functionality become interactive in demo mode without faking a live model call.
2. Fix the dead "Continue to Shortlist" button in `shortlists/[shortlistId]/demo-view.tsx`.
3. Give `/candidates/new` and `/outreach` the same fixture-backed interactive demo fallback every other screen already has, instead of a dead end.
4. Either wire `recruitment_projects.status` to real transitions with server-side validation, or make the `WorkflowStepper` honestly reflect actual per-stage completion instead of hardcoding early stages as done.

No code has been changed to produce this report. These four items are the recommended scope for the next phase.

---

Related documents: `docs/demo-limitations.md` · `docs/private-client-demo-guide.md` · `docs/08-candidate-scoring.md` · `docs/09-ai-architecture.md` · `docs/07-data-model.md`
