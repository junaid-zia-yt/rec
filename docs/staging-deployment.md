# Staging Deployment Guide

Build Phase 15 (Staging Deployment Preparation), Waves 1 + 2. **This document
describes a procedure that has NOT been executed in this development
environment.** No Vercel account, no Supabase project (staging or
production), and no Anthropic/Resend/Sentry credentials of any kind exist in
the sandbox this was written in. Every command, workflow, and env var name
below is genuine and cross-checked against the actual code in this repo
(`.github/workflows/staging-deploy.yml`, `apps/web/lib/env.ts`,
`.env.example`) — but none of it has been run against a real cloud account.
Follow it as a checklist, not a report of something already done.

This guide is written for whoever has (or will create) the real Supabase,
Vercel, Resend, Anthropic and GitHub accounts this needs. It assumes you can
already push to this repository and have (or can get) admin/owner access on
each cloud account below.

**On staging data**: this project's brief says "never copy production
candidate data into staging without approved anonymization." There is no
production environment and no production data anywhere in this project —
nothing exists to copy. That rule is satisfied by construction today; it
becomes relevant only once a real production deployment with real candidate
data exists, at which point this document should be revisited before anyone
considers seeding staging from it. Until then, staging is seeded exclusively
from `apps/web/scripts/seed-staging.ts`'s synthetic fixture data (Wave 1) —
never from a database export or dump of anything real.

## 1. Create the staging Supabase project

1. In the Supabase dashboard, create a **new project** dedicated to staging
   — never reuse or repurpose a project that might later become production.
   A clear name like `rqi-staging` avoids ambiguity.
2. Note the project's **project ref**, **Postgres password** (set at
   creation), **project URL**, **anon key**, and **service role key** (Project
   Settings → API). You'll need all five below.
3. Create a **Supabase personal access token** (Account → Access Tokens) for
   the CLI to authenticate as in CI — this is a different credential from
   the project's own keys.
4. Create a **private Storage bucket** for staging documents. Use a name
   distinct from any hypothetical production bucket, e.g.
   `rqi-staging-documents` — see §4 below for why, and set
   `SUPABASE_STORAGE_BUCKET` to this exact name in §3.
5. Apply the schema by running the **`Migration Validation`** workflow's
   logic against this project once manually (or simply trigger a
   `staging-deploy` run per §6 below — its `migrate-staging` job does this
   automatically via `supabase db push`, gated on
   `SUPABASE_STAGING_PROJECT_REF`). Either way, confirm in the Supabase
   dashboard's Table Editor that the expected tables exist before moving on.
6. (Recommended, not required to start) Enable **Point-in-Time Recovery**
   in the project's billing/add-ons settings if you want that safety net —
   see `docs/rollback-runbook.md` §3.2 for what it does and doesn't cover.
   It cannot be turned on retroactively after data loss, so decide this
   before staging carries data anyone would miss.

## 2. Create the staging Vercel project

1. In Vercel, create a **new project** connected to this repository —
   again, dedicated to staging, never the same project a future production
   deployment would use (`.github/workflows/staging-deploy.yml`'s own
   header comment is explicit about why: `deploy-vercel` always deploys to
   this project's **Preview** environment, and that separation is only
   real if the project itself is staging-only).
2. Note the **Vercel org/team ID** and this **project's ID** (Project
   Settings → General, or `vercel project ls` with the CLI) — these become
   two of the GitHub Actions secrets in §5.
3. Generate a **Vercel access token** (Account Settings → Tokens) for CI —
   this becomes `VERCEL_TOKEN`.
4. If you have a domain for staging (e.g. `staging-rqi.example.com`), add it
   to this Vercel project (Project Settings → Domains) now, so the
   `staging-deploy.yml` workflow's alias step can attach a deployment to it
   later. If you don't have one yet, skip this — the workflow falls back to
   Vercel's own ephemeral per-deployment URL and tells you so in its log.

## 3. Set the staging Vercel project's environment variables

These are configured **directly in the Vercel dashboard** (Project Settings
→ Environment Variables → Preview), not pushed by CI — `staging-deploy.yml`
explicitly does not do this (see that workflow's header comment for why:
there's no Vercel API well-suited to "set this secret" without re-exposing
it in workflow logs). Set every variable below that this repo's
`.env.example` lists, so the two lists never drift:

