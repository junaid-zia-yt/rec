# Project structure

## Why a monorepo

`docs/22-build-phase-1-plan.md` and the Build Phase 1 brief specified a
pnpm + Turborepo monorepo (`apps/*`, `packages/*`) rather than a single
Next.js application. This was followed as given: at the start of Build
Phase 1 there was no existing supplied application code to preserve (the
Project Context contained Stitch _designs_ — screenshots and a design
spec document — not a working codebase), so there was no "sound existing
single-application structure" to keep instead. A monorepo is worth the
extra ceremony here because the plan calls for a second, separate
application (the Expo React Native mobile app, once the web platform is
functional per the top-level project brief) sharing the same design
tokens, domain types, and business logic — `packages/*` exists precisely
so that sharing doesn't mean copy-pasting.

## Layout

```
recruitment-quality-intelligence/
├── apps/
│   └── web/                   Next.js 16 App Router application
│       ├── app/                 Routes (route groups, layouts, pages)
│       │   ├── (app)/             Authenticated app shell + all MVP screens
│       │   ├── (auth)/            Sign-in/forgot-password/reset-password/accept-invitation
│       │   ├── auth/callback/     Route handler: exchanges a Supabase auth code for a session
│       │   ├── unauthorized/      Generic access-denied screen
│       │   └── fonts/             Self-hosted font files (see its README.md)
│       ├── components/domain/   App-specific composed components (nav, shell, auth forms)
│       ├── components/ui/       App-local test coverage for @rqi/ui usage
│       ├── e2e/                 Playwright smoke + auth tests
│       ├── lib/
│       │   ├── auth/              Authorization helpers, permission checks, project row-scoping, server actions
│       │   ├── audit/             audit_events + project_activity logging helpers
│       │   ├── clients/           Client management server actions
│       │   ├── projects/          Recruitment-project server actions
│       │   ├── jobs/               Job-intake server actions
│       │   ├── job-descriptions/  Job-description paste/upload server actions
│       │   ├── files/             File-security validation + private Storage upload/signed-URL helpers
│       │   ├── supabase/          Browser/server/middleware/admin client factories
│       │   └── nav.ts, mock-data.ts, env.ts
│       ├── scripts/seed.ts      Demo org + user seed script (requires a live Supabase project)
│       ├── proxy.ts             Session refresh + route protection (Next 16's `middleware.ts` replacement)
│       └── ...config files
├── packages/
│   ├── ui/                    @rqi/ui — reusable design-system components
│   ├── config/                 @rqi/config — design tokens + Tailwind preset
│   ├── types/                   @rqi/types — shared, database-free domain types (Zod) + the permission matrix
│   └── testing/                @rqi/testing — shared Vitest/RTL setup
├── supabase/
│   ├── migrations/             Versioned SQL: schema, RLS policies, JWT-claim helpers
│   ├── seed/                   Seed script documentation (the script itself lives in apps/web)
│   └── README.md               Manual configuration checklist (JWT hook, env vars) — not yet applied anywhere
├── docs/                      Architecture docs, decisions, phase reports
├── reference/stitch/          Read-only copies of the source Stitch designs
├── .github/workflows/ci.yml   CI pipeline
└── root config (turbo.json, tsconfig.base.json, .prettierrc, ...)
```

## Package boundaries

- **`apps/web`** is the only package that knows about Next.js, routing, or
  rendering strategy. It composes `@rqi/ui` components and `@rqi/types`
  types; it does not define new generic UI primitives — those belong in
  `@rqi/ui`.
- **`@rqi/ui`** has no business logic and no knowledge of the domain model
  (no `Candidate`, no `Scorecard`) — see `docs/design-system-implementation.md`.
  It depends only on `@rqi/config` (for the Tailwind preset) and Radix UI
  primitives.
- **`@rqi/config`** is pure data — design tokens and a Tailwind preset
  function. No React, no runtime logic.
- **`@rqi/types`** is Zod schemas and their inferred types for every
  domain entity in `docs/07-data-model.md`'s Build-Phase-1-relevant subset.
  Deliberately has no dependency on Supabase or any database client, so it
  can be imported by both `apps/web` and, later, the mobile app, without
  pulling in a server-only or web-only dependency.
- **`@rqi/testing`** centralizes the Vitest + Testing Library setup
  (`jest-dom` matchers, re-exported `render`/`screen`/`userEvent`) so every
  package's tests configure it the same way once.

## `reference/stitch/`

Read-only copies of the source Stitch design material (the two `DESIGN.md`
documents and the one screenshot this tool could reliably access — see
`docs/02-asset-inventory.md` for the access limitation). Nothing in
`apps/` or `packages/` imports from here; it exists purely as a durable,
in-repo citation for "why does this token/layout look like this."

## Route groups

`apps/web/app/(app)/` is a route group (the parentheses are not part of
the URL) so every authenticated screen shares the `AppShell` layout
(`apps/web/app/(app)/layout.tsx`) without an explicit auth check yet —
that check is added when authentication is implemented in a later phase
(`docs/19-mvp-scope.md`). `apps/web/app/page.tsx` (`/`) redirects straight
to `/dashboard`.
