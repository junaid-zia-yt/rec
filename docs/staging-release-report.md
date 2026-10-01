# Staging Release Report

Build Phase 15 (Staging Deployment Preparation) — final synthesis document,
Wave 5 of 5. This report ties together the outputs of Waves 1–4
(`docs/rollback-runbook.md`, `docs/staging-deployment.md`,
`docs/monitoring-runbook.md`, `docs/uat-plan.md`,
`docs/uat-results-template.md`) into a single readiness statement for
whoever picks this up next with real cloud credentials.

---

## 1. Executive summary

Staging deployment **preparation** for Recruitment Quality Intelligence is
complete: the CI/CD pipeline, rollback procedure, staging-only app-layer
safeguards, Sentry monitoring wiring, and a full UAT plan are all
code-complete, internally consistent, and verified as far as a credential-less
sandbox allows. **No live staging deployment exists.** This report is a
readiness statement — confirmation that the pieces are built and locally
sound — not a claim that staging has been deployed, migrated, or tested
live, because none of that has happened.

## 2. Mandatory Completion Gate — explicit non-claim of staging success

This section exists specifically to prevent this report, or anything built
in this phase, from being misread as "staging is live and working."

- **This sandbox has no cloud provider accounts or credentials of any
  kind.** Specifically absent: a Vercel account/token, a Supabase staging
  project (or any Supabase project), a Sentry DSN, a Resend sending domain,
  and a live Anthropic API key. Nothing in this environment can reach any
  of those services.
- **No deployment to any staging URL has occurred.** `staging-deploy.yml`
  has never been triggered against a real GitHub Actions run with real
  secrets. There is no staging URL to visit.
- **No migration has been run against a real staging Supabase project.**
  The migration set has been executed — successfully — but only against a
  throwaway `postgres:16` service container inside `migration-validation.yml`,
  which stubs `auth.*`/`storage.*` locally. That is a real, genuine local
  verification of the SQL itself; it is not a run against Supabase
  infrastructure, and it does not exercise Supabase-specific behavior (RLS
  enforcement via real `auth.uid()`, actual Storage buckets, etc.).
- **No browser or API test has been run against a live deployed
  environment.** Every "expected" outcome in `docs/uat-plan.md` is a
  prediction grounded in reading the actual application code, not an
  observed result. No screen has been opened in a browser against a
  deployed build in this phase.
- **Per the user's own explicit instruction for this phase, staging success
  is not being claimed anywhere in this document or elsewhere in this
  phase's output.**
- **What IS true, and is the actual deliverable of this phase:** the
  pipeline (two validated GitHub Actions workflows), the rollback
  procedure, the staging-only app-layer safeguards (banner, Basic Auth
  gate, storage bucket separation, AI cost guardrails), the monitoring
  wiring (9 failure surfaces through a shared, PII-safe capture helper),
  the synthetic seed script, and the UAT plan are all code-complete and
  locally verified. This is a **"supply your own infrastructure credentials
  and trigger the workflow" operation**, not a "some assembly still
  required from scratch" one. The remaining work is credential
  provisioning and a live human verification pass — described in §5 below
  — not further engineering.

## 3. What was built, by wave

**Wave 1 — CI/CD pipeline, rollback procedure, staging-only seed data.**
Added `.github/workflows/staging-deploy.yml` (manual `workflow_dispatch`
only, never on push — deliberate per the approval brief), which calls the
existing `ci.yml` via `workflow_call` before deploying, validates all
required secrets up front and names any that are missing, runs
`supabase db push` against the staging project ref, deploys to Vercel's
Preview environment via the CLI (`vercel deploy --prebuilt --prod=false`,
never overwriting a prior deployment), and optionally runs the seed script.
Added `.github/workflows/migration-validation.yml`, which rebuilds the full
migration set against a real local Postgres container and runs the
`verify_candidates.sql` regression suite. Added `apps/web/scripts/seed-staging.ts`
(synthetic-only, guarded by `ALLOW_STAGING_SEED=true`, non-idempotent by
design, and deliberately silent on `matching_runs` /
`candidate_role_matches` / `mandatory_gate_results` so scoring data is
never hand-faked). Added `docs/rollback-runbook.md` and the
`NEXT_PUBLIC_BUILD_SHA` / `NEXT_PUBLIC_RELEASE_TAG` build-identity plumbing
in `apps/web/lib/env.ts`.

