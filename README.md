# Recruitment Quality Intelligence

An AI-assisted, evidence-first recruitment intelligence platform for
specialist recruitment agencies (retail, convenience-store, and
food-service). See [`docs/MASTER-ARCHITECTURE.md`](docs/MASTER-ARCHITECTURE.md)
for the full product and technical architecture, and
[`docs/21-implementation-contract.md`](docs/21-implementation-contract.md)
for the approved build contract this repository implements against.

**Current status: Build Phase 2 — authentication, organizations & RLS.**
Build Phase 1 delivered the repository, design system, reusable UI
components, and a responsive application shell on typed mock data (see
[`docs/build-phase-1-report.md`](docs/build-phase-1-report.md)). Build Phase
2 adds Supabase Auth, the `organizations`/`user_profiles`/
`organization_memberships`/`invitations`/`audit_events` schema and its Row
Level Security policies, centralized authorization helpers, and the
sign-in/forgot-password/reset-password/unauthorized/team-settings screens —
see [`docs/build-phase-2-report.md`](docs/build-phase-2-report.md) for
exactly what was built, verified, and deferred, **including the one open
blocker every later phase depends on**: no live Supabase project is
connected to this repository yet, so nothing that requires one (real sign-in,
RLS enforcement, the seed script) has been exercised end-to-end. AI
integration and recruitment-domain business logic (projects, candidates,
scoring, shortlists) remain unimplemented.

## Core principles

Every later build phase is bound by the rules in
[`docs/MASTER-ARCHITECTURE.md`](docs/MASTER-ARCHITECTURE.md):

1. Quality before quantity.
2. Evidence before scoring.
3. Human approval before candidate submission.
4. Candidates who fail mandatory requirements cannot enter the ranked shortlist.
5. AI must never invent candidate qualifications or evidence.
6. Missing candidate information must be marked as unverified.

## Repository structure

See [`docs/project-structure.md`](docs/project-structure.md) for the full
layout and the reasoning behind it. In short:

```
apps/web/          Next.js 16 (App Router) web application
packages/ui/        Reusable, design-token-driven UI components (@rqi/ui)
packages/config/     Design tokens + Tailwind preset (@rqi/config)
packages/types/       Shared, database-free domain types (@rqi/types)
packages/testing/    Shared Vitest/Testing Library setup (@rqi/testing)
docs/                Architecture, decisions, and phase reports
reference/stitch/    Read-only copies of the source Stitch designs
```

## Getting started

See [`docs/development-setup.md`](docs/development-setup.md) for full
setup instructions, environment variables, and troubleshooting. Quick
start:

```bash
pnpm install
pnpm dev        # apps/web on http://localhost:3000
```

The app runs in **demo mode** with typed mock data — no `.env` file or
external credentials are required to develop against the UI shell. See
[`.env.example`](.env.example) for the environment variables later phases
will use.

## Commands

| Command                             | Description                                 |
| ----------------------------------- | ------------------------------------------- |
| `pnpm dev`                          | Run the web app in development mode         |
| `pnpm build`                        | Production build of every workspace package |
| `pnpm lint`                         | ESLint across the workspace                 |
| `pnpm typecheck`                    | `tsc --noEmit` across the workspace         |
| `pnpm test`                         | Unit/component tests (Vitest)               |
| `pnpm test:e2e`                     | Playwright end-to-end smoke test            |
| `pnpm format` / `pnpm format:check` | Prettier                                    |

See [`docs/testing-guide.md`](docs/testing-guide.md) for what each test
layer covers and how to add to it.

## Design system

The UI is built from Stitch-derived design tokens
(`packages/config/src/tokens.ts`) and a set of ~30 reusable primitives
(`packages/ui`). See
[`docs/design-system-implementation.md`](docs/design-system-implementation.md)
for token provenance, deviations from the source Stitch designs, and how to
extend the component set.

## Documentation index

- [`docs/MASTER-ARCHITECTURE.md`](docs/MASTER-ARCHITECTURE.md) — system architecture
- [`docs/19-mvp-scope.md`](docs/19-mvp-scope.md) — MVP scope (included/excluded/deferred)
- [`docs/20-decision-register.md`](docs/20-decision-register.md) — decisions made and pending
- [`docs/21-implementation-contract.md`](docs/21-implementation-contract.md) — the build contract
- [`docs/22-build-phase-1-plan.md`](docs/22-build-phase-1-plan.md) — the Build Phase 1 task plan
- [`docs/build-phase-1-report.md`](docs/build-phase-1-report.md) — what Build Phase 1 built and verified
- [`docs/build-phase-2-report.md`](docs/build-phase-2-report.md) — what Build Phase 2 built and verified, including its open blocker
- [`docs/development-setup.md`](docs/development-setup.md) — local setup
- [`docs/project-structure.md`](docs/project-structure.md) — repository layout rationale
- [`docs/design-system-implementation.md`](docs/design-system-implementation.md) — design tokens and components
- [`docs/testing-guide.md`](docs/testing-guide.md) — testing strategy and how to extend it
- [`supabase/README.md`](supabase/README.md) — applying migrations and the manual Supabase configuration steps required
# rec
# rec
