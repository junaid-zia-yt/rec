# Testing guide

Three layers, matching `docs/16-testing-strategy.md`'s Build-Phase-1-relevant
scope: unit/component tests (Vitest + Testing Library), and one end-to-end
smoke test (Playwright). There is no integration test layer yet — nothing
in this phase talks to a real backend to integrate with.

## Unit / component tests (Vitest)

Config: `apps/web/vitest.config.ts` (jsdom environment, `@rqi/testing`'s
setup file for jest-dom matchers, `globals: true` so `describe`/`it`/`expect`
don't need importing... except this repo imports them explicitly anyway,
for clarity and so `pnpm typecheck` doesn't need to trust ambient globals
alone).

Run with `pnpm test` (root) or `pnpm --filter web test` / `pnpm --filter web
test:watch`.

**What's covered today** (`apps/web/**/*.test.{ts,tsx}`):

| File                                                                           | Covers                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/domain/app-shell.test.tsx`                                         | Shell renders header + both nav landmarks + page content                                                                                                                                                                                                                                                                                                                                                             |
| `components/domain/desktop-nav-rail.test.tsx`                                  | All 9 destinations render in order; active-route `aria-current`                                                                                                                                                                                                                                                                                                                                                      |
| `components/domain/mobile-bottom-nav.test.tsx`                                 | Exactly 5 destinations; active state; 48px touch-target class on every link                                                                                                                                                                                                                                                                                                                                          |
| `components/ui/button.test.tsx`                                                | `@rqi/ui`'s `Button`/`IconButton` — click handling, loading/disabled state, required accessible label                                                                                                                                                                                                                                                                                                                |
| `app/(app)/dashboard/dashboard-content.test.tsx`                               | Dashboard renders the 4 required summary metrics (scoped per-card, since two mock values collide) and a card per active project                                                                                                                                                                                                                                                                                      |
| `app/(app)/dashboard/loading.test.tsx`                                         | Loading skeleton exposes an accessible loading status                                                                                                                                                                                                                                                                                                                                                                |
| `app/(app)/outreach/page.test.tsx`                                             | The genuine (non-fabricated) empty state                                                                                                                                                                                                                                                                                                                                                                             |
| `app/(app)/candidates/[candidateId]/page.test.tsx`                             | A candidate with no evidence renders "unverified," never invented evidence; a candidate with evidence renders it with its source and status                                                                                                                                                                                                                                                                          |
| `lib/env.test.ts`                                                              | Env validation never crashes with missing optional credentials; `demoMode`/`supabaseConfigured`/`supabaseAdminConfigured` reflect what's actually configured                                                                                                                                                                                                                                                         |
| `lib/auth/membership.test.ts`                                                  | Default-org resolution never guesses between two orgs; cross-tenant lookups return null/throw; the cross-tenant error message never confirms a resource exists                                                                                                                                                                                                                                                       |
| `lib/auth/permissions.test.ts`                                                 | The full docs/06-roles-permissions.md §6.2 matrix as executable assertions — e.g. a client decision maker can approve/read shortlists but never create/delete them                                                                                                                                                                                                                                                   |
| `lib/auth/routing.test.ts`                                                     | Every app route is protected by default (allowlist, not a denylist); `sanitizeRedirectPath` rejects protocol-relative, absolute, and `javascript:` redirect targets                                                                                                                                                                                                                                                  |
| `lib/auth/role-drift.test.ts`                                                  | `@rqi/types`' `UserRole` Zod enum and `permissions.ts`'s standalone `Role` union can never silently drift apart                                                                                                                                                                                                                                                                                                      |
| `lib/audit/log.test.ts`                                                        | An audit-log failure never throws (never blocks the action it records); the insert is shaped correctly                                                                                                                                                                                                                                                                                                               |
| `components/domain/auth/sign-in-form.test.tsx`                                 | A failed sign-in shows one generic message, never one that confirms whether the email is registered                                                                                                                                                                                                                                                                                                                  |
| `components/domain/auth/forgot-password-form.test.tsx`                         | Same generic "sent if it exists" message regardless of input; the form is hidden after submission so it can't be resubmitted to probe                                                                                                                                                                                                                                                                                |
| `app/(auth)/forgot-password/page.test.tsx`, `.../reset-password/page.test.tsx` | Render an honest "not configured" state instead of a broken form when Supabase isn't set up (the default in this environment)                                                                                                                                                                                                                                                                                        |
| `app/unauthorized/page.test.tsx`                                               | The generic access-denied message never describes what would have been visible                                                                                                                                                                                                                                                                                                                                       |
| `app/(app)/settings/team/page.test.tsx`                                        | Renders demo team members/invitations; never shows a live invite form when Supabase isn't configured                                                                                                                                                                                                                                                                                                                 |
| `lib/files/validate.test.ts`                                                   | File-security allow-list: accepts PDF/DOCX, rejects empty/oversized/wrong-format/executable/extension-MIME-mismatch files; storage-path builder never leaks a traversal segment and is never guessable from ids alone                                                                                                                                                                                                |
| `lib/auth/project-scope.test.ts`                                               | Row-level project access: agency_admin/read_only_reviewer org-wide, recruiter assigned-projects-only, client_decision_maker own-client-only, denial is a "not found" message never "forbidden"                                                                                                                                                                                                                       |
| `components/domain/clients/clients-list.test.tsx`                              | Client search/filter narrows by name and vertical; distinct empty states for "no clients yet" vs. "no matches"                                                                                                                                                                                                                                                                                                       |
| `components/domain/projects/job-description-form.test.tsx`                     | Paste/upload mode toggle; paste calls the paste action only (never upload); a file-rejection message from the server action is shown verbatim, never silently swallowed                                                                                                                                                                                                                                              |
| `lib/ai/provider.test.ts`                                                      | Structured-output validation: accepts a well-formed extraction, rejects out-of-range confidence, an unsupported requirement type, a missing `sourceText`, >60 requirements, and a non-object payload                                                                                                                                                                                                                 |
| `lib/ai/prompt.test.ts`                                                        | The system prompt states every Build Phase 4 brief rule verbatim-in-spirit (data not instructions, never invent, quote source text, mark ambiguous, separate mandatory/preferred, never decide); the document delimiter cannot be forged closed by hostile document content                                                                                                                                          |
| `lib/ai/extract-requirements.test.ts`                                          | `not_configured` short-circuits with no provider call (this environment has no Anthropic key); success; a **prompt-injection fixture** (instruction-shaped lines in the document produce zero requirements, never a fake approval); retry-once-then-`rejected_by_validation`; recovery on retry; timeout/provider-error report `error`, never retried, with a safe message; prompt version recorded on every outcome |
| `lib/scoring/validate-weights.test.ts`                                         | Score-weight validation: unweighted types with a weight rejected, preferred-with-no-weight rejected, totals ≠100% rejected (both under and over), a 0.01 floating-point tolerance, zero-preferred is valid                                                                                                                                                                                                           |
| `lib/scoring/scorecard-versions.test.ts`                                       | Version numbering; **version immutability** at the application layer (`requiresNewDraftVersion` — active/superseded always force a new draft); the approval gate refuses an already-active/superseded version, zero requirements, or invalid weights, and collects every reason at once                                                                                                                              |
| `lib/scorecards/approval-permission.test.ts`                                   | **Approval permission tests**: agency/platform admin always allowed; recruiter and read-only reviewer never allowed; client decision-maker refused by default even for their own client until the project's opt-in flag is set; **tenant isolation** — a client reviewer from a different client is refused even with the flag on, and a reviewer with no client on their membership is refused                      |
| `lib/requirements/edit-rules.test.ts`                                          | **Human-edit preservation**: an AI-proposed, unreviewed requirement becomes `reviewed` on edit; an already-reviewed one stays `reviewed`; a manually-added one is untouched; the function's signature makes it structurally impossible for an edit to rewrite `ai_generated`                                                                                                                                         |

None of these assert `true === true` — each one exercises a real
requirement (navigation correctness, accessibility, the "AI must never
invent evidence" principle applied to the UI's empty states, environment-
validation robustness, and — new in Build Phase 2 — that authorization
decisions match the approved permission matrix and that every auth-related
error message is safely generic).

### Adding a test

Import from `@rqi/testing` (`render`, `screen`, `within`, `userEvent`), not
directly from `@testing-library/react` — that's the one place the setup is
centralized. Mock `next/navigation`'s `usePathname` when testing anything
that renders `DesktopNavRail`/`MobileBottomNav` (both are client
components that call it).

## End-to-end smoke test (Playwright)

Config: `apps/web/playwright.config.ts`. Runs against a **production
build** (`next start`), not the dev server, so it also incidentally
verifies the production build actually works.

```bash
pnpm build            # once, or Playwright's webServer will build implicitly if configured to
pnpm test:e2e
```

`apps/web/e2e/smoke.spec.ts` covers exactly the 6 steps required by the
Build Phase 1 brief: open the dashboard, verify the shell renders,
navigate to Projects, navigate to Candidates, switch to a mobile viewport
(iPhone 13 device profile), verify the mobile bottom nav and that it
navigates.

`apps/web/e2e/auth.spec.ts` (Build Phase 2) verifies the _unconfigured_
state is honest end-to-end, since no live Supabase project is connected in
this environment: `apps/web/proxy.ts` reports `x-rqi-auth-enforced: false`
on every response, sign-in/forgot-password/reset-password each render their
"not configured" card instead of a form, `/unauthorized` shows a generic
message, and `/settings/team` lists the demo members while stating that
inviting requires Supabase. This intentionally does **not** exercise a real
sign-in/sign-out/RLS flow — there is no live project to sign in against; see
`docs/build-phase-2-report.md` for what remains to be verified once one is
connected.

`apps/web/e2e/recruitment-projects.spec.ts` (Build Phase 3) is the same
honest-demo-mode pattern applied to client/project/job screens: the Clients
list renders and its search narrows results, the Projects list links to
Clients and a project opens to show its Jobs section and an Activity link,
the job-description screen shows the demo pasted version, and Clients is
reachable from the mobile More screen. Live RLS-scoped list/detail queries
(`loadClients`/`loadProjects`/`loadProject` in their respective pages) are
code-complete and unit-covered at the permission-decision layer
(`lib/auth/project-scope.test.ts`) but, like every live-database path in
this repo, have never run against a real Supabase project here — see
`docs/build-phase-3-report.md`.

This container ships a pre-installed Chromium that may not match
`@playwright/test`'s expected browser build; `playwright.config.ts` detects
`/opt/pw-browsers/chromium` and launches it directly when present, falling
back to Playwright's normal browser resolution (`pnpm exec playwright
install`) everywhere else, including CI.

## What's intentionally not tested yet

Visual/pixel regression testing, cross-browser testing (only Chromium is
configured), and anything requiring a real backend (Supabase, Claude API)
are all out of scope until those integrations exist — see
`docs/19-mvp-scope.md`. Manual visual verification against the Stitch
reference at the 5 required breakpoints (1440/1024/768/390/360px) was done
for Build Phase 1 and is recorded in `docs/build-phase-1-report.md`, but is
not (yet) automated as a screenshot-diff test.