**Wave 2 — Staging app-layer configuration.** Added the non-production
banner (reads `NEXT_PUBLIC_ENVIRONMENT_NAME`), the HTTP Basic Auth gate in
`proxy.ts` (reads `STAGING_BASIC_AUTH_USER`/`PASSWORD`, a coarse perimeter
gate sitting in front of, never replacing, real Supabase-Auth sign-in),
the `SUPABASE_STORAGE_BUCKET` override so staging documents can never
collide with a production bucket, and the `COPILOT_DAILY_MESSAGE_LIMIT` /
`COPILOT_DAILY_COST_LIMIT_USD` overrides for bounding AI spend during UAT.
All are additive, optional env vars in `apps/web/lib/env.ts` with the
existing never-crash-when-unset convention. `docs/staging-deployment.md`
was written/extended to document the full setup procedure end to end.

**Wave 3 — Monitoring.** Wired `@sentry/nextjs` across
`instrumentation.ts`, `instrumentation-client.ts`, `sentry.server.config.ts`,
`sentry.edge.config.ts`, and `next.config.ts` (`withSentryConfig`), all
gated on `sentryConfigured` (true only once `SENTRY_DSN`/
`NEXT_PUBLIC_SENTRY_DSN` is set — false everywhere today). Added the shared
`apps/web/lib/monitoring/capture.ts` helper
(`captureError`/`captureMonitoringMessage`/`captureBusinessMetric`) used by
every wired call site, tagging events by category and organization,
never sending candidate PII, document text, or full request/response
bodies. Added `app/error.tsx` / `app/global-error.tsx` App Router error
boundaries. Documented all 9 wired failure surfaces (application, API,
background job, AI provider, AI cost, auth, integration, performance,
audit-event) in `docs/monitoring-runbook.md`, including first-response
guidance for each.

**Wave 4 — UAT materials.** Wrote `docs/uat-plan.md` (67 steps across five
role scripts — agency admin, recruiter, client decision-maker, read-only
reviewer, plus a combined two-role POC journey — every screen/route/role
claim grounded directly in `packages/types/src/permissions.ts`,
`docs/03-screen-inventory.md`, and the actual seed script) and
`docs/uat-results-template.md` (a fill-in-the-blanks results tracker
mirroring the plan's step numbering, ready to be duplicated per UAT
round).

## 4. Required secrets/credentials for the user to supply

Full list, sourced from `staging-deploy.yml`'s header comment.

**GitHub Actions repository secrets** (`validate-secrets` job fails fast
and names any missing required secret):

| Secret                              | Required? | Purpose                                              |
| ----------------------------------- | --------- | ---------------------------------------------------- |
| `VERCEL_TOKEN`                      | Required  | Vercel CLI auth                                      |
| `VERCEL_ORG_ID`                     | Required  | Vercel team/org id                                   |
| `VERCEL_PROJECT_ID`                 | Required  | the **staging** Vercel project's id                  |
| `SUPABASE_STAGING_PROJECT_REF`      | Required  | staging Supabase project ref                         |
| `SUPABASE_STAGING_DB_PASSWORD`      | Required  | staging project's Postgres password                  |
| `SUPABASE_STAGING_ACCESS_TOKEN`     | Required  | Supabase CLI auth (personal access token)            |
| `STAGING_SUPABASE_URL`              | Required  | staging project URL, for the seed step only          |
| `STAGING_SUPABASE_SERVICE_ROLE_KEY` | Required  | staging service role key, for the seed step only     |
| `STAGING_ANTHROPIC_API_KEY`         | Required  | staging-scoped Anthropic key for CI's own use        |
| `STAGING_APP_URL`                   | Required  | staging deployment's public URL                      |
| `STAGING_RESEND_API_KEY`            | Optional  | unset = outreach email runs in safe/dev-adapter mode |
| `STAGING_SENTRY_DSN`                | Optional  | unset = no error tracking, a logged warning only     |

**Directly on the staging Vercel project** (Project Settings → Environment
Variables → Preview; not pushed by CI — see `docs/staging-deployment.md`
§3 for why):

