# Build Phase 18 — Client Feedback Repair Report

This report closes the loop opened by `docs/client-feedback-reproduction-report.md`. That report reproduced every item in Dave's private-demo feedback and traced five of the six to one root cause: the demo-mode branches of nearly every screen were disconnected mock UI, not the real domain logic. The governing instruction for this phase was explicit that the absence of Supabase/Anthropic credentials is **not** the defect — the defect is that the fallback experience was incomplete and unwired. This report does not repeat that framing; it verifies the repair against it.

Per instruction, this report does not stop at "tests pass." Each section below states the root cause, the code change, the automated evidence, and — separately — the actual browser journey and what appeared on screen at each step, captured from a real `next build && next start` run (never `next dev`), because two of the three most serious defects found this phase were invisible in dev mode and invisible to unit tests alike.

## 0. What actually broke, restated honestly

The reproduction report's "one root cause" (disconnected demo UI) was real, but fixing it uncovered three further defects, discovered only through this phase's own instruction to add real browser-level tests rather than trust the unit suite:

1. **A duplicate early return made `/candidates/new` dead code**, independent of anything the reproduction report found — see §5.
2. **Next.js static prerendering froze the demo engine's mutable state at `next build` time** on 13 different pages, so nothing that happened after the build (an evaluation, a new candidate, an outreach draft, a shortlist change) would ever show up in a deployed (`next start`) demo, no matter how correct the underlying engine logic was. This is very likely the actual mechanism behind several of Dave's reports, and it could not have been caught by `next dev` or by Vitest — only by testing an actual production build in a browser.
3. **A stale client-side Router Cache** could still show pre-reset data for up to 30 seconds after a server action changed it.

All three are now fixed. Full technical detail is in `docs/demo-limitations.md` §8.1.

## 1. Candidate matching and sorting

- **Root cause:** two independent defects stacked on top of the "disconnected UI" root cause. First, `SampleAssessmentMatchingProvider`/`TestMatchingAIProvider`'s evidence-to-requirement matching does a case-insensitive substring match of the requirement's own name against candidate evidence text (a deliberate design choice — see §2) — but the original demo seed evidence text never literally contained the requirement names, so every candidate would have shown "insufficient evidence" regardless of how strong their real fictional background was. Second, the shortlist/candidate list pages were reading from static Build Phase 1 mock arrays, not the engine, so sorting had nothing real to sort.
- **Code change:** `runDemoEvaluation()` (`apps/web/lib/demo/engine.ts`) now tags each evidence item's text with its own already-known requirement name (from the `evidenceByRequirement` map's own keys) before it reaches the matching provider — this is not inventing evidence; it is telling the provider which requirement each already-seeded evidence item was collected for, which a real recruiter's structured evidence collection would also make explicit. `sortDemoCandidates()` and `listDemoCandidatesForProject()` now source live engine state, and `sortDemoCandidates()` always partitions eligible candidates ahead of ineligible ones regardless of the requested sort key (mirroring `lib/shortlists/load-detail.ts`'s live-mode query).
- **Unit/integration evidence:** `apps/web/lib/demo/engine.test.ts` — "ineligible candidate never outranks eligible" and related sort-key tests, part of the 901/901 passing suite (`pnpm exec vitest run`, 120 files, 901 tests, 0 failures).
- **Browser evidence:** Test 4 (`e2e/demo-workflow.spec.ts`) opens Sarah Mitchell's profile, clicks "Run evaluation," and the screen shows *"Demonstration evaluation — live AI is not connected."*, an **Eligible** badge, and the literal evidence line "5+ years multi-unit retail management experience" under the matched requirement. Test 5 opens Derek Holloway (seeded to fail the mandatory driver's-license gate) and the screen shows **Ineligible** — never guessed as a pass. Test 6 opens the shortlist workspace and the screen shows Derek under a separate "Not eligible for this shortlist" heading, never mixed into the ranked list above it.
- **Final status:** Fixed and verified end to end in a browser.
- **Remaining production dependency:** none for the demo path. Live mode still requires a configured Anthropic key for the real semantic assessment step.

## 2. AI functionality

