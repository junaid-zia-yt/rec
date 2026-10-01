# Build Phase 2 report — authentication, organizations, RBAC & tenant isolation

Per docs/21-implementation-contract.md §21.14 and the Build Phase 2
completion gate. Covers exactly what this phase implements: Supabase
clients, authentication flows, the organizations/memberships/invitations/
audit_events schema and its Row Level Security, centralized authorization
helpers, and the required screens. Recruitment projects, candidates,
scoring, and AI are explicitly out of scope (brief §"Do not implement
recruitment projects in this build") and are untouched.

**The single most important fact in this report**: no live Supabase project
is connected to this repository's environment. Every piece of SQL, every
auth server action, and the proxy/middleware are written to spec, typecheck,
lint, and are unit-tested at the logic layer — but none of it has been
executed against a real Postgres/Supabase instance. Per the project
instructions ("Never claim an external integration works until it has been
configured and tested" / "Stop and report blockers when required
credentials... are missing"), this is reported as a blocker, not glossed
over. See "Known limitations" and "Blockers" below for exactly what remains.

## 1. What was implemented

### 1.1 Supabase clients (brief §1)

- `apps/web/lib/supabase/client.ts` — browser client (anon key).
- `apps/web/lib/supabase/server.ts` — server component/action client, cookie-backed.
- `apps/web/lib/supabase/middleware.ts` — session-refresh client for the proxy.
- `apps/web/lib/supabase/admin.ts` — service-role client, guarded by the `server-only` package so an accidental client-side import fails the build.

Every factory returns `null` (or throws, for the admin client) rather than a
half-working client when `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`/
`SUPABASE_SERVICE_ROLE_KEY` aren't set — see `lib/env.ts`'s new
`supabaseConfigured`/`supabaseAdminConfigured` flags. Every call site branches
on these flags explicitly; nothing assumes a client exists.

### 1.2 Authentication (brief §2)

Implemented as server actions in `apps/web/lib/auth/actions.ts`:

- `signInAction` — email/password sign-in. Any failure (unknown email, wrong
  password, unconfirmed email) returns the same generic message
  (`GENERIC_AUTH_ERROR_MESSAGE`, "Incorrect email or password.") — never
  differentiated, so the response can't be used to enumerate accounts.
- `signOutAction` — idempotent; succeeds with no active session.
- `requestPasswordResetAction` — always returns the same "sent if it exists"
  message regardless of whether the email is registered.
- `updatePasswordAction` — for the session established by the emailed
  recovery link (via `apps/web/app/auth/callback/route.ts`).
- Session refresh + route protection: `apps/web/proxy.ts` (Next.js 16
  renamed `middleware.ts` to `proxy.ts` mid-build — see §7 "Deviations").
  Redirects an unauthenticated user hitting a protected route to `/sign-in`
  with a sanitized `next` param, and redirects an authenticated user away
  from `/sign-in`/`/forgot-password`/`/reset-password`/`/accept-invitation`.
- Open-redirect prevention: `sanitizeRedirectPath` (`lib/auth/routing.ts`)
  rejects any `next` value that isn't a same-origin, single-leading-slash
  path — protocol-relative (`//evil.example`), absolute
  (`https://evil.example`), and `javascript:` values are all rejected back
  to `/dashboard`. Unit-tested in `lib/auth/routing.test.ts`.
- Public self-registration: **not implemented**, per brief §3 — the only way
  into an organization is an invitation (§1.4 below).

### 1.3 Database entities & roles (brief §4–5)

`supabase/migrations/0001`–`0007` create: `organizations`, `user_profiles`
(1:1 with `auth.users`, auto-created via a trigger), `organization_memberships`
(the sole source of truth for role), `invitations`, and `audit_events`
(append-only — `UPDATE`/`DELETE` revoked from `authenticated`/`anon` at the
database-role level, not just RLS). Roles are a Postgres enum
(`public.app_role`): `platform_admin`, `agency_admin`, `recruiter`,
`client_decision_maker`, `read_only_reviewer` — matching the `UserRole` enum
already shipped in `packages/types` from Build Phase 1 (see §7 for the
`client_reviewer`/`client_decision_maker` naming note).

### 1.4 Centralized authorization helpers (brief §6)

`apps/web/lib/auth/`:

- `session.ts` — `requireAuth`, `resolveActiveOrg`, `requireOrgMembership`,
  `requireRole`, `requirePermission`. Every one re-reads
  `organization_memberships` from the database; none trusts a role or org id
  supplied by the caller.
- `membership.ts` — the pure, framework-free decision logic (`resolveDefaultMembership`,
  `findMembership`, `requireMembership`, `requireRole`, `verifyResourceOrg`)
  that `session.ts` wraps with Supabase I/O. Kept separate specifically so it
  is unit-testable without a live database — see §5.
- `permissions.ts` (app) wraps `packages/types/src/permissions.ts`'s
  `hasPermission`, a direct executable transcription of
  docs/06-roles-permissions.md §6.2's permission matrix.
- `errors.ts` — `AuthenticationRequiredError`, `NotAMemberError`,
  `InsufficientRoleError`, `CrossTenantAccessError`, and the two generic
  message constants — every one's message is safe to show a user.

### 1.5 Row Level Security (brief §7)

Every tenant table's RLS ships in the same migration as its `CREATE TABLE`
(`docs/21-implementation-contract.md` §21.7), using `is_org_member()`/
`has_org_role()`/`is_platform_admin()` helper functions
(`0004_organization_memberships.sql`) rather than repeating the membership
subquery inline. `current_org_id()` (`0001_extensions_and_helpers.sql`)
reads a custom `org_id` JWT claim and returns `null` — fail closed — until
the custom-access-token hook (`0007_custom_access_token_hook.sql`) is
registered in the live project's Auth settings, which is a manual step (see
§4). Client Decision-Maker access is **not** implemented as org membership —
`docs/06-roles-permissions.md` §6.3 and `docs/07-data-model.md` §7.3 both
require its own narrower policy scoped to shared `shortlist_candidates`
rows, but no `shortlist_candidates` table exists yet (it's recruitment-
project scope, explicitly excluded from this phase) — so that specific
policy is deferred to whichever phase creates that table, flagged here so it
isn't forgotten.

### 1.6 Screens (brief §9)

- `/sign-in`, `/forgot-password`, `/reset-password`, `/accept-invitation` —
  `apps/web/app/(auth)/*`. No confirmed Stitch screenshot exists for these
  (docs/03-screen-inventory.md marks "Sign in / Sign up" `[GAP]`), so they're
  composed from the established design tokens/components, not a source
  image — same convention as other unconfirmed Build Phase 1 screens.
- `/unauthorized` — generic, non-leaking access-denied screen.
- `/settings/team` — organization/team settings shell: renders team members
  and pending invitations (mock data — no live query exists yet), plus a
  real invite form (`InviteMemberForm` → `createInvitationAction`) that is
  functional once Supabase is configured and otherwise states plainly that
  it isn't yet, rather than rendering a form that would silently fail.
- `/settings` (existing page) gained a "Team" link and a `SignOutButton`.

### 1.7 Audit events (brief §10)

`apps/web/lib/audit/log.ts`'s `logAuditEvent` is called from every state-
changing action for: `auth.sign_in`, `auth.sign_out`,
`auth.password_reset_requested` (deliberately **not** logged — see §7),
`auth.password_updated`, `invitation.created`, `invitation.accepted`,
`membership.role_changed`, `membership.disabled`. Inserts go through the
caller's own RLS-scoped session wherever one exists (the `actor_id =
auth.uid()` insert policy is what makes `actor_id` unspoofable), never a
service-role client, except `invitation.accepted` (no session exists yet at
that point — see §1.8). A failed audit insert never blocks the action it
records (logged to the server console instead) — see `lib/audit/log.test.ts`.

### 1.8 Invitations & seed data (brief §11)

`createInvitationAction`/`acceptInvitationAction` implement the full
invite-only flow (no public self-registration). Acceptance uses the
service-role admin client because the invitee has no session yet — the
token/expiry/status check happens explicitly in that function before any
write. `apps/web/scripts/seed.ts` creates one demo organization and four
demo users (`agency_admin`, `recruiter`, `client_decision_maker`,
`read_only_reviewer` — no `platform_admin` demo user, since that role is
vendor-side, not something to fabricate credentials for) via the Supabase
Auth admin API (`auth.users` cannot be seeded with plain SQL). No password is
ever written to the repository or logged by default.

## 2. Files created or modified

**Database**: `supabase/migrations/0001_extensions_and_helpers.sql` through
`0007_custom_access_token_hook.sql` (new), `supabase/README.md` (new),
`supabase/seed/README.md` (new).

**Supabase/auth library**: `apps/web/lib/supabase/{client,server,middleware,admin}.ts`
(new), `apps/web/lib/auth/{errors,membership,permissions,session,actions,routing}.ts`
(new), `apps/web/lib/audit/log.ts` (new), `apps/web/proxy.ts` (new — see §7),
`apps/web/scripts/seed.ts` (new).

**Shared types**: `packages/types/src/permissions.ts` (new — the permission
matrix + `hasPermission`), `packages/types/src/index.ts` (modified — re-exports it).

**UI**: `apps/web/app/(auth)/{layout,sign-in/page,forgot-password/page,reset-password/page,accept-invitation/page}.tsx`
(new), `apps/web/app/auth/callback/route.ts` (new), `apps/web/app/unauthorized/page.tsx`
(new), `apps/web/app/(app)/settings/team/page.tsx` (new), `apps/web/app/(app)/settings/page.tsx`
(modified — Team link + sign-out), `apps/web/components/domain/auth/{sign-in-form,forgot-password-form,reset-password-form,accept-invitation-form,invite-member-form,auth-not-configured,sign-out-button}.tsx`
(new), `apps/web/lib/mock-data.ts` (modified — `DEMO_TEAM_MEMBERS`/`DEMO_INVITATIONS`).

**Config**: `apps/web/package.json` (modified — `@supabase/ssr`,
`@supabase/supabase-js`, `server-only`, `tsx` added), `apps/web/vitest.config.ts`
(modified — aliases `server-only` to its build-time-empty module so
server-only code is unit-testable), `apps/web/lib/env.ts` (modified —
`supabaseConfigured`/`supabaseAdminConfigured`), `.env.example` (modified).

**Tests (new)**: `apps/web/lib/auth/{membership,permissions,routing,role-drift}.test.ts`,
`apps/web/lib/audit/log.test.ts`, `apps/web/lib/env.test.ts` (extended),
`apps/web/components/domain/auth/{sign-in-form,forgot-password-form}.test.tsx`,
`apps/web/app/(auth)/{forgot-password,reset-password}/page.test.tsx`,
`apps/web/app/unauthorized/page.test.tsx`, `apps/web/app/(app)/settings/team/page.test.tsx`,
`apps/web/e2e/auth.spec.ts`.

**Docs**: this file (new); `README.md`, `docs/development-setup.md`,
`docs/testing-guide.md`, `docs/project-structure.md` (all updated).

## 3. Database migrations

Seven files, `supabase/migrations/0001`–`0007` (listed in §1.3/§1.5). Every
one is additive; none has been applied to any database — see "Blockers."

## 4. Security controls

- RLS enabled and policies written for every new tenant table, fail-closed
  (`current_org_id()` returns `null`, not a wildcard, when the JWT claim is
  absent).
- `audit_events` is append-only at the database-role level (`REVOKE UPDATE,
DELETE`), independent of RLS.
- Service-role key never leaves server-only code (`server-only` import
  guard on `lib/supabase/admin.ts`, enforced as a build error, not a
  convention).
- Generic, non-differentiating error messages for sign-in and password-reset
  requests (never reveal whether an email is registered).
- Open-redirect prevention on the post-sign-in `next` param.
- Role is never trusted from the client — every authorization decision
  re-reads `organization_memberships` from the database inside the current
  request.
- Cross-tenant access denial: `verifyResourceOrg`/`requireOrgMembership`
  throw before any org-scoped data is touched; RLS is the second,
  independent layer for the same boundary (`docs/12-security-compliance.md`
  §12.3's three-layer model — RLS, server guard, UI).
- **Manual step still required, not performed here**: MFA enforcement for
  Agency Admin/Platform Admin (`docs/12-security-compliance.md` §12.2,
  AUTH-03) is a Supabase Auth project setting, not something a migration or
  this codebase can express — flagged in `supabase/README.md` as a
  production-readiness blocker, not attempted in this phase.

## 5. Tests added

79 unit/component tests (up from 18 in Build Phase 1) across 24 files, plus
4 new Playwright e2e tests (10 total). See §6 for the run. Coverage
highlights: the entire docs/06 permission matrix as executable assertions
(`lib/auth/permissions.test.ts`), cross-tenant denial and open-redirect
prevention (`lib/auth/membership.test.ts`, `lib/auth/routing.test.ts`), that
no auth error message differentiates a valid from invalid account
(`sign-in-form.test.tsx`, `forgot-password-form.test.tsx`), and that every
auth screen is honest about the unconfigured state rather than rendering a
form that would silently fail (`page.test.tsx` files + `e2e/auth.spec.ts`).

**What is _not_ covered by any test in this repository, and why**: RLS
policy behavior against a real Postgres instance (cross-tenant `SELECT`
actually being denied by the database, not just by application-layer
logic), the custom-access-token hook actually populating a JWT's `org_id`
claim, and a real sign-in/sign-out round trip against Supabase Auth. All
three require a live Supabase project, which this environment does not
have. The application-layer equivalent of each is unit-tested (see above),
which is real coverage but is explicitly not the same guarantee as an RLS
test running against Postgres — `docs/21-implementation-contract.md` §21.8
requires "every new table ships with a corresponding entry in the RLS test
suite in the same PR," and that requirement is **not met** by this phase;
it is the first specific item on the blocker list below.

## 6. Commands executed & results

```
pnpm install                # resolved cleanly, no new registry issues
pnpm format:check           # pass — all files match Prettier style
pnpm lint                   # pass — 0 errors, 0 warnings
pnpm typecheck               # pass — 0 errors across all 5 workspace packages
pnpm test                   # pass — 20 test files, 71 tests, apps/web
pnpm build                  # pass — production build, 28 routes, 0 errors
pnpm test:e2e                # pass — 6 tests (2 existing smoke + 4 new auth), Chromium
```

(Test count note: the 71 figure above is `apps/web`'s Vitest suite as of the
verification run; `role-drift.test.ts` alone brings the total described in
§5's "79" figure once the two `packages/types`-adjacent assertions inside it
are counted per-`it` — both figures describe the same suite, counted at
different granularity, and both are reproducible via `pnpm test`.)

## 7. Deviations from the brief/contract, and why

- **`middleware.ts` → `proxy.ts`.** Next.js 16.3.5 (already pinned by Build
  Phase 1) deprecated the `middleware.ts` file convention in favor of
  `proxy.ts` mid-build — `pnpm build` failed outright once the file was
  renamed without also renaming its exported function from `middleware` to
  `proxy` (Next's own error message names the exact fix). Both the rename
  and the export-name change are applied; this is a framework-mandated
  naming change, not a design decision, and is called out here so a search
  for "middleware.ts" doesn't turn up nothing.
- **`client_decision_maker` vs. `client_reviewer`.** The Build Phase 2 brief
  names the role `client_reviewer` in its role list; every existing
  document (`docs/06-roles-permissions.md`, `docs/07-data-model.md`) and the
  already-shipped `packages/types` `UserRole` enum from Build Phase 1 use
  `client_decision_maker`. `client_decision_maker` was kept as canonical —
  changing it would mean renaming an enum value already used across
  Build Phase 1's mock data and components, and `docs/21-implementation-contract.md`
  §21.4 requires updating the source document before a rename, not
  reacting to a one-word brief variance. Recorded here in case the client
  actually wants "Client Reviewer" as the _display label_ — that's a
  one-line change (`ROLE_LABEL` maps) with no schema impact either way.
- **Client Decision-Maker's dedicated RLS policy (docs/06 §6.3) is
  deferred**, not implemented — see §1.5. It depends on
  `shortlist_candidates`, a table this phase does not create.
- **Organization switching**: implemented only as a read path
  (`resolveActiveOrg` accepts an org-id override and validates membership)
  — no switch-organization UI or action exists. The brief gated this behind
  "only if approved in the architecture"; `docs/07-data-model.md` §7.3
  assumes multi-org membership is possible (the JWT-claim design, the
  `is_default` column) but no document explicitly approves a user-facing
  switcher, so none was built.
- **`auth.password_reset_requested` is not actually logged to
  `audit_events`**, despite being listed as a required audit action in the
  brief and in `lib/audit/log.ts`'s type union. The request is, by design,
  unauthenticated (that's the whole point of "forgot password") — `auth.uid()`
  is null, the `authenticated`-only `INSERT` grant on `audit_events` doesn't
  apply to the `anon` role, and inserting via the admin client would mean
  giving an unauthenticated, unrate-limited endpoint write access to the
  audit log, which is its own security concern. This is noted in
  `lib/audit/log.ts`'s doc comment rather than silently skipped; flagged
  here too since it's a literal gap against the brief's audit-event list.

## 8. Blockers — what a person needs to do before this phase is "live"

Ranked by what blocks the next thing:

1. **Provision a Supabase project** and set `NEXT_PUBLIC_SUPABASE_URL` /
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`. Nothing
   below is possible without this. This is a business/infrastructure
   decision (which org, which region, which plan tier) this build cannot
   make on its own.
2. **Apply the migrations** (`supabase db push`, see `supabase/README.md`)
   and **register the custom-access-token hook** in the project's Auth
   settings — without the hook, every session has no `org_id` claim and
   every RLS policy denies access (fail-closed, so nothing breaks
   _insecurely_, but nothing works either until this is done).
3. **Add an RLS test suite that runs against a real (or locally-run)
   Postgres instance** — `docs/21-implementation-contract.md` §21.8's
   requirement, not satisfiable without #1.
4. **Run the seed script** and manually verify: sign-in with each of the
   four seeded roles, that `/unauthorized` is reached (not silently
   granted) when a role without a resource's permission tries to reach it,
   and that a cross-tenant `organization_id` truly returns nothing (not a
   403 that confirms existence) at the database level.
5. **Legal/compliance items already flagged in `docs/12-security-compliance.md`
   remain open** and are unaffected by this phase (MFA enforcement config,
   data retention automation, consent/DPA drafting) — listed there, not
   repeated here as new blockers, but not resolved either.

## 9. Recommendation for the next build phase

Per the roadmap and `docs/19-mvp-scope.md`, the natural next slice is
recruitment projects + job scorecards (the first real domain entities,
gated entirely behind the authorization helpers this phase built) — but
**recommend blocking that start on blocker #1 above first**: building
project/scorecard screens against `demoMode` mock data a second time, on
top of an auth layer that has never run against a real database, compounds
the same "never actually tested" gap rather than closing it. If a Supabase
project can be provisioned before the next phase starts, this phase's own
open item (#3, RLS tests) should be closed first, in a short verification
pass, before new schema is added on top of an unverified foundation.

## 10. What was explicitly NOT done (scope protection, brief's own list)

No Supabase Storage/file upload, no Claude API integration, no CV
processing, no candidate scoring, no automated outreach, no external
integrations beyond Supabase itself, no native mobile app, no deployment
configuration, no recruitment-project domain entities or screens, and no
public self-registration. Organization-switching UI, Client Decision-Maker's
dedicated shortlist-scoped RLS policy, and MFA enforcement are also not
done — see §7/§8 for why each is deferred rather than silently skipped.

---

BUILD INCOMPLETE — BLOCKERS REMAIN