| Variable                                                                                                                    | Required?                                     |
| --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`             | Required                                      |
| `ANTHROPIC_API_KEY`                                                                                                         | Required (else AI features silently no-op)    |
| `RESEND_API_KEY`                                                                                                            | Optional (safe-mode fallback exists)          |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`                                                                                     | Optional                                      |
| `NEXT_PUBLIC_ENVIRONMENT_NAME=staging`                                                                                      | Recommended (shows the non-production banner) |
| `STAGING_BASIC_AUTH_USER` / `STAGING_BASIC_AUTH_PASSWORD`                                                                   | Recommended                                   |
| `SUPABASE_STORAGE_BUCKET`                                                                                                   | Recommended                                   |
| `COPILOT_DAILY_MESSAGE_LIMIT` / `COPILOT_DAILY_COST_LIMIT_USD`                                                              | Optional                                      |
| `NOTIFICATIONS_FROM_EMAIL`, `APOLLO_API_KEY`, `GOOGLE_CALENDAR_CLIENT_ID`/`SECRET`, `MICROSOFT_CALENDAR_CLIENT_ID`/`SECRET` | Optional                                      |

`NEXT_PUBLIC_BUILD_SHA` / `NEXT_PUBLIC_RELEASE_TAG` should **not** be set
manually — `staging-deploy.yml` injects them at build time.

## 5. Deployment runbook — what the user needs to do to actually go live

1. **Create the staging Supabase project** (`docs/staging-deployment.md`
   §1) — a project dedicated to staging, never a repurposed production
   project. Capture project ref, DB password, project URL, anon key,
   service role key, and a personal access token; create a private storage
   bucket (e.g. `rqi-staging-documents`).
2. **Apply migrations to it** — either let `staging-deploy.yml`'s
   `migrate-staging` job do this automatically (`supabase db push`) on
   first run, or run it manually once. Confirm tables exist in the
   Supabase Table Editor afterward.
3. **Create the staging Vercel project** (§2 of the deployment guide) —
   again dedicated, never shared with a future production project — and
   set every environment variable in §4 above on it.
4. **Set the GitHub Actions repository secrets** listed in §4 above.
5. **Trigger `staging-deploy.yml` via `workflow_dispatch`** from the
   Actions tab. Leave `run_seed` unchecked on routine re-deploys (the seed
   script is not idempotent); check it only for the first deploy.