| Vercel env var                                                                                  | Value for staging                                                     | Required?                                                                                                                          |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_APP_URL`                                                                           | your staging URL (e.g. `https://staging-rqi.example.com`)             | yes                                                                                                                                |
| `NEXT_PUBLIC_SUPABASE_URL`                                                                      | staging project URL (§1)                                              | yes                                                                                                                                |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`                                                                 | staging anon key (§1)                                                 | yes                                                                                                                                |
| `SUPABASE_SERVICE_ROLE_KEY`                                                                     | staging service role key (§1)                                         | yes                                                                                                                                |
| `ANTHROPIC_API_KEY`                                                                             | a staging-scoped Anthropic API key                                    | yes — without this, staging silently runs in AI-not-configured mode, which defeats the point of validating AI workflows on staging |
| `RESEND_API_KEY`                                                                                | a staging-scoped Resend API key, **or leave blank**                   | optional — see §5 for the safe-mode fallback                                                                                       |
| `SENTRY_DSN`                                                                                    | a staging-scoped Sentry DSN                                           | optional — see §6, Wave 3 owns wiring this up further                                                                              |
| `NEXT_PUBLIC_ENVIRONMENT_NAME`                                                                  | `staging`                                                             | recommended — shows the non-production banner (Wave 2)                                                                             |
| `STAGING_BASIC_AUTH_USER` / `STAGING_BASIC_AUTH_PASSWORD`                                       | your choice of shared credentials                                     | recommended — see §7                                                                                                               |
| `SUPABASE_STORAGE_BUCKET`                                                                       | your staging bucket name (§1), e.g. `rqi-staging-documents`           | recommended                                                                                                                        |
| `COPILOT_DAILY_MESSAGE_LIMIT` / `COPILOT_DAILY_COST_LIMIT_USD`                                  | a lower value than the defaults (200 / 5), your call                  | optional — see §8                                                                                                                  |
| `NOTIFICATIONS_FROM_EMAIL`                                                                      | a placeholder or staging "from" address                               | optional                                                                                                                           |
| `APOLLO_API_KEY`, `GOOGLE_CALENDAR_CLIENT_ID`/`SECRET`, `MICROSOFT_CALENDAR_CLIENT_ID`/`SECRET` | staging-scoped credentials if you want to exercise these integrations | optional                                                                                                                           |

Do **not** set `NEXT_PUBLIC_BUILD_SHA` / `NEXT_PUBLIC_RELEASE_TAG` here — the
`staging-deploy.yml` workflow injects those two itself at build time (§6);
setting them manually on the Vercel project would just be overwritten.

## 4. Storage

`lib/files/storage.ts` reads its bucket name from the `SUPABASE_STORAGE_BUCKET`
env var (Wave 2), defaulting to `documents` when unset. Set it explicitly on
the staging Vercel project to a name distinct from whatever a future
production bucket would be named (e.g. `rqi-staging-documents` vs.
`rqi-production-documents`), so seeded staging CVs/job descriptions can
never collide with production files even if both projects somehow shared an
underlying Supabase instance (they shouldn't — see §1 — but the naming
convention is cheap insurance regardless). The bucket itself must be created
in the staging Supabase project's Storage tab before first use (§1 step 4);
setting the env var alone does not create it.

## 5. Email: staging Resend domain, or safe mode

`lib/outreach/channels/email.ts` already has a safe-mode fallback: when
`RESEND_API_KEY` is unset, `getEmailChannelAdapter()` selects a
`DevelopmentEmailAdapter` that never makes a network call and always returns
`simulated: true`, logging what it would have sent server-side only. This
means **you can stand up staging today with zero email configuration** and
every outreach-send code path will behave correctly (nothing bounces,
nothing goes to a real inbox) — it just won't demonstrate real delivery.

If you want staging to demonstrate real delivery without risking mail to
real candidate addresses:

- The clean option is a **dedicated staging sending domain** in Resend
  (e.g. `staging.yourdomain.com`), verified via the DNS records Resend's
  dashboard provides, with `RESEND_API_KEY` set to a key scoped to that
  domain. This is a real, separate Resend setup from any future production
  domain — not a flag on the same domain.
- Resend also supports **test-mode API keys** scoped to their sandbox
  sending domain (`onboarding@resend.dev` and similar), which accept sends
  without configuring your own DNS. This is the faster path to "see a real
  Resend API round-trip work" without owning a verified domain yet. Either
  a real staging domain key or a Resend test-mode key drops into
  `RESEND_API_KEY` identically — `lib/outreach/channels/email.ts` doesn't
  need to know which kind of key it has, since both are "configured" from
  its point of view.
- There is currently no separate "redirect all staging mail to one test
  inbox" mode wired into this codebase beyond what's described above. If
  that's wanted later (routing every send to one address regardless of
  the real recipient, for UAT), it's a small additive change to
  `ResendEmailAdapter.send()` gated on a new env var — flagged here as a
  Medium-priority follow-up, not built in this wave since a Resend
  test-mode key already covers the "don't email real people" need cleanly.

Either way, no code change is needed to switch between safe mode and a real
Resend account — it's entirely a matter of whether `RESEND_API_KEY` is set
on the Vercel project.

## 6. Monitoring (Sentry) — placeholder, Wave 3 owns this

`SENTRY_DSN` is already read by `lib/env.ts` (`optional`, never crashes when
absent), but no Sentry SDK is initialized anywhere in this codebase yet — no
`sentry.client.config.ts`/`sentry.server.config.ts`, no `@sentry/nextjs`
instrumentation. Setting `SENTRY_DSN` on the staging Vercel project today
does nothing observable; it's listed in §3's table only so the var exists
and is populated by the time Wave 3 wires the actual SDK in, rather than
being a second round-trip through the Vercel dashboard later. Leave it
blank if you'd rather configure it once Wave 3 lands.

## 7. Restricted staging access (Basic Auth)

Set `STAGING_BASIC_AUTH_USER` and `STAGING_BASIC_AUTH_PASSWORD` on the
staging Vercel project (§3) to put the whole deployment behind a shared HTTP
Basic Auth prompt, enforced in `proxy.ts` (Wave 2). Pick credentials, share
them with whoever needs staging access (testers, stakeholders) out of band
(not in this repo), and rotate them the same way if they leak.

**This is deliberately coarse** — it exists only to keep search engines and
random internet visitors off a staging URL that might otherwise be
guessable or linked from a PR. It is not, and is not meant to be, a
replacement for the app's real Supabase-Auth-based sign-in: once a request
passes the Basic Auth prompt, every protected route still requires a real
authenticated session exactly as it does today, and a Basic-Auth-only
visitor with no Supabase account still cannot see any tenant's data.

Leave both variables unset to disable this gate entirely (the default for
local dev, and the state this repo ships in) — it is a strict no-op unless
both are explicitly set.

## 8. AI cost guardrails for UAT

`lib/copilot/orchestration/run-copilot-turn.ts`'s daily rate limit (200
messages / $5 per organization+user+day) now reads its two thresholds from
`COPILOT_DAILY_MESSAGE_LIMIT` / `COPILOT_DAILY_COST_LIMIT_USD` (Wave 2),
falling back to those exact defaults when unset. If staging will have
multiple testers exercising the copilot concurrently during a UAT window,
consider setting both lower (e.g. 40 messages / $1) on the staging Vercel
project only, to bound total AI spend during that window without touching
production's (still-default) values. This is a recommendation, not a
requirement — the existing defaults are safe to leave as-is if UAT traffic
will be light.

## 9. GitHub Actions secrets (for CI/CD itself, not the app)

These are distinct from §3's Vercel-dashboard vars — they're what
`.github/workflows/staging-deploy.yml` needs to authenticate its own CLI
calls (Vercel CLI, Supabase CLI) and run the seed script from the runner.
Set them under **Settings → Secrets and variables → Actions → Repository
secrets**. The workflow's own header comment is the authoritative source for
this list (kept in sync here so you don't have to open both files):

**Required** (the `validate-secrets` job fails fast, naming any that are
missing):

- `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` — from §2
- `SUPABASE_STAGING_PROJECT_REF`, `SUPABASE_STAGING_DB_PASSWORD`,
  `SUPABASE_STAGING_ACCESS_TOKEN` — from §1
- `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_SERVICE_ROLE_KEY` — from §1
  (used only by the seed step in CI; the app itself reads the
  non-`STAGING_`-prefixed versions of these from the Vercel dashboard, §3)
- `STAGING_ANTHROPIC_API_KEY` — a staging-scoped Anthropic key for CI's own
  use (distinct from the `ANTHROPIC_API_KEY` set on the Vercel project in
  §3 — the two can be the same key value if you prefer, but are configured
  in two different places)
- `STAGING_APP_URL` — your staging URL, same value as `NEXT_PUBLIC_APP_URL`
  in §3

**Optional** (a warning is logged, not a failure):

- `STAGING_RESEND_API_KEY` — leave unset to confirm safe-mode behavior; set
  once you've done §5
- `STAGING_SENTRY_DSN` — leave unset until Wave 3

## 10. Running the deploy

1. Push whatever commit you want deployed to this repository (staging
   deploys are `workflow_dispatch`-only — never automatic on push to
   `main`, by design).
2. In GitHub → Actions → **Staging Deploy**, click **Run workflow**. Leave
   `run_seed` **unchecked** on a routine re-deploy — `seed-staging.ts` is
   not idempotent, so enabling it on every run duplicates demo data. Check
   it only on the first deploy, or deliberately when you want fresh seed
   data (after first clearing what's there, per that script's own header).
3. Watch the run. `validate-secrets` fails immediately and names exactly
   what's missing if any required secret above wasn't set — fix that before
   anything else runs.
4. On success, the `summary` job's output (GitHub Actions job summary tab)
   gives you the deployed URL, release tag, and git SHA.

## 11. How do I know it worked?

Separate what CI can verify automatically from what only a human can
confirm — per this project's own rule against claiming an integration works
before it's been configured and tested:

**CI verifies automatically** (a green workflow run means):

- The build succeeded (`run-ci` job — typecheck, lint, unit tests, the full
  existing test suite).
- Migrations applied cleanly to the staging Supabase project without error
  (`migrate-staging` job).
- A deployment was created and Vercel accepted it (`deploy-vercel` job) —
  this confirms the build is _deployed_, not that it _works_ when visited.
- If `run_seed` was checked: the seed script completed without error
  (`seed-staging` job).

**A human must do this — CI cannot check it:**

- [ ] Open the deployed URL in a real browser. If Basic Auth is configured
      (§7), confirm the credential prompt appears and the real credentials work.
- [ ] Confirm the non-production banner is visible at the top of the page
      (if `NEXT_PUBLIC_ENVIRONMENT_NAME=staging` was set) and shows a build
      SHA/release tag that matches this run's summary (§10 step 4) — this is
      also your confirmation that `getBuildInfo()` is wired correctly.
- [ ] Sign in (or sign up, if this is a fresh staging project with no users
      yet) and confirm you land on a real, populated dashboard — not a
      "Supabase not configured" placeholder state.
- [ ] If seeded: click into a job/project, a candidate, and a shortlist and
      confirm the synthetic demo data actually renders (cards, gate badges,
      scores) — a successful CI seed-script run only confirms rows were
      written, not that the UI reads them correctly.
- [ ] If `ANTHROPIC_API_KEY` is configured: open the copilot and send one
      real message, confirming an actual model response comes back (not a
      "not configured" message).
- [ ] If a Resend key is configured (§5): trigger one real outreach send
      and confirm it arrives (to a test address you control, never a real
      candidate) — do not consider Resend "working" from configuration alone.
- [ ] Confirm `x-rqi-auth-enforced: true` is present on a response header
      (e.g. via browser devtools' Network tab) once Supabase is configured —
      this is `proxy.ts`'s own verifiable confirmation that auth is actually
      being enforced, not just assumed.

None of the checklist above has been performed as part of writing this
document — there is no staging deployment yet to check. This section exists
so that whoever runs the workflow for the first time has a concrete,
honest bar for "staging is actually working," rather than inferring it from
a green CI run alone.