- **Root cause:** the demo had no deterministic evaluation wired to anything a person could click, and nothing distinguished a real AI call from the fallback.
- **Code change:** `runMatchingEvaluationAction` (`apps/web/lib/matching/matching-actions.ts`) branches to `runDemoEvaluation()` when `!supabaseConfigured`, running the exact same deterministic gates/scoring/evidence pipeline (`lib/matching/gates.ts`, `lib/matching/evaluate.ts`) the live path uses, fed by a provider whose model id (`'sample-assessment-v1'`) can never be mistaken for a real Anthropic model id. The label *"Demonstration evaluation — live AI is not connected."* is rendered by `SampleAssessmentNotice` wherever a demo result is shown, and is never omitted or swapped for live-AI language.
- **Unit/integration evidence:** `lib/matching/matching-pipeline.test.ts`, `lib/demo/engine.test.ts` (gate precedence, missing-evidence-never-a-pass).
- **Browser evidence:** Tests 4–6 (above) show the label rendered on both the candidate detail page and the shortlist workspace, every time a result is shown, with no code path that omits it.
- **Final status:** Fixed and verified.
- **Remaining production dependency:** a configured `ANTHROPIC_API_KEY` for live semantic assessment; not required for this demo.

## 3. Shortlisting

- **Root cause:** the "Continue to Shortlist" button and the shortlist workspace were static markup with no server actions behind them at all.
- **Code change:** `ShortlistDemoView` (`apps/web/app/(app)/shortlists/[shortlistId]/demo-view.tsx`) is a real client component wired to `markDemoCandidateReviewedAction`/`addToDemoShortlistAction`/`removeFromDemoShortlistAction` (`lib/demo/demo-actions.ts`), which call `shortlistDemoCandidate()`/`removeDemoShortlistEntry()` in the engine. The 3-candidate cap and duplicate-entry rejection are enforced by `canAddCandidateToShortlist()`/`nextShortlistRank()` (`lib/shortlists/rules.ts`) — the same pure functions the live path uses — called from the engine itself, not from the UI, so the cap cannot be bypassed by calling the action directly.
- **Unit/integration evidence:** `lib/demo/engine.test.ts` — "enforces a maximum of three candidates — a fourth is rejected," "rejects adding the same candidate to the shortlist twice," "rejects unauthorized cross-project shortlist access," "removing a candidate frees a shortlist slot."
- **Browser evidence:** Test 6 marks Sarah Mitchell reviewed and adds her; the screen updates to "On the shortlist (1/3)" immediately. Test 10 evaluates and reviews four fully-eligible candidates, adds three, confirms the screen shows "On the shortlist (3/3)," and confirms the fourth eligible candidate's own "Add to shortlist" button is disabled — the same server-side rule the UI reflects, not a UI-only guard.
- **Final status:** Fixed and verified.
- **Remaining production dependency:** none for the demo path.

## 4. Project flow

- **Root cause:** every downstream screen (project detail, scorecard, activity, jobs, dashboard) still read from Build Phase 1's static mock arrays, whose IDs didn't line up with the (already-fixed) shortlist/candidate pages' real engine IDs — clicking through from one fixed page to an unfixed one produced a 404 or a screen frozen at its original mock state, regardless of anything the person had just done.
- **Code change:** every demo-mode branch across `app/(app)/dashboard`, `projects`, `projects/[projectId]`, `projects/[projectId]/activity`, `projects/[projectId]/scorecard`, `projects/[projectId]/jobs/new`, `projects/[projectId]/jobs/[jobId]/description`, `candidates`, `candidates/[candidateId]`, `candidates/new`, `outreach`, and `shortlists`/`shortlists/[shortlistId]` now sources from `lib/demo/engine.ts`, using the same two seeded UUID-keyed projects everywhere. A real, canonical project state machine (`lib/projects/workflow-state-machine.ts`, documented in `docs/project-workflow-state-machine.md`) governs status transitions in both live and demo mode; the demo engine calls `validateProjectStatusTransition()` before accepting any status change.
- **Unit/integration evidence:** `lib/demo/engine.test.ts` — "rejects an invalid project-stage transition," "rejects a transition whose precondition is not met," "a valid transition succeeds and is recorded"; `lib/projects/workflow-state-machine.test.ts` (pre-existing, still passing).
- **Browser evidence:** Test 2 opens the retail project from the projects list and confirms the URL, the heading, and a live-computed "Current project status:" line render for a real project. Test 8 opens that same project's activity log after tests 3–7 have run and confirms it shows the actual actions taken (evaluated / shortlist / reviewed), not a static list.
- **Final status:** Fixed and verified. The dashboard's headline metric *counts* (not its project links, which are now real) are still Build Phase 1 static figures — out of scope for this phase, stated honestly in `docs/demo-limitations.md` §8.
- **Remaining production dependency:** none for the demo path.

## 5. Candidate sourcing

