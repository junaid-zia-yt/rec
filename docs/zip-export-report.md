# ZIP Export Report — `recruitment-ai-private-demo.zip`

## 1. Export details

| Field | Value |
|---|---|
| Export date | 2026-09-29 (UTC) |
| Commit SHA | **None available.** This repository has never had any git commits in this project's history (`git status` reports "On branch master / No commits yet" — a `.git` directory exists but is empty). This export is identified instead by export date and the file's checksum below. |
| ZIP filename | `recruitment-ai-private-demo.zip` |
| SHA-256 (final, delivered archive) | `855304ecd3d320e19bf978cf1c87f3f1973eeb4704b4829710fe2a4479bad4da` |
| Archive size (compressed) | 2.3 MB |
| File count | 893 files (892 source files plus this report, embedded in `docs/`) |
| Uncompressed source size | ~8.2 MB |

Note on self-reference: this report is itself packaged inside the ZIP's `docs/` folder, so the copy embedded in the archive was necessarily written just before the final packaging step and cannot quote the archive's own final checksum. The SHA-256 above is the checksum of the archive as actually delivered — verify a downloaded copy against it directly (`sha256sum recruitment-ai-private-demo.zip`) rather than against any hash value that might appear inside the embedded copy of this file.

## 2. What this export is

This is a source-code export of the **private client demonstration** build (Build Phase 17D — see `docs/private-client-demo-guide.md`, `docs/demo-script.md`, `docs/demo-limitations.md`, `docs/post-demo-conversion-plan.md`). It is exported for deployment and review **outside** this environment. It carries the same status as the running demo itself: **not production, not certified staging, not a live system** — see §9 for the unchanged list of what remains unverified.

## 3. Included applications and packages

