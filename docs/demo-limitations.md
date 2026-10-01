# Demo Limitations — Private Client Demonstration (Build Phase 17D, updated Build Phase 18)

Date: 2026-09-30 (Build Phase 18 update; originally 2026-09-29)

This document exists so no one — including future us — mistakes the private demo for more than it is. It is the single place that lists, honestly, everything the demo does **not** prove.

## 0. Build Phase 18 correction: the absence of live credentials was never the actual defect

Earlier drafts of this project's demo documentation, and the Build Phase 18 reproduction report's first pass, described several of Dave's reported failures (candidate matching, sorting, shortlisting, project flow) in terms of missing Supabase/Anthropic credentials. **That framing was wrong and has been corrected.** The private demo's own design goal is a complete, honest, deterministic workflow that needs no external infrastructure at all — Supabase and Anthropic were never required for it, and are not required now. The actual defects Dave hit were that large parts of the demo-mode code path were never built out to begin with: hardcoded empty arrays, dead buttons with no handler, and static fixtures that didn't move when the user took an action. Build Phase 18 (`docs/build-phase-18-client-feedback-repair-report.md`) closed those specific gaps by building a real, in-memory demo engine (`apps/web/lib/demo/engine.ts`) that runs the same deterministic pipeline, gate rules, and shortlist rules the live path uses, against two complete fictional recruitment projects.

Sections 1–6 below still list what remains true regardless of that fix — nothing about *production* readiness changed in Build Phase 18. Section 8 (new) documents the demo engine's own limitations honestly, the same way this document has always done for everything else.

## 1. No live infrastructure of any kind

This sandbox has never had, at any point in this project's history, real credentials for:

