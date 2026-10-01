# Build Phase 3 report — clients, recruitment projects & job intake

Per docs/21-implementation-contract.md §21.14 and the Build Phase 3
completion gate ("I approve the Recruitment Projects and Job Intake
build... Apply the Mandatory Completion Gate"). Covers exactly what this
phase implements: client management, recruitment projects, job intake,
job-description intake (paste/upload, no AI extraction), file security, the
required screens, and their tests. AI requirement extraction and candidate
functionality are explicitly out of scope (brief: "Do not implement AI
requirement extraction or candidate functionality") and are untouched.

**The single most important fact in this report, carried over unchanged
from Build Phase 2**: no live Supabase project is connected to this
repository's environment (confirmed again at the start of this phase — no
`apps/web/.env.local`, no `SUPABASE_*` environment variables, no connector,
nothing else on disk containing a Supabase URL or key). Every migration,
every server action, and every screen below is written to spec, typechecks,
lints, and is tested at the logic/component layer — but **none of it has
been executed against a real Postgres/Supabase instance**. Per the project
instructions ("Never claim an external integration works until it has been
configured and tested"), this is reported as the phase's central blocker,
not glossed over.

## 0. Pre-build verification

Brief: "First confirm authentication, tenant isolation and permission tests
pass."

Before any new code, the full Build Phase 2 verification suite was re-run
against the untouched repository: `pnpm format:check`, `pnpm --filter web
lint`, `pnpm --filter web typecheck`, `pnpm --filter web test` (71/71
passing). All green — confirmed before building on top of it.

## 1. What was implemented

### 1.1 Database schema + RLS (migrations `0008`–`0014`)

| Migration                       | Adds                                                                                                                                                                       |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0008_clients.sql`              | `clients` table; `organization_memberships.client_id` column (links a Client Decision-Maker to the one client they represent)                                              |
| `0009_recruitment_projects.sql` | `recruitment_projects` (client, target shortlist size, match threshold, `is_draft`, `archived_at`); agency_admin/read_only_reviewer/client_decision_maker (own client) RLS |
| `0010_jobs.sql`                 | `jobs` — every field in the brief's Job intake list; same RLS shape as projects                                                                                            |
| `0011_job_descriptions.sql`     | `job_descriptions` (versioned, paste/upload, supersede-not-delete) + `document_uploads` (shared file-security metadata)                                                    |
| `0012_project_assignments.sql`  | `project_assignments`, `is_assigned_to_project()`, and the deferred recruiter row-level policies on projects/jobs/JDs/uploads                                              |
| `0013_project_activity.sql`     | `project_activity` — the user-facing activity feed, append-only at the DB-role level like `audit_events`                                                                   |
| `0014_document_storage.sql`     | Private `documents` Storage bucket + `storage.objects` RLS; extends `audit_events.action`'s documented verb list                                                           |

Every tenant table carries `organization_id` and RLS, per the project's
standing rule. `supabase/README.md` now flags the two migrations
(`0008`, `0014`) worth a moment's attention on a production apply (neither
is destructive — see that file for specifics).

### 1.2 Row-level project scoping (brief §PERMISSIONS)

docs/06-roles-permissions.md §6.2 gives Recruiter a flat "F" on recruitment
projects/clients/job descriptions, org-wide. This brief narrows that for
recruitment projects specifically: **"Recruiters can access assigned
projects"** — not every project in the org. Implemented in two layers:

- **RLS** (`0012_project_assignments.sql`): `is_assigned_to_project()`
  gates `recruitment_projects`/`jobs`/`job_descriptions`/`document_uploads`
  for the `recruiter` role specifically (agency_admin/read_only_reviewer
  remain org-wide).
- **Application layer** (`apps/web/lib/auth/project-scope.ts` +
  `project-access.ts`): a pure, unit-tested `canAccessProject()` mirrors the
  RLS decision, so a server action can return a friendly "not found" error
  before ever issuing a query RLS would just as correctly reject.

Client Decision-Maker's existing "R (own client's)" is made concrete the
same way, via the new `client_id` column, rather than left as an
unenforceable aspiration.

This is recorded as an explicit decision in docs/06-roles-permissions.md
§6.2.1, not a silent reinterpretation of the existing matrix.

### 1.3 File security (brief §"File security")

- `apps/web/lib/files/validate.ts` — pure, dependency-free allow-list
  validator: PDF/DOCX only, size ceiling, blocked-extension list
  (defense in depth), and an extension↔MIME cross-check that catches a
  renamed-executable spoofing attempt the extension check alone would miss.
  13 unit tests, including exactly that spoofing case.
- `apps/web/lib/files/storage.ts` — uploads to a private bucket under a
  tenant-prefixed, random-suffixed path (never guessable from an entity id);
  every read is a 5-minute signed URL minted under the caller's own
  session, never a public URL and never the service-role client.
- Uploaded documents are treated as untrusted input throughout (project
  AI-safety rule) — reinforced explicitly in code comments at every touch
  point, ahead of the AI-extraction step a later phase will add.

### 1.4 Server actions

- `lib/clients/actions.ts` — create/update/archive (blocked while the
  client has open projects), plus linking a Client Decision-Maker
  membership to their one client.
- `lib/projects/actions.ts` — create (with save-as-draft), update, archive,
  assign/unassign a recruiter.
- `lib/jobs/actions.ts` — create/update, covering every field in the brief's
  Job intake list, with a server-side min/max salary sanity check.
- `lib/job-descriptions/actions.ts` — paste and upload, both versioned
  (supersede-not-delete per docs/07-data-model.md §7.5).

Every write: Zod-validated input, `requirePermission` (never a bespoke role
check), `requireProjectAccess` where row-level scoping applies, an
`audit_events` row, and (for project-scoped actions) a `project_activity`
row — never a business write without both, matching the audit-event
convention established in Build Phase 2.

### 1.5 Screens

| Screen                   | Route                                            | Notes                                                                                                                         |
| ------------------------ | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Client list              | `/clients`                                       | search + status filter, empty/no-match states                                                                                 |
| Client detail            | `/clients/[clientId]`                            | edit form + linked projects + archive                                                                                         |
| New client               | `/clients/new`                                   |                                                                                                                               |
| Recruitment project list | `/projects`                                      | now live-query-aware (was static demo data); search/status filter/archived toggle                                             |
| Create project           | `/projects/new`                                  | client select, POC toggle, shortlist size, match threshold, save-as-draft                                                     |
| Project details          | `/projects/[projectId]`                          | now shows Jobs, links to Activity/JD upload/scorecard, archive action, alongside the existing candidate pipeline from Phase 1 |
| Job intake wizard        | `/projects/[projectId]/jobs/new`                 | every field in the brief's list                                                                                               |
| Job-description upload   | `/projects/[projectId]/jobs/[jobId]/description` | paste/upload toggle, version history sidebar                                                                                  |
| Project activity         | `/projects/[projectId]/activity`                 |                                                                                                                               |

Every screen renders real, RLS-scoped data once Supabase is configured and
falls back to demo fixtures otherwise — the same convention Build Phase 2
established (`supabaseConfigured` branch, honest "requires a configured
Supabase project" messaging, never a silently broken form). Loading states
reuse the existing route-level `loading.tsx` convention where applicable;
empty/error/permission-denied states are explicit on every new list/detail
screen (`EmptyState`, the generic `/unauthorized` redirect via
`requireAuth`/`requireProjectAccess`, and per-field validation errors).

**Mobile**: "Mobile project list"/"mobile project details" are the same
responsive routes as their desktop counterparts (Tailwind breakpoints), not
separate screens — this matches the pattern already established for every
other Build Phase 1/2 screen in this app (dashboard, candidates, etc.),
where "desktop vs. mobile" is a CSS concern, not a routing one. "Clients"
is not one of the Stitch-defined primary-nav destinations
(`docs/03-screen-inventory.md`); rather than restructure that nav, it was
added to the mobile "More" screen and as a secondary link on the desktop
Projects screen — a deliberate, minimal, explained addition, not a
redesign (`apps/web/lib/nav.ts` comment).

### 1.6 Seed data

`apps/web/scripts/seed.ts` extended: two demo clients, the demo Client
Decision-Maker linked to one of them (`client_id`), a demo recruitment
project, a `project_assignments` row for the demo recruiter, a demo job,
and a pasted job description — so the RLS test matrix below has real rows
to exercise the moment a live project exists. Still requires
`SUPABASE_SERVICE_ROLE_KEY`; still cannot be run in this environment.

## 2. Tests added

33 new unit/component tests (104 total, up from 71), all passing:

- `lib/files/validate.test.ts` (13) — format allow-list, size limit,
  executable rejection, extension/MIME spoofing, storage-path safety.
- `lib/auth/project-scope.test.ts` (12) — every role × every access
  scenario in the row-level scoping matrix, plus the "denial never confirms
  existence" property Build Phase 2 established for cross-tenant errors.
- `components/domain/clients/clients-list.test.tsx` (4) — search/filter,
  the two distinct empty states.
- `components/domain/projects/job-description-form.test.tsx` (4) — mode
  toggle, correct action dispatch per mode, server-side rejection messages
  surfaced verbatim.

Plus `apps/web/e2e/recruitment-projects.spec.ts` (4 new Playwright tests,
10 total e2e, all passing) — the same "honest demo mode" pattern as
`e2e/auth.spec.ts`: Clients list + search, Projects → Clients link, a
project's Jobs/Activity links, the JD screen's version list, and Clients
reachable from the mobile More screen.

**Not covered by an automated test in this environment, because it
requires a live database**: the CRUD server actions themselves (consistent
with Build Phase 2's convention — `lib/auth/actions.ts` isn't directly unit
tested either; only the pure decision logic it calls is), the live RLS
policies in `0008`–`0014`, real file upload/signed-URL round-trips, and the
extended seed script.

## 3. Commands run (verification gate)

```
pnpm format:check     PASS
pnpm --filter web lint          PASS (0 errors, 0 warnings)
pnpm --filter web typecheck     PASS
pnpm --filter web test          PASS — 104/104 (24 files)
pnpm --filter web build         PASS — 34 routes compiled/prerendered
pnpm --filter web test:e2e      PASS — 10/10 (Chromium, production build)
```

## 4. Known limitations / deferred

- **No live database verification** (see the top of this report) — the
  single largest blocker, unchanged in kind from Build Phase 2.
- **JD text extraction for uploads is not implemented.** The brief says
  "Do not implement AI extraction yet," and a _non_-AI deterministic
  text-layer extraction step (e.g. a PDF/DOCX text-layer library) has not
  been installed or verified in this environment either — the original
  file is stored correctly and completely; `raw_text` stays null with
  status `draft` until that step exists. Flagged in
  `lib/job-descriptions/actions.ts`'s doc comment, not silently gapped.
- **Magic-byte file sniffing is not implemented.** `validate.ts` checks
  file name, extension, declared MIME type, and their mutual consistency —
  it cannot inspect actual file bytes (a pure, dependency-free module has
  no file to read). A byte-level check (e.g. a PDF/DOCX signature check) is
  a reasonable follow-up hardening step, not currently present.
- **No dedicated "assign recruiter" or "link client reviewer" UI** — both
  actions exist and are tested at the logic layer
  (`assignRecruiterAction`, `assignClientReviewerAction`), but no screen
  calls them yet. Not required by the brief's explicit screen list; noted
  here so it isn't mistaken for an oversight.
- **`clients` and `recruitment_projects` migrations are additive-only
  and unapplied** — same caveat as every migration in this repository.

## 5. Recommendation for next build

Do not start Build Phase 4 (candidate sourcing/parsing/scoring, which the
project brief explicitly gates behind live evidence-based matching) until
either (a) a live Supabase project is connected and Steps equivalent to the
Build Phase 2 live-verification brief are run against this phase's schema
and RLS too, or (b) the person explicitly accepts proceeding without that
verification. A live RLS test matrix for the new row-level scoping
(recruiter-assigned-projects, client-decision-maker-own-client) is
especially valuable given it's new, brief-mandated behavior with no
precedent in Build Phase 2's matrix to fall back on.

---

**BUILD PHASE 3: BUILD INCOMPLETE — BLOCKERS REMAIN**

(Code-complete, fully typechecked/linted/formatted, 104 unit + 10 e2e tests
passing, production build succeeds. Incomplete only in the sense Build
Phase 2 was: no live Supabase project has been connected in this
environment, so the migrations, RLS policies, and live-data code paths have
never been executed against a real database. The blocker is identical in
kind to Build Phase 2's, not a new one introduced by this phase.)
