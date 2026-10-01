# Development setup

## Prerequisites

- Node.js 20+
- pnpm 10.9.x (`packageManager` in the root `package.json` pins the exact
  version; run `corepack enable` or install it directly — see note below)

> **Note on the pnpm version pin.** The original Build Phase 1 brief asked
> for `pnpm@10.9.7`, but that exact patch version was never published to the
> npm registry (only `10.9.0` and `10.9.1` exist in the `10.9.x` line). The
> root `package.json` pins `pnpm@10.9.0` instead — the closest real release
> — so `pnpm install` in a clean environment resolves without error. See
> `docs/build-phase-1-report.md` "Differences from Stitch" / "Known
> limitations" for the full note.

## Install

```bash
pnpm install
```

This installs all workspace packages (`apps/web`, `packages/*`) in one
step. On first install, pnpm may ask to approve build scripts for two
transitive dependencies (`esbuild`, `unrs-resolver`); approve them —
they're required for Tailwind/ESLint tooling to build correctly. Both are
already allow-listed in `pnpm-workspace.yaml`'s `onlyBuiltDependencies`,
so a repeat `pnpm install` on a machine that has run it once before will
not prompt again.

## Environment variables

Copy `.env.example` to `.env.local` inside `apps/web/` if you want to
configure any external service:

```bash
cp .env.example apps/web/.env.local
```

**Supabase (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`) is what Build Phase 2 added.** Without it, the
app still runs — `apps/web/lib/env.ts`'s `supabaseConfigured` flag is
`false`, `apps/web/proxy.ts` does not enforce authentication (every route
stays reachable, exactly as in Build Phase 1), and the sign-in/forgot-
password/reset-password/invite screens each render a plain "authentication
is not configured" state instead of a form that could never succeed. **No
Supabase project is connected in this repository's own environment** —
setting these up is a prerequisite for exercising Build Phase 2's auth flows
at all; see `supabase/README.md` for the full checklist (applying
`supabase/migrations/*.sql`, registering the custom-access-token JWT hook,
running the seed script). `ANTHROPIC_API_KEY`/`RESEND_API_KEY` remain unused
by any code path and are optional in every phase so far.

See `.env.example` for the full variable list and what each one is used for.

## Run the app

```bash
pnpm dev
```

Opens the web app at [http://localhost:3000](http://localhost:3000), which
redirects to `/dashboard`. With no Supabase project configured (the default
in this environment) every route is reachable without signing in, matching
Build Phase 1's behavior; once Supabase is configured, `/dashboard` and
every other `(app)` route require a real session (`apps/web/proxy.ts`).

## Verification commands

Run these before opening a PR — they are exactly what CI runs
(`.github/workflows/ci.yml`):

```bash
pnpm format:check   # Prettier
pnpm lint           # ESLint (flat config, apps/web/eslint.config.mjs)
pnpm typecheck       # tsc --noEmit across every workspace package
pnpm test           # Vitest unit/component tests
pnpm build          # Production build of every workspace package
pnpm test:e2e       # Playwright smoke test (starts a production server)
```

`pnpm format` (no `:check`) applies Prettier's fixes in place.

## Seeding demo users (requires a configured Supabase project)

```bash
pnpm --filter web seed
```

Creates one demo organization and four demo users (agency admin, recruiter,
client decision maker, read-only reviewer) — see `supabase/seed/README.md`.
Requires `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; this has
not been run in this repository's own environment, since neither is set
here.

## Troubleshooting

**`pnpm exec playwright install` complains about a browser version, or the
smoke test can't find Chromium.** This development container ships a
pre-installed Chromium at `/opt/pw-browsers/chromium` that Playwright uses
automatically (see `apps/web/playwright.config.ts`) if the standard
Playwright-managed browser isn't present. On a machine without that path
(a normal dev machine, or CI), run `pnpm exec playwright install --with-deps
chromium` once.

**Build fails trying to reach `fonts.googleapis.com`.** It shouldn't — the
app fonts are self-hosted (`next/font/local` against vendored files in
`apps/web/app/fonts/`), specifically so the build never needs network
access to Google Fonts. See `apps/web/app/fonts/README.md` if you need to
update the vendored font files.

**A workspace package script isn't found.** Only `apps/web` has `lint`,
`test`, and `build` scripts in this phase; the `packages/*` libraries only
have `typecheck` (they are consumed as TypeScript source, not built to
`dist/`, until a later phase needs published builds). This is expected —
`turbo run lint` (etc.) simply skips packages without that script.