- **Root cause — reconciling "`/candidates/new` is dead" against Dave's "candidate creation works":** both were true, for different entry points. Manual creation was genuinely dead: `createCandidateAction` (`apps/web/lib/candidates/actions.ts`) had **two** `if (!supabaseConfigured)` checks — a leftover early return a few lines above the real Build Phase 18 demo-engine branch, which meant the demo branch could never run; every manual submission failed with "This environment is not connected to a live database yet." **CSV import never had this duplicate guard** and was fully wired to `importDemoCandidatesCsv()` from early in this phase — it is almost certainly the path Dave used when he reported that candidate creation worked. This is a genuine, previously undiscovered defect, not a discrepancy in Dave's report.
- **A second, independent defect was found by the same browser test that verified the fix above:** the "Workplace preference" `<select>` defaults to an empty string, and `CandidateCoreSchema.workplacePreference: z.enum([...]).optional()` rejects an empty string (`.optional()` tolerates a *missing* field, not an empty one) — so submitting the form with its own default, unmodified state failed validation with a raw "Invalid enum value" error, in both live and demo mode, since both share this one Zod schema.
- **Code change:** removed the dead early-return block in `createCandidateAction`. Added an `optionalEnum()` helper (`z.preprocess` turning `''` into `undefined`) applied to `workplacePreference`, `compensationPeriod`, and `sourceChannel` in `CandidateCoreSchema`. Because the demo engine models every candidate as belonging to exactly one project (`DemoCandidateState.projectId` is non-nullable — a stated, honest limitation, not a bug), `CandidateCreateForm` now takes a `requireProject` prop (`true` in demo mode): the project field is pre-selected and marked required instead of "(optional)," rather than letting a demo submission fail after the fact.
- **Unit/integration evidence:** existing `lib/candidates/*.test.ts` suite, still 100% passing after the schema change (no regression to live-mode validation behavior for a real selection).
- **Browser evidence:** Test 3 opens `/candidates/new`, fills only the required full name and an email, submits with every optional field — including workplace preference — left at its default, and confirms the redirect to `/candidates` and the new candidate's real appearance in the list. This is the literal scenario that was broken (a recruiter filling in only what they know and leaving the rest honestly unset).
- **Final status:** Fixed and verified for both discovered defects.
- **Remaining production dependency:** none for the demo path.

## 6. Outreach

- **Root cause:** the outreach screen was a fixed empty state with no demo-mode branch at all, regardless of shortlist or evaluation state.
- **Code change:** `DemoOutreachWorkspace` (`apps/web/components/domain/outreach/demo-outreach-workspace.tsx`) is a real interactive workspace: it lists only candidates the engine itself has marked eligible (never a UI-only filter — `createDemoOutreachDraft()` re-checks eligibility server-side and refuses an unevaluated or ineligible candidate), lets a recruiter draft against a real template, and approve/reject as a pure state transition. `decideDemoOutreachDraft()` never constructs or calls any email/LinkedIn/SMS provider — approval only records a human decision. The required label *"Demo mode — messages are not sent."* renders on the page header and inside a warning alert.
- **Unit/integration evidence:** `lib/demo/engine.test.ts` — "outreach approval never invokes an external provider," "refuses to draft outreach for an unevaluated candidate."
- **Browser evidence:** Test 7 opens `/outreach` after Sarah Mitchell has been evaluated and shortlisted, confirms the "Demo mode — messages are not sent." label, generates a draft, confirms "Drafts (1)" appears, approves it, and confirms the screen shows "Approved — demo mode, no message was sent."
- **Final status:** Fixed and verified.
- **Remaining production dependency:** a configured Resend (or equivalent) provider for live sends; not required for, and never triggered by, this demo.

## 7. The complete browser journey — what actually appeared on screen

This is the full run captured from `npx playwright test e2e/demo-workflow.spec.ts` against a real `next build && next start` server (no mocking, no `next dev`), reproduced twice for stability. All 11 tests pass both times.

