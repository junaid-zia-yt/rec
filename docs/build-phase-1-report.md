# Build Phase 1 report

Status: **complete and verified** against the Build Phase 1 brief and
`docs/22-build-phase-1-plan.md`. All in-scope commands were actually run
(not assumed) and pass; the one blocked command's cause and fix are
documented below rather than glossed over.

## 1. Work completed

- Repository foundation: pnpm + Turborepo monorepo (`apps/web`,
  `packages/{ui,config,types,testing}`), strict TypeScript, ESLint 9 (flat
  config), Prettier, Vitest, Playwright.
- Safe `.env.example` with the exact variables specified in the brief; Zod
  environment validation (`apps/web/lib/env.ts`) that never crashes on
  missing optional credentials and computes a `demoMode` flag.
- Resolved Stitch design tokens (`packages/config/src/tokens.ts`) with
  inline provenance (`[CONFIRMED]` / `[Doc A]` / `[Doc B]` / `[DEFAULT]` /
  `[FLAG]`) and a Tailwind preset built from them.
- ~30 reusable, accessible UI primitives (`packages/ui`) — see
  `docs/design-system-implementation.md` for the full list and rationale.
- A responsive application shell: desktop nav rail (9 items, exact
  specified order), mobile bottom nav (5 items) with a "More" hub, top
  header with product identity/search/notifications/help/account
  placeholders.
- Working placeholder pages for all 14 specified routes plus `/more`
  (justified in §9 below), each with a loading skeleton and, where
  relevant, an empty or error state, all reading from one centralized mock
  fixture file (`apps/web/lib/mock-data.ts`).
- A fully built dashboard matching the brief's required content set,
  using the two approved sample POC roles.
- Strict, database-free, Zod-backed domain types for all 16 specified
  entities (`packages/types`).
- A testing foundation: 9 unit/component test files (18 tests) and a
  6-step Playwright smoke test.
- CI workflow (`.github/workflows/ci.yml`): install → format check → lint
  → typecheck → unit tests → build → Playwright smoke test.
- Documentation: this report plus README, development-setup,
  project-structure, design-system-implementation, and testing-guide.

## 2. Repository structure used

The monorepo layout specified in the brief, used as given (not a
from-scratch decision — see `docs/project-structure.md` "Why a monorepo"
for why it was still the right call even though there was no pre-existing
codebase to preserve).

## 3. Features implemented

Application shell, navigation (desktop + mobile), all 14 specified routes
and the extra `/more` route, the dashboard with real mock-data-driven
content, the Shortlist Verification Matrix screen (the one screen with a
confirmed visual reference), design tokens, and the component library.
**No** database integration, authentication, Claude API integration,
candidate scoring, CV parsing, external integrations, native mobile app,
or deployment — all explicitly out of scope and not touched.

## 4. Stitch screens reproduced

Only **one** of the 25 uploaded screenshots was ever individually
addressable by this tool — `screen.png` is an identical filename repeated
25 times, and reads deterministically resolved to the same first-uploaded
file every time (`docs/02-asset-inventory.md` §2.3, reconfirmed during
this phase). That one confirmed screenshot —
`reference/stitch/screens/confirmed-01-shortlist-verification-matrix-mobile.png`
— is reproduced at `/shortlists/[shortlistId]`: header, rank tiles, the 6
comparison sections (Overall Match & Gates, Leadership Scope, Experience &
Domain, Location & Commute, Comp & Availability, Strengths & Operational
Risks), and the sticky bottom approval bar, all matching the screenshot's
content, icons, and layout. The desktop composition for that same screen
is a new layout built from the design tokens (the screenshot is
mobile-only), per Decision D-01.

Every other screen (dashboard, projects, candidates, scorecard, outreach,
POC comparison, integrations, notifications, settings) was built from the
two DESIGN.md documents' described patterns and the confirmed screenshot's
visual language — not invented from nothing, but also not a literal
reproduction of an unseen image. This is the single largest and most
important limitation of this phase; see §10.

## 5. Files created / modified

Created: the entire monorepo scaffold (root config, `apps/web`, all four
`packages/*`), 14+1 route directories under `apps/web/app/(app)/`, all
domain components (`TopNav`, `DesktopNavRail`, `MobileBottomNav`,
`AppShell`), `lib/{env,nav,mock-data}.ts`, 9 test files, `e2e/smoke.spec.ts`,
`.github/workflows/ci.yml`, and the 5 documentation files listed above.
Full file list: `git status` / the repository tree — omitted here for
length, since it is effectively "everything in the repo."

Modified after initial authoring (bugs found during this phase's own
verification, fixed within scope):