- Vercel (no production or staging deployment has ever occurred)
- Supabase, staging or production (no real project has ever been provisioned)
- Sentry (no DSN has ever been set — `sentryConfigured` is `false` everywhere)
- Resend (no sending domain has ever been configured)
- A production- or staging-scoped Anthropic API key (no live Claude API call has ever been made in this project's history)

This remains true, but — per the correction above — it is not why any of Dave's reported failures occurred, and it is not a blocker for the private demo working correctly. The private demo runs entirely against an in-memory demo engine and local application processes, by design. It proves nothing about how the system behaves under real cloud infrastructure, real network conditions, real load, or a live Anthropic model's actual semantic judgment — that remains a separate, later verification step, not something this demo ever claimed to prove.

## 2. No live AI model output

Every gate pass/fail and every score shown in the demo is a **real** computation by the real deterministic pipeline. But the semantic-relevance judgment that would normally come from a live Anthropic Claude API call is replaced by a deterministic, offline stand-in (`SampleAssessmentMatchingProvider`, `ai_runs.model = 'sample-assessment-v1'`), clearly labelled wherever it appears. **This demo does not demonstrate, and should not be read as demonstrating, how a live Claude model actually performs at candidate evaluation, evidence extraction, or outreach drafting.** That verification requires a real, credentialed Anthropic API key and has never been performed (see `docs/build-phase-17a-staging-verification-report.md` §7 for the specific blocked gate).

## 3. No real outreach

All outreach in the demo is disabled at the channel-adapter level, unconditionally, regardless of whether a real sending credential exists. Every outreach item shown is a **draft that was never sent**. This demo proves the drafting and human-review workflow exists; it proves nothing about real deliverability, real candidate response handling, or real LinkedIn/Apollo-assisted sourcing.

## 4. No real candidate or client data

Every organization, client, role, and candidate in the demo dataset is fictional — invented names, invented companies that do not exist, no real personal information of any kind. This demo proves nothing about how the system performs against the messiness of real resumes, real job descriptions, or real candidate communication.

## 5. TA Tracker — deferred by deliberate scope decision, not a demo gap

TA Tracker integration is not simulated in this demo and is not planned to be. Per this project's own engineering rule ("Do not invent a TA Tracker API"), no TA Tracker API has ever been fabricated, and none will be. Any future TA Tracker integration requires a real, documented API from that vendor, provided by the client. This is labelled in-app as **deferred**, not broken and not "coming soon" on any specific timeline.

## 6. No production-readiness gates are closed by this demo

For the avoidance of doubt, restating `docs/final-release-report.md`'s conclusion exactly as it still stands: **PRODUCTION RELEASE BLOCKED — DO NOT GO LIVE.** The demo changes nothing about that decision. Specifically still open, unchanged by this phase:

- Stakeholder sign-off (`docs/client-go-live-decisions.md` — 13 of 14 items unsigned as of the last addendum).
- Live staging validation against real Supabase auth/RLS behavior.
- A live Sentry event confirmed received per failure surface.
- A real Supabase point-in-time-recovery restore actually exercised.
- Real, credentialed load testing.
- Legal review and sign-off on consent language, lawful basis for processing, and data-retention period.

## 7. What the demo does honestly prove

To be equally clear about what **is** real, not just what isn't: the deterministic gate-enforcement logic (Core Rule #6), the evidence-grounding and missing-information handling (Core Rule #4), the human-review-and-override workflow (Core Rule #7), the shortlist-size rule, and the overall page layouts and navigation at both desktop and mobile widths are all genuine, working code — verified fresh on 2026-09-29 via a clean format/lint/typecheck/test/build pass, a full local migration replay, a 98-assertion database regression suite, and a zero-error browser walkthrough across 11 routes at two viewports. The gap this demo cannot close is entirely about **live external infrastructure and live model behavior**, not about whether the core business logic works.

## 8. Build Phase 18 — the demo engine's own honest limitations

The demo engine (`apps/web/lib/demo/engine.ts`) is a real, working implementation of the deterministic matching/shortlisting/outreach/project-status rules, run against two complete fictional recruitment projects. It has its own limitations, stated here the same way every other gap in this document is stated:

- **In-memory, not a database.** `apps/web/lib/demo/engine.ts` holds all demo state in a single module-level object for the lifetime of the Node process. It is not written to disk and is not multi-instance-safe: if the demo were ever deployed behind more than one server process (e.g. horizontally scaled), two users could see different states depending on which instance handled their request. A single `next start` process — which is how this demo is run and retested — does not have this problem. "Reset demo data" (`resetDemoDataAction`) discards every mutation and rebuilds the two seeded projects from scratch; it is the only way to return to a known baseline, and it affects every user of that process, not just the person who clicked it.
- **Evidence matching is a labelled stand-in, not live AI.** Every gate/score/evidence result in the demo is produced by the real deterministic pipeline (`lib/matching/gates.ts`, `lib/matching/scoring.ts`, `lib/matching/evaluate.ts`), fed by `SampleAssessmentMatchingProvider` (`ai_runs`-equivalent model id `'sample-assessment-v1'`, never a real Anthropic model id) instead of a live Claude call. This is labelled everywhere it appears as *"Demonstration evaluation — live AI is not connected."* The provider identifies relevant evidence via a case-insensitive substring match of each requirement's name against the candidate's evidence text — the same convention `lib/ai/matching-test-adapter.ts`'s `TestMatchingAIProvider` already used for unit tests. This is a real, deterministic, evidence-grounded computation, not a live model's semantic judgment, and it is not represented as one anywhere.
- **Outreach never sends.** `decideDemoOutreachDraft` is a pure in-memory state transition (`draft` → `approved_not_sent` / `rejected`) — no email, LinkedIn, or SMS provider is ever constructed or called from this code path, regardless of approval. Labelled everywhere as *"Demo mode — messages are not sent."*
- **Scope of what this build phase touched.** Build Phase 18 rebuilt the demo-mode paths for: candidate matching/evaluation, sorting, shortlisting, candidate creation/CSV import, outreach drafting/approval, project status and stage display, and project activity history — the six areas Dave's feedback named. It did not rebuild demo-mode support for: the scorecard requirement-editing screen (seeded as already-approved and shown read-mostly; editing it calls live-mode actions that gracefully decline in demo mode rather than crashing), the dashboard's headline metric counts (still the Build Phase 1 static figures; only the "View project details" links were fixed to point at real projects), or the clients/POC-comparison screens (unchanged, not part of Dave's reported failures).
- **A candidate is always project-scoped in this demo.** `DemoCandidateState.projectId` is non-nullable — the engine has no concept of an unassigned candidate pool the way the live Supabase schema does. The "Add candidate" form reflects this honestly in demo mode: the project field is required and pre-selected, not offered as optional.

### 8.1 Three defects found only by browser-level testing (fixed)

Unit tests passing was not sufficient evidence — the client's own experience proved that. Three real defects were found only by driving the actual UI end to end against a real production build (`next build` + `next start`), and none of them were visible from unit tests alone:

1. **A duplicate `!supabaseConfigured` guard made `/candidates/new` truly dead code.** `createCandidateAction` (`apps/web/lib/candidates/actions.ts`) had an early `if (!supabaseConfigured) return { success: false, message: 'This environment is not connected...' }` a few lines *before* the real Build Phase 18 demo-engine branch — so the demo branch could never execute. CSV import never had this duplicate, which is almost certainly the candidate-creation path Dave actually used when he reported "candidate creation works." Fixed by removing the dead early return.
2. **Static prerendering froze the demo engine's state at build time.** Every page that reads `lib/demo/engine.ts`'s mutable in-memory state, but has no other reason to opt out of Next.js's static optimizer (no `cookies()`/auth call, since the demo path skips auth), was being *statically prerendered once at `next build` time* and served as a frozen snapshot forever under `next start` — three of these (`/candidates/[candidateId]`, `/projects/[projectId]`, `/projects/[projectId]/scorecard`) were even pinned to only the original seed IDs via `generateStaticParams`. This is invisible in `next dev` (which never statically optimizes) and invisible to Vitest (which never runs a production build) — it only shows up against a real `next start` server, which is exactly how a deployed demo runs. Fixed by adding `export const dynamic = 'force-dynamic'` to all 13 demo-reading pages and removing the three `generateStaticParams` exports.
3. **The client Router Cache served stale data after a reset.** Even with every page forced dynamic, revisiting a page within Next 16's default 30-second `staleTimes.dynamic` window after a server action changed its data (e.g. clicking back into the shortlist workspace right after "Reset demo data") could still show the pre-change client-cached view. Fixed by setting `experimental.staleTimes.dynamic = 0` in `next.config.ts`, so every navigation to one of these live-state pages re-fetches.

A fourth issue was in the test harness, not the app: Playwright auto-dismisses native `window.confirm()` dialogs unless a handler explicitly accepts one, so the E2E suite's own "Reset demo data" clicks were silently no-ops until `page.once('dialog', d => d.accept())` was added.

## Related documents

`docs/client-feedback-reproduction-report.md` · `docs/build-phase-18-client-feedback-repair-report.md` · `docs/client-demo-retest-guide.md` · `docs/project-workflow-state-machine.md` · `docs/private-client-demo-guide.md` · `docs/demo-script.md` · `docs/post-demo-conversion-plan.md` · `docs/final-release-report.md` · `docs/build-phase-17a-staging-verification-report.md`