| # | Step | What appeared on screen |
|---|---|---|
| 1 | Dashboard | Heading "Dashboard" and the real "Regional Store Leader" project both visible. |
| 2 | Open a project from the list | URL changes to `/projects/<real-uuid>`, heading "Regional Store Leader," a live "Current project status:" line. |
| 3 | Add candidate, defaults left as-is | Redirects to `/candidates`; "E2E Test Candidate" appears in the real list. |
| 4 | Evaluate Sarah Mitchell | "Demonstration evaluation — live AI is not connected.", **Eligible** badge, evidence line "5+ years multi-unit retail management experience." |
| 5 | Evaluate Derek Holloway (fails license gate) | **Ineligible** badge — never shown as a pass. |
| 6 | Open shortlist workspace, review + add Sarah | Derek listed separately under "Not eligible for this shortlist"; after adding Sarah, "On the shortlist (1/3)." |
| 7 | Draft + approve outreach for Sarah | "Demo mode — messages are not sent."; "Drafts (1)"; after approval, "Approved — demo mode, no message was sent." |
| 8 | Open project activity log | Real entries for the evaluation, shortlist, and review actions taken above — not a static list. |
| 9 | Reset demo data, reopen the project | Shortlist workspace shows "0/3 shortlisted" — the pre-reset state is fully gone. |
| 10 | Negative test: evaluate + review 4 eligible candidates, add 3 | "On the shortlist (3/3)"; the 4th candidate's own "Add to shortlist" button is disabled. |
| 11 | Mobile viewport (iPhone 13) | Shortlist workspace and evaluation labelling both render correctly at 390px width. |

## 8. Required negative tests — status

All nine required negative tests are covered and passing, split between the fast unit suite (engine-level, `lib/demo/engine.test.ts`) and the browser suite (UI-level, `e2e/demo-workflow.spec.ts`):

| Negative test | Covered by |
|---|---|
| Candidate failing a mandatory gate cannot be shortlisted | `engine.test.ts`; E2E test 5/6 |
| Missing evidence cannot increase the score | `engine.test.ts` (gates.ts precedence) |
| Ineligible candidate cannot rank above eligible candidates | `engine.test.ts`; E2E test 6 |
| Fourth shortlisted candidate is rejected | `engine.test.ts`; E2E test 10 |
| Duplicate shortlist entry is rejected | `engine.test.ts` |
| Unauthorized project/candidate access is rejected | `engine.test.ts` |
| Invalid project-stage transition is rejected | `engine.test.ts` |
| Outreach approval never invokes an external provider | `engine.test.ts`; E2E test 7 |
| Demo reset restores the original scenario | `engine.test.ts`; E2E test 9 |

## 9. Full verification results (final state of the repository)

- `npx tsc --noEmit -p apps/web` — 0 errors.
- `pnpm exec eslint apps/web --max-warnings=0` — 0 warnings, 0 errors.
- `pnpm exec vitest run` (apps/web) — **120 files, 901 tests, 0 failures.**
- `pnpm exec next build` (apps/web) — succeeds; all 13 demo-reading routes now render as `ƒ` (dynamic, server-rendered on demand) rather than `○`/`●` (static/SSG).
- `npx playwright test e2e/demo-workflow.spec.ts` — **11/11 passed**, run twice against a fresh production build for stability.

## 10. Files changed this phase (this repair pass, in addition to the demo-mode-rewrite work already reported as accepted)

- `apps/web/lib/candidates/actions.ts` — removed the dead duplicate `!supabaseConfigured` early return; added `optionalEnum()` preprocessing for `workplacePreference`/`compensationPeriod`/`sourceChannel`.
- `apps/web/components/domain/candidates/candidate-create-form.tsx` — added `requireProject` prop; project field required and pre-selected in demo mode.
- `apps/web/app/(app)/candidates/new/page.tsx` — passes `requireProject={!supabaseConfigured}`.
- 13 page files given `export const dynamic = 'force-dynamic'` (three of them also had their `generateStaticParams` removed): `candidates/[candidateId]`, `candidates/new`, `candidates`, `projects/[projectId]`, `projects/[projectId]/scorecard`, `projects/[projectId]/activity`, `projects/[projectId]/jobs/new`, `projects/[projectId]/jobs/[jobId]/description`, `projects`, `dashboard`, `outreach`, `shortlists`, `shortlists/[shortlistId]`.
- `apps/web/next.config.ts` — `experimental.staleTimes.dynamic = 0`.
- `apps/web/e2e/demo-workflow.spec.ts` — fixed the `window.confirm()` auto-dismiss gap in `resetDemo()`; replaced brittle `.first()` row targeting in the max-3 negative test with per-candidate-name scoped locators; hardened the candidate-creation assertion to check the real post-redirect list rather than a transient message.
- `docs/demo-limitations.md` — added §8.1 documenting the three browser-only defects found and fixed this pass.

## 11. Verdict

**CLIENT FEEDBACK REPAIRS COMPLETE — DEMO READY FOR RETEST**