- `apps/web` — Next.js 16 (App Router) web application, TypeScript, Tailwind CSS, shadcn/ui.
- `apps/mobile` — Expo React Native mobile application, TypeScript.
- `packages/types` — shared TypeScript types.
- `packages/ui` — shared UI component library.
- `packages/config` — shared Tailwind/design-token configuration.
- `packages/testing` — shared test utilities.
- `supabase/migrations` — all 36 SQL migrations (`0001`–`0036`), plus `scripts/pgverify-stubs` (local-Postgres-only auth/storage schema stubs used for verification, never applied to a real Supabase project) and `scripts/verify_candidates.sql` (the project's database regression suite).
- `docs/` — the full documentation set (63 files at export time), including every build-phase report, architecture document, the production-readiness assessment, and the four private-demo documents.
- `reference/stitch/` — the Google Stitch design reference material (specs and screen references) this UI was built to match.
- `.github/workflows/` — `ci.yml`, `staging-deploy.yml`, `migration-validation.yml`.
- Root and workspace configuration: `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.env.example`, `.editorconfig`, `.prettierrc`, `.prettierignore`, `.gitignore`, `README.md`.
- Per-app configuration: `apps/web/tsconfig.json`, `apps/web/tailwind.config.ts`, `apps/web/next.config.ts`, `apps/web/vitest.config.ts`, `apps/web/sentry.*.config.ts`, `apps/web/playwright.config.ts` (if present), `apps/mobile/tsconfig.json`, `apps/mobile/app.json`/Expo config.
- All unit and integration tests (Vitest for web, Jest for mobile) and Playwright E2E specs (`apps/web/e2e/`).
- `apps/mobile/assets` (mobile app icons/splash — the only static asset directory in this repository; `apps/web` has no `public/` directory, since its favicon is generated at build time via the Next.js file-convention `apps/web/app/icon.tsx`, not a static file).

**Not present in this repository, and therefore not in the ZIP**: `vercel.json` — no Vercel project has ever been configured for this codebase (see §9); deployment to Vercel today would use its framework auto-detection for a Next.js app, or a `vercel.json` added at that time.

## 4. Commands executed for this export (all run fresh, 2026-09-29)

| Step | Command | Result |
|---|---|---|
| 1. Format check | `pnpm format:check` (Prettier) | Clean — all files match project style |
| 2. Lint | `npx turbo run lint --force` | 0 errors, 18 pre-existing/unrelated mobile-app warnings (`@typescript-eslint/no-require-imports` in Jest test files — a long-standing, accepted pattern in this codebase's mobile test setup, not new) |
| 3. Typecheck | `npx turbo run typecheck --force` | Clean across all 6 workspace packages |
| 4. Tests | `npx turbo run test --force` | **Web**: 119 test files / 884 tests passing (Vitest). **Mobile**: 26 test suites / 98 tests passing (Jest). |
| 5. Production build | `npx turbo run build --force` (`next build`) | Succeeds |
| 6. Secrets scan | Pattern scan for API-key-shaped strings (`sk-ant-…`, `sk-…`, AWS-style keys, assigned key/secret literals) across all tracked source, and a direct read of `.env.example` | Zero matches. `.env.example` lists variable **names** only — every value is blank. No `.env`/`.env.local`/`.env.*.local` file is included in the ZIP (excluded by rule, and `apps/web/.env.local` in this environment itself contains no secrets — only `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_DEMO_MODE`). |
| 7. Lockfile install | `pnpm install --frozen-lockfile` | `pnpm-lock.yaml` is up to date with `package.json` across all 7 workspace projects — pnpm reports zero drift (frozen-lockfile mode fails hard on any mismatch, and it did not). This confirms the lockfile is installable exactly as committed; it was not re-verified via a full from-scratch `node_modules` wipe in this environment, to avoid an unnecessary multi-minute reinstall with no additional signal beyond what frozen-lockfile mode already confirms. |
| 8. Demo data fictional | Direct review of `apps/web/scripts/seed-demo.ts` | Confirmed — every organization, client, candidate, and role name is invented; no real person, company, or contact information. See `docs/demo-limitations.md` §4. |
| 9. External outreach disabled | Direct review of `apps/web/lib/outreach/channels/email.ts`, `sms/adapter.ts`, `linkedin.ts`, `apollo/apollo-client.ts` | Confirmed — email is forced to a no-op adapter whenever `NEXT_PUBLIC_DEMO_MODE=true`, regardless of any Resend key; SMS has no provider ever chosen (always reports `not_connected`); LinkedIn has no automated-send code path at all by design (manual/copy-paste only); Apollo has never had a configured API key in this environment. See `docs/demo-limitations.md` §3. |
| 10. Integrations labelled honestly | Direct review of `apps/web/components/domain/integrations/integrations-panel.tsx` | Confirmed — TA Tracker and SMS cards both now carry an explicit **"Deferred."** label ahead of their honest explanation (no invented vendor, no fabricated API). |

## 5. Required Node.js and pnpm versions

| Tool | Required version | Verified with |
|---|---|---|
| Node.js | `>=20` (per `package.json` `engines`) | This export was built and verified under Node v22.22.2 |
| pnpm | 10.x (this export's lockfile was generated with pnpm 10.9.0) | Verified with pnpm v10.9.0 |

## 6. Required environment variables (names only — no values are included anywhere in this export)

From `.env.example` (copy to `apps/web/.env.local` for local development):

**Public** (safe for the browser, `NEXT_PUBLIC_` prefix only):
`NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_BUILD_SHA`, `NEXT_PUBLIC_RELEASE_TAG`, `NEXT_PUBLIC_ENVIRONMENT_NAME`, `NEXT_PUBLIC_DEMO_MODE`

**Server-only** (never prefix with `NEXT_PUBLIC_`, never reaches the client bundle):
`SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`, `SENTRY_TRACES_SAMPLE_RATE`, `STAGING_BASIC_AUTH_USER`, `STAGING_BASIC_AUTH_PASSWORD`, `SUPABASE_STORAGE_BUCKET`, `COPILOT_DAILY_MESSAGE_LIMIT`, `COPILOT_DAILY_COST_LIMIT_USD`, `APOLLO_API_KEY`, `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `MICROSOFT_CALENDAR_CLIENT_ID`, `MICROSOFT_CALENDAR_CLIENT_SECRET`, `NOTIFICATIONS_FROM_EMAIL`

**Demo-only, not in `.env.example`** (used by the seed/reset-demo scripts, never set anywhere by default):
`ALLOW_DEMO_SEED` (must be exactly `true` — a deliberate safety rail against pointing the seed script at a real database)

Every variable is optional at the code level — this codebase never crashes on an absent variable. Leaving the Supabase/Anthropic/Resend/Sentry variables unset runs the app against local mock fixtures (see `.env.example`'s "Demo mode" section) or, with `NEXT_PUBLIC_DEMO_MODE=true` set and a local database migrated and seeded, the same private-demo mode this environment runs.

## 7. Local setup instructions

```bash
# 1. Install dependencies (matches the included lockfile exactly)
pnpm install --frozen-lockfile

# 2. Copy the environment template
cp .env.example apps/web/.env.local
# Edit apps/web/.env.local: at minimum, set NEXT_PUBLIC_DEMO_MODE=true to run
# the private demo exactly as delivered. Leave Supabase/Anthropic/Resend/
# Sentry variables blank unless you are provisioning real infrastructure —
# see docs/post-demo-conversion-plan.md for what that involves.

# 3. Provision a local Postgres 16 instance, then apply the schema:
#    (the pgverify stubs are LOCAL-VERIFICATION-ONLY — a real Supabase
#    project bootstraps its own auth/storage schema automatically and
#    these stubs must never be applied there)
psql -d <your_local_db> -f scripts/pgverify-stubs/00_stub_supabase_auth.sql
psql -d <your_local_db> -f scripts/pgverify-stubs/01_stub_storage.sql
for f in supabase/migrations/*.sql; do psql -d <your_local_db> -f "$f"; done

# 4. Seed the private demo dataset (see docs/private-client-demo-guide.md §4
#    for full detail, including the demo login accounts this creates)
ALLOW_DEMO_SEED=true \
NEXT_PUBLIC_SUPABASE_URL=<your local/dev Supabase URL> \
SUPABASE_SERVICE_ROLE_KEY=<your local/dev service role key> \
pnpm --filter web seed:demo

# 5. Run the web app
pnpm --filter web dev
# → http://localhost:3000

# 6. Run the mobile app (optional, requires Expo tooling)
pnpm --filter mobile start
```

Verification commands (all used to produce §4 above, safe to re-run at any time):

```bash
pnpm format:check
npx turbo run lint --force
npx turbo run typecheck --force
npx turbo run test --force
npx turbo run build --force
```

## 8. Vercel deployment instructions

No Vercel project has ever been created for this codebase in this environment's history — this section is instructions for setting one up, not a description of an existing configuration:

1. Import this repository (or the extracted contents of this ZIP, pushed to a fresh git repository) into Vercel as a new project.
2. Framework preset: Next.js. Root directory: `apps/web` (this is a pnpm/Turborepo monorepo — Vercel's monorepo support auto-detects the workspace, but the project's **Root Directory** setting must point at `apps/web` explicitly).
3. Build command: leave the framework default (`next build`), or set explicitly to `cd ../.. && npx turbo run build --filter=web` if Vercel's monorepo auto-detection needs help resolving the Turborepo workspace.
4. Install command: `pnpm install --frozen-lockfile` (ensures the deployed build matches this exported lockfile exactly).
5. Environment variables: set the variables listed in §6 that apply to the deployment's purpose. For a **demo-only** deployment mirroring this environment: set only `NEXT_PUBLIC_APP_URL` (to the deployment's real URL) and `NEXT_PUBLIC_DEMO_MODE=true` — no Supabase/Anthropic/Resend/Sentry credentials are required for the demo to run, and none should be added for that purpose. For anything beyond the demo (a real POC or production deployment), see `docs/post-demo-conversion-plan.md` §3 and `docs/final-release-report.md` for the full list of infrastructure that must be provisioned and verified first — this ZIP export does not change that requirement.
6. A production Supabase project, if/when one is provisioned, needs the same 36 migrations in `supabase/migrations/` applied via the Supabase CLI or dashboard SQL editor — **never** the `scripts/pgverify-stubs/*.sql` files, which exist only to fake the `auth`/`storage` schemas that a real Supabase project already provides natively.
7. `.github/workflows/staging-deploy.yml` in this export shows this project's own intended CI/CD pattern (never yet executed against real infrastructure — see `docs/staging-release-report.md`) and can be adapted once real Vercel/Supabase credentials exist as GitHub repository secrets.

## 9. Known limitations (unchanged by this export)

This export changes nothing about the platform's verified state. Carried forward exactly as stated in `docs/demo-limitations.md` and `docs/final-release-report.md`:

- No real cloud infrastructure has ever been provisioned or connected to this codebase in its history — no Vercel deployment, no Supabase project (staging or production), no Sentry DSN, no Resend sending domain, no live Anthropic API key.
- The private demo's AI-assessment layer is a clearly-labelled deterministic sample (`ai_runs.model = 'sample-assessment-v1'`), not live Claude model output — see `docs/demo-limitations.md` §2.
- **PRODUCTION RELEASE BLOCKED — DO NOT GO LIVE** remains the project's release decision (`docs/final-release-report.md`), unaffected by this export existing as a downloadable file.
- This ZIP is a source-code snapshot at export time — it does not represent a git history, and (per §1) no commit SHA exists to pin it to, because this project has never had a git commit. Anyone continuing development from this export should initialize their own git repository and commit history from this snapshot.

## 10. Files and directories excluded from the ZIP

Per the export request, and matching this repository's own `.gitignore` convention:

`node_modules`, `.pnpm-store`, `.next`, `dist`, `build`, `out`, `coverage`, `.turbo` (all workspace build-cache directories and their `.log` files), `*.log`, `.env`, `.env.local`, `.env.*.local`, `.DS_Store`, `playwright-report`, `test-results` (Playwright run artifacts), `.vscode`, `next-env.d.ts`, `.git` (this repository has no commit history to exclude, but the empty `.git` directory itself is excluded), `*.tsbuildinfo` (TypeScript incremental-build cache), `.expo`, and any `*.tmp`/`tmp` paths.

No real candidate or client personal data exists anywhere in this repository to exclude — every candidate/client/role/organization record ever seeded into any environment tied to this codebase (dev, staging-UAT fixtures, or this private demo) is fictional, generated by `apps/web/scripts/seed*.ts`, never real personal information.

## Related documents

`docs/private-client-demo-guide.md` · `docs/demo-script.md` · `docs/demo-limitations.md` · `docs/post-demo-conversion-plan.md` · `docs/final-release-report.md`