- `apps/web/lib/nav.ts` — the "Notifications" item in `moreNav` used the
  wrong icon (`MoreHorizontal`, duplicating the mobile nav's own "More"
  icon); changed to `Bell`.
- `apps/web/app/(app)/dashboard/page.tsx` — a boolean named `gateFailAlert`
  was actually `true` when gates were _passing_, and the JSX checked
  `gateFailAlert === false` to show a success alert — functionally correct
  today (no mock candidate currently fails a gate) but the name and
  double-negative made the logic backwards to read. Renamed to
  `allGatesPassing` with the condition simplified to `allGatesPassing &&`.
- `apps/web/app/layout.tsx`, `apps/web/app/globals.css`,
  `apps/web/app/fonts/*` — switched from `next/font/google` to
  `next/font/local` against vendored font files. See §9/§10.
- `apps/web/app/(app)/projects/[projectId]/page.tsx`,
  `.../projects/[projectId]/scorecard/page.tsx`,
  `.../candidates/[candidateId]/page.tsx`,
  `.../shortlists/[shortlistId]/page.tsx` — **fixed a real bug**: Next.js
  16 made route `params` a `Promise`, and these pages were reading
  `params.xxx` synchronously, so every dynamic route 404'd in a
  production build. Fixed by awaiting `params` (server components) or
  unwrapping it with React's `use()` (the one client component). See §9.
- `apps/web/app/(app)/candidates/[candidateId]/page.test.tsx` — updated to
  call the (now-async) page component directly with `params:
Promise.resolve(...)`, matching the real router's contract, instead of a
  plain object.
- `apps/web/eslint.config.mjs`, `apps/web/postcss.config.js` — resolved
  ESLint warnings by naming the default-exported config objects.
- `.env.example` — corrected two stale file-path references in comments.

## 6. Commands executed (all actually run, not assumed)

```
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Plus manual runtime verification: `next start` against the production
build, curl checks of every dynamic route (valid and invalid IDs), and a
Playwright-driven screenshot pass at 5 breakpoints across 4 representative
routes.

## 7. Test / typecheck / lint / build results

All commands pass with a clean working tree, on the final state of the
code:

| Command             | Result                                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check` | ✅ Pass — "All matched files use Prettier code style!"                                                         |
| `pnpm lint`         | ✅ Pass — 0 errors, 0 warnings (2 earlier warnings resolved)                                                   |
| `pnpm typecheck`    | ✅ Pass — all 5 workspace packages                                                                             |
| `pnpm test`         | ✅ Pass — 9 test files, 18 tests, 0 failures                                                                   |
| `pnpm build`        | ✅ Pass — 21 routes generated (14 static, 5 SSG dynamic, 1 dynamic (`/shortlists/[shortlistId]`), 1 not-found) |
| `pnpm test:e2e`     | ✅ Pass — 2/2 Playwright smoke tests (desktop nav flow, mobile bottom nav)                                     |

Two real issues were found and fixed _during_ this verification, not
glossed over:

1. **Dynamic routes 404ing in production** — see §5/§9/§10. Confirmed
   fixed by curling every dynamic route in a `next start` production
   server post-fix; all render their real content, and a nonexistent ID
   correctly falls through to the not-found page.
2. **`fonts.googleapis.com` unreachable at build time** — see §9/§10.
   Confirmed fixed: `pnpm build` no longer touches the network for fonts.

## 8. Visual verification results

Playwright screenshots at all 5 required widths (1440 / 1024 / 768 / 390 /
360px) across `/dashboard`, `/shortlists/[id]`, `/projects`, `/candidates`:
**zero horizontal overflow at any width, on any route** (checked
programmatically via `scrollWidth > clientWidth`, not just eyeballed).

Manually inspected the dashboard and the Shortlist Verification Matrix
screen at desktop and mobile widths:

- Sidebar/nav rail: correctly hidden below `lg` (1280px), mobile bottom
  nav correctly hidden at/above it — never both visible.
- Active-route state is visually distinct in both nav modes (filled
  background on desktop, colored icon + top indicator bar on mobile).
- Dashboard cards, metric tiles, workflow steppers, and the Shortlist
  Verification Matrix's comparison sections all render at the correct
  widths without clipped text or overlapping controls.
- Keyboard focus states render (Tailwind `focus-visible` ring, confirmed
  in the component source and via the `desktop-nav-rail` /
  `mobile-bottom-nav` component tests asserting the relevant classes).