6. **Verify the deployment manually, in a real browser** — this step
   cannot be automated or skipped. At minimum:
   - Open the deployed URL; confirm the Basic Auth prompt (if configured)
     and the non-production banner (with a build SHA matching the
     workflow's job summary) both appear.
   - Sign in with a seeded account and confirm a real, populated
     dashboard loads — not a "not configured" placeholder.
   - Open a seeded candidate, project, and (if seeded) shortlist and
     confirm the UI actually renders real data, not just that CI reported
     the seed script exited 0.
   - If `ANTHROPIC_API_KEY` is set: send one real copilot message and
     confirm a genuine model response comes back.
   - If a Resend key is set: send one real outreach message to a test
     address you control and confirm delivery.
   - Confirm `x-rqi-auth-enforced: true` appears on a response header via
     browser devtools once Supabase is configured.
7. **Optionally run the seed script** (`run_seed: true` on that
   `workflow_dispatch` run, or manually with `ALLOW_STAGING_SEED=true`) to
   populate the four demo accounts, one client, one project, and seven
   candidate fixtures.
8. **Execute the UAT plan** (`docs/uat-plan.md`) against the now-live,
   seeded deployment, recording results in a dated copy of
   `docs/uat-results-template.md`.

## 6. Verification performed in this sandbox (what CAN be claimed)

- **Typecheck, lint, unit tests**: clean, via the existing `ci.yml` job
  (`pnpm typecheck` / `pnpm lint` / the full existing test suite), which
  `staging-deploy.yml` calls via `workflow_call` before any deploy step
  runs, so a red build can never reach a deploy attempt.
- **Two new GitHub Actions workflows** (`staging-deploy.yml`,
  `migration-validation.yml`) were validated against GitHub's official
  workflow schema and with `actionlint`. Neither has ever actually
  executed as a GitHub Actions run with real secrets.
- **Migration-validation logic was actually executed** against a real
  local `postgres:16` instance (in this session's local verification, and
  as the `rebuild-and-verify` job's exact steps): every migration from
  `0001` through the current max applied cleanly against Supabase-auth/
  storage stub tables, and the full `verify_candidates.sql` regression
  suite passed with zero `pass=f` rows.
- **Environment-variable completeness**: `scripts/check-env-completeness.mjs`
  (run as part of `ci.yml`) confirms `apps/web/lib/env.ts`'s schema and
  `.env.example` stay in sync — every var referenced in this report is a
  real, currently-defined var, not an invented name.
- **Migration filename sequencing**: `scripts/check-migration-sequence.mjs`
  confirms the migration set is strictly sequential with no gaps or
  duplicates.
- **Sentry SDK wiring** was checked against the exact `@sentry/nextjs`
  version pinned in `apps/web/package.json` (its own `build/types`/
  `package.json`, not assumed from training data) and is exercised by this
  repo's automated tests with the SDK mocked. No event has ever reached a
  real Sentry project, because none exists.
- **Nothing above constitutes a live deployment test.** No code in this
  phase has been executed against real Vercel, Supabase, Sentry, Resend,
  or Anthropic infrastructure.

## 7. Known limitations / residual risk

Carried forward from `docs/uat-plan.md` §8 (already-disclosed, not new UAT
bugs once a live round runs):

1. Uploaded JD file (PDF/DOCX) text extraction is not wired — only the
   paste-JD path reaches requirement extraction.
2. TA Tracker integration is permanently stubbed by deliberate scope
   decision (the project brief explicitly forbids inventing a TA Tracker
   API).
3. Live AI/Resend/Apollo credentials may or may not be configured on any
   given staging deployment, depending on what the deployer set up — check
   before reporting these as broken.
4. Freshly-seeded candidates have no gate/score data until a recruiter
   runs matching — the seed script deliberately does not hand-write
   scoring tables.
5. No dedicated "decision history" screen for shortlists yet (history is
   readable via underlying records only).
6. `CandidateProfileScreen` on mobile is a stub, outside Build Phase 13's
   explicit scope.
7. No real device/browser/assistive-technology testing has ever been done
   on this build — the accessibility work to date is static/code-level
   only.
8. Cross-tenant isolation cannot be tested against the current seed data —
   only one organization exists in the staging seed.

Staging-specific additions:

- **HTTP Basic Auth is a coarse perimeter gate, not authentication.** It
  keeps search engines and casual visitors off a staging URL; every
  protected route still requires a real Supabase-Auth session underneath
  it, and a Basic-Auth-only visitor with no Supabase account sees no
  tenant data. Do not treat passing the Basic Auth prompt as equivalent to
  being signed in.
- **The seed script writes no scoring/gate data by design** (see §6 above
  and item 4) — this is a deliberate guarantee-preserving choice, not an
  oversight, but it means a fresh staging environment looks "empty" of
  scores until a recruiter actually runs the matching pipeline.
- **Postgres migrations are additive-only by convention, not
  automatically reversible** — there is no per-migration `down.sql`. A bad
  migration is corrected with a new forward migration, not a rollback
  script (`docs/rollback-runbook.md` §3).
- **No production environment exists**, so the "never copy production
  candidate data into staging without approved anonymization" constraint
  is currently satisfied by construction (there is nothing to copy) —
  this document should be revisited once a real production environment
  with real candidate data exists, before anyone seeds staging from it.

## 8. Sign-off status

**This document does not constitute staging sign-off.** Declaring staging
"live" and "working" requires, at minimum: real infrastructure
provisioned per §5 above, a successful `staging-deploy.yml` run against
that infrastructure, and a human completing the browser/API verification
checklist in §5 step 6 against the actually-deployed URL. None of that has
happened in this sandbox. What this phase delivers is a complete,
locally-verified, credential-fill-in-and-run pipeline and a ready UAT plan
— the remaining steps are the user's own infrastructure actions and a live
verification pass, not further code.

---

Related documents: [[rollback-runbook]] · [[staging-deployment]] ·
[[monitoring-runbook]] · [[uat-plan]] · [[uat-results-template]] ·
[[release-readiness]]