- One cosmetic **screenshot-tool artifact**, not an app defect: a
  full-page Playwright screenshot of `/shortlists/[id]` shows the sticky
  bottom approval bar "stamped" mid-page, because `position: fixed`
  elements get captured at their viewport position during full-page
  screenshot stitching. A real user scrolling the page only ever sees it
  pinned to the bottom of their viewport, which is the intended design
  (`docs/04-design-system.md`'s "Sticky Approval Bottom Sheet" pattern).

## 9. Deviations from Stitch

1. **Desktop layout for `/shortlists/[shortlistId]` is a new composition**,
   not observed — the one confirmed screenshot is mobile-only. Built from
   the design tokens and the mobile screen's content structure (Decision
   D-01).
2. **23 of 24 other screens** (everything except the Shortlist
   Verification Matrix and the design-system extraction itself) were built
   from the two DESIGN.md documents' textual descriptions and patterns,
   not from directly-observed screenshots, due to the tool limitation in
   §4. Every such layout choice not directly sourced from a DESIGN.md value
   is marked `[DEFAULT]` in `packages/config/src/tokens.ts` and explained
   in `docs/design-system-implementation.md`.
3. **Fonts are self-hosted via `next/font/local`**, not `next/font/google`
   as a literal reading of "Space Grotesk" / "Geist" might suggest. This
   sandboxed build environment cannot reach `fonts.googleapis.com` (only
   npm registries and GitHub are reachable), so `next/font/google` failed
   the production build outright. The two font files were vendored from
   the `@fontsource-variable/geist` / `@fontsource-variable/space-grotesk`
   npm packages (both are the same open-source font releases
   `next/font/google` would have fetched) and are loaded locally — the
   visual result is identical, and the app now never makes a runtime
   network request to Google Fonts at all, which is a strictly better
   production outcome, not merely a workaround. See
   `apps/web/app/fonts/README.md`.
4. **The shortlist screen's candidate-selection checkboxes are not in the
   static screenshot.** They were added so the sticky "Continue to
   Shortlist (N Selected)" button's count and disabled state are actually
   functional, per the brief's tension between "no real business logic"
   and "working placeholder" — this is a judgment call, flagged here as
   requested, not a literal reproduction.
5. **`pnpm@10.9.7`, the exact version named in the brief, does not exist**
   on the npm registry (only `10.9.0` and `10.9.1` in that patch line are
   published). Pinned to `10.9.0` instead, in the root `package.json` and
   CI. Documented in `docs/development-setup.md`.
6. **ESLint 9 (flat config) instead of ESLint 8 (.eslintrc)** —
   `eslint-config-next@16.3.5` requires ESLint ≥ 9 and only ships a flat
   config; the brief specified ESLint without pinning a major version, and
   this is the version Next 16 itself requires.

## 10. Known limitations

- **Dynamic route params bug, now fixed but worth flagging as a class of
  risk**: Next.js 16 changed `params`/`searchParams` to be async
  (`Promise`-based) for every page, in both server and client components.
  Any _future_ dynamic route added to this codebase must follow the same
  pattern (`await params` in a server component, `use(params)` in a
  client component) or it will silently 404 in production while looking
  fine in some dev-mode scenarios — this is worth calling out explicitly
  in onboarding/PR review for Phase 2+, since it is an easy mistake to
  reintroduce.
- Only one Stitch screen was ever visually confirmed; the rest are
  built from written descriptions, not pixel-matched. If the actual
  Stitch screenshots become individually accessible (e.g. re-uploaded
  with distinct filenames), a follow-up pass should re-verify every
  screen against them directly.
- `colors.textPlaceholder` (`#94A3B8`) is flagged `[FLAG]` in
  `packages/config/src/tokens.ts` — contrast against white was not
  formally re-verified against WCAG AA in this phase.
- No automated visual regression / screenshot-diff testing yet — visual
  verification this phase was a manual (though programmatically
  overflow-checked) Playwright pass, not a repeatable CI gate.
- The `/shortlists/[shortlistId]` route is the only dynamic route without
  `generateStaticParams` (it's a client component for its selection
  state), so it is server-rendered on demand (`ƒ` in the build output)
  rather than statically generated like the other three dynamic routes.
  Functionally fine for Build Phase 1's single mock shortlist; worth
  revisiting once there are many shortlists.

## 11. Recommendation for next phase

Build Phase 1 is complete and verified — the shell, design system,
navigation, and all 14+1 placeholder routes work end to end against mock
data, with a green CI-equivalent local run. Recommend proceeding to
**Build Phase 2** per `docs/19-mvp-scope.md` / `docs/22-build-phase-1-plan.md`'s
sequencing (expected to be Supabase schema + migrations + auth, the next
items explicitly excluded from this phase) — pending the user's explicit
approval, per the working process rule that no phase begins without it.

---

**BUILD PHASE 1 COMPLETE AND VERIFIED**
