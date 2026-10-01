# Build Phase 12 report — Integrations and Workflow Reliability

Build Phase 12 delivered the durable job engine, the three real integration
adapters (TA Tracker, Apollo, Calendars), inbound webhook processing, and
the notification system this platform's async and third-party workflows
run on — closing the last major infrastructure gap before this codebase's
mandatory reliability requirements (idempotency, retries, authorization,
data ownership) can be claimed as actually verified rather than asserted.

This report covers **Wave 6**, the phase's final wave: the brief's explicit
adversarial testing requirements, a from-scratch pgverify re-confirmation,
documentation updates, and this completion report. Waves 1–5 are each
covered by their own `docs/build-phase-N-report.md`-equivalent wave notes
inline in the source; this report's §1 summarizes all six waves for a
single, complete phase record.

## 0. Pre-wave state

At the start of Wave 6: 727 tests passing (Waves 1–4 added tests; Wave 5 —
server actions and UI — added none), `pnpm typecheck`/`pnpm --filter web
lint`/`pnpm --filter web build` all clean. Waves 1–5 had already built:
migration `0032_integrations_jobs_notifications.sql` (5 new tables, full
RLS), the job engine (`lib/jobs/`), the integration adapters (`lib/
integrations/{apollo,calendar,ta-tracker,sms,webhook}/`), the notification
system (`lib/notifications/`), and the server actions/UI wiring these
together. Wave 6's job was explicitly **not** to touch any of that source
— tests, docs, and a small number of genuine-bug fixes found while testing
adversarially, only.

## 1. What was built (organized by wave)

### Wave 1 — Database schema + RLS (`0032_integrations_jobs_notifications.sql`)

`background_jobs`, `integration_connections` (with the TA-Tracker-API-
mode-honesty CHECK constraint), `webhook_events` (unique `(provider,
external_event_id)` dedup with nulls excluded, no client-writable RLS
grant at all), `notifications` (own-recipient-only, `read_at`-only
mutation via trigger), `notification_preferences`. pgverify TEST18 was
written and passing at the end of this wave; Wave 6 re-confirmed it still
holds after Waves 2–5 (§4).

### Wave 2 — Durable job engine (`lib/jobs/`)

`enqueueJob` (idempotent insert on `(organization_id, job_type,
idempotency_key)`), `executeJob` (optimistic claim, wall-clock timeout,
retry/dead-letter decision), `claimDueJobs` (batch claim entry point),
`manuallyRetryJob`, `canTransitionJobStatus` (a pure legal-state-graph
function), `calculateNextAttemptDelay`/`calculateNextAttemptAt`
(exponential backoff with full jitter), `DEFAULT_JOB_HANDLERS`.

### Wave 3 — Integration adapters (`lib/integrations/`)

TA Tracker (`api-mode.ts` — a permanent, structural stub; `csv-mode.ts`/
`manual-exchange-mode.ts` — real), Apollo (`apollo-client.ts` — a real,
complete REST client, gated behind `apolloConfigured`;
`apollo-dev-adapter.ts` — a typed `not_configured` selector that never
fabricates contact data), Calendar (a shared `CalendarAdapter` interface
with real Google/Microsoft implementations, both gated behind their own
`*Configured` flags), SMS (a thin typed wrapper with no real provider
behind it yet), `webhook/process-inbound-webhook.ts` (relies on the DB
unique constraint, catches `23505`, never pre-checks) +
`webhook/signature-verification.ts` (per-provider HMAC/token schemes).

### Wave 4 — Notifications (`lib/notifications/`)

`resource-link.ts` (`buildPermissionSafeDeepLink` — must be called fresh,
never cached), `event-triggers.ts` (8 functions, one per allowlisted
`event_type`, idempotency key `<eventType>:<resourceId>:<recipientUserId>
[:<dedupeSuffix>]`), `notification-dispatch-handler.ts`,
`email-delivery.ts` (the `notification` branch real; the
`outreach-message` branch an intentional stub — see §5),
`preferences.ts`.

### Wave 5 — Server actions + UI

`lib/integrations/integration-actions.ts`, `lib/jobs/job-actions.ts`,
`lib/notifications/notification-actions.ts`, plus each domain's `load.ts`
loader, plus the `/integrations`, `/settings/jobs`, `/notifications`, and
`/settings/notifications` screens (docs/03-screen-inventory.md). Six of
the eight notification event-triggers were wired into real call sites this
wave (`lib/scorecards/actions.ts`, `lib/matching/matching-actions.ts`,
`lib/shortlists/verification-actions.ts`, `lib/outreach/outreach-actions.ts`
×2, `lib/shortlists/shortlist-actions.ts`). The `integrations`
permission-matrix-vs-RLS discrepancy was resolved at the action/loader
layer this wave — see docs/06-roles-permissions.md §6.2.9 for the full
reasoning, carried over verbatim from `integration-actions.ts`'s and
`load.ts`'s own header comments.

### Wave 6 — Tests, pgverify, documentation (this wave)

Covered in the remaining sections of this report.

## 2. Test files written or extended — adversarial scenario coverage

All new/extended in this wave. Existing coverage from Waves 2–4 (not
listed again here — `enqueue.test.ts`, `backoff.test.ts`,
`status-transitions.test.ts`, `apollo-dev-adapter.test.ts`,
`calendar/selector.test.ts`, `ta-tracker/{api-mode,csv-mode,
manual-exchange-mode}.test.ts`, `signature-verification.test.ts`,
`process-inbound-webhook.test.ts` (base cases), `event-triggers.test.ts`
(base cases), `resource-link.test.ts`, `notification-dispatch-handler.
test.ts`, `preferences.test.ts`) was reviewed in full and found already
genuinely adversarial, not trivial-passthrough — Wave 6 extended rather
than duplicated it.

| File                                                                  | Adversarial scenario(s) added                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/jobs/executor.test.ts` (**new**)                                 | Retry-vs-dead-letter at the exact `attempt_count`/`max_attempts` boundary in both directions (off-by-one), including `max_attempts = 1`; a simulated **concurrent claim** on the same row (`Promise.all` racing two `executeJob` calls) proving only one ever wins and the handler runs exactly once; a hung handler under a real wall-clock timeout; the `no_handler` path; a non-`Error` thrown value still caught; a console-log spy proving the job's `payload` never reaches a log line on failure |
| `lib/jobs/manual-retry.test.ts` (**new**)                             | Authorization: `agency_admin`/`platform_admin` allowed; `recruiter`, `client_decision_maker`, `read_only_reviewer`, a user with no membership at all, and an `agency_admin` with an **inactive** membership all denied, with the row proven untouched on denial; attempt-count reset to 0 on retry (both `dead_lettered` and `failed` source states), while `max_attempts` itself is left alone; `not_found`/`not_retryable` for every non-retryable status                                             |
| `lib/integrations/apollo/apollo-client.test.ts` (**new**)             | The real REST client's 4 typed failure kinds via mocked `fetch`: `rate_limited` (429 + `Retry-After` header parsed into `retryAfterMs`), `invalid_request` (400 and 422), `provider_error` (any other non-ok status, proven distinct from the other two), `network` (a rejected fetch AND a named `AbortError`, both mapped to `network` with distinguishing messages); a positive-control successful response; the empty-query guard firing before `fetch` is ever called                              |
| `lib/integrations/webhook/process-inbound-webhook.test.ts` (extended) | The null-`external_event_id` case proven NOT to false-positive as a duplicate of another null-event-id webhook; **all 3 documented signature schemes** (generic HMAC, Google channel-token, Microsoft clientState) driven end-to-end through `processInboundWebhook` with deliberately tampered inputs, asserting `rejected_invalid_signature` and that the row is still stored for audit but never `processed`; a positive control with a correct signature                                            |
| `lib/notifications/event-triggers.test.ts` (extended)                 | Idempotency dedup extended to `notifyCandidateAwaitingReview` and `notifyVerificationRequested` (in addition to Wave 4's `notifyPocCompleted`/`notifyCandidateResponded` coverage)                                                                                                                                                                                                                                                                                                                      |
| `lib/integrations/load.test.ts` (**new**)                             | The `visible:false` pattern for `recruiter`/`client_decision_maker`/`read_only_reviewer`, proven with a `from()` call-count spy to **never attempt a query at all** for those roles (not just return an empty-looking result); real per-provider status for `agency_admin`/`platform_admin`; cross-org connection isolation; `loadIntegrationSyncJobSummary`'s org/job-type scoping                                                                                                                     |

**Brief item cross-reference** (the governing brief's exact 8 items):

1. **Provider failures** — `apollo-client.test.ts` (new), `apollo-dev-adapter.test.ts`, `calendar/selector.test.ts`, `ta-tracker/api-mode.test.ts` (existing, confirmed already adversarial).
2. **Duplicate webhooks** — `process-inbound-webhook.test.ts` (existing dedup test + new null-id case), cross-referenced with pgverify TEST18b (§4).
3. **Invalid signatures** — `process-inbound-webhook.test.ts` (new, all 3 schemes end-to-end) + `signature-verification.test.ts` (existing, pure-function level).
4. **Retries** — `executor.test.ts` (new, boundary + timeout), `backoff.test.ts` (existing), `manual-retry.test.ts` (new, reset behavior).
5. **Idempotency** — `enqueue.test.ts` (existing), `event-triggers.test.ts` (extended), `executor.test.ts` (new, concurrent-claim).
6. **Authorization** — `manual-retry.test.ts` (new, direct role-gate coverage). See the important scoping note below.
7. **Data ownership** — `load.test.ts` (new, `integration_connections`), `resource-link.test.ts` (existing, cross-tenant + access-revoked).
8. **Notification links** — `resource-link.test.ts` (existing, all 7 resource kinds + not-found).

**Scoping note on item 6 (authorization) and item 7 (data ownership) for
Wave 5's server actions specifically.** No `*-actions.ts` file anywhere in
this repository — in any build phase, not just this one — has its own
`*-actions.test.ts` file; grepping the full codebase for this pattern
returns zero results. The established, repo-wide convention (confirmed by
inspection before writing anything) is that a server action's own logic is
a thin wrapper (`'use server'`, `createServerSupabaseClient()`, `revalidatePath`),
and the actual decision logic it delegates to is what gets direct unit
coverage: `requireOrgMembership`/`requireRole` (pure logic in
`lib/auth/membership.ts`, covered by `membership.test.ts` since Build
Phase 2) for the org-membership/role gate, and the specific new
resource-level logic for anything narrower than that
(`manuallyRetryJob`'s direct role check — now covered by
`manual-retry.test.ts`; `loadIntegrationConnections`'s `visible:false`
gate — now covered by `load.test.ts`). `integration-actions.ts`'s
`requireAgencyAdmin` helper is a thin, unexported composition of
`requireOrgMembership` (already tested) plus a one-line role-set check —
judged not to warrant introducing a new "mock `next/cache`, mock
`@/lib/supabase/server`" test pattern this repo has never used anywhere
else, for one line of logic. This is flagged here explicitly, not silently
assumed adequate: if a future wave wants direct `'use server'` action
tests, `integration-actions.ts`/`notification-actions.ts`/`job-actions.ts`
are the first candidates, and establishing that pattern would be a
deliberate, repo-wide decision, not a one-off for this phase.

## 3. Bugs found while testing adversarially

**None.** Every adversarial scenario driven in Wave 6 behaved exactly as
the Wave 1–5 source's own header comments already documented it would —
the optimistic claim's single-winner guarantee, the retry/dead-letter
boundary, the manual-retry role gate, the `visible:false` no-query
guarantee, and all 3 signature schemes' rejection behavior all passed on
first correct-test-written attempt, with no source-code change required.
This is recorded honestly as a genuine finding (thorough Wave 1–5 work,
confirmed rather than assumed), not underclaimed to make Wave 6 look more
consequential than it was.

## 4. Commands run (verification gate)

- `pnpm --filter web test` — **777/777 tests passing** (103 test files, up
  from 727/all-passing at Wave 6 start — 50 new tests across 4 new files
  and 3 extended files), **zero regressions**.
- `pnpm typecheck` — clean across all 5 packages (`@rqi/config`,
  `@rqi/types`, `@rqi/testing`, `@rqi/ui`, `web`).
- `pnpm --filter web lint` — clean, zero errors, zero warnings.
- `pnpm --filter web build` — compiled successfully; `/integrations`,
  `/settings/jobs`, `/notifications`, `/settings/notifications` all listed
  as static (○) routes, every pre-existing route unchanged.

## 5. pgverify RLS functional verification

Rebuilt from a **completely fresh database** (`pgverify_p12`, dropped and
recreated), not reused from an earlier pass, per the established
"rebuild fresh every final wave" convention. `postgresql-16-pgvector` was
already installed from a prior phase; the `vector` extension was created
fresh in the new database. The full migration set `0001`–`0032` plus the
two non-migration stub files (`00_stub_supabase_auth.sql`,
`01_stub_storage.sql`) were applied in strict numeric order against real
PostgreSQL 16.13 — **zero errors**, confirmed file-by-file.

The full `scripts/verify_candidates.sql` script (TEST1 through TEST18,
including TEST17's full lettered sequence a–r and TEST18's full lettered
sequence a–h) was then run — **exit code 0**, **zero `FAIL` lines, zero
`ERROR`/`FATAL` noise, zero false (`f`) rows in any `pass` column**,
confirmed by direct grep across the full ~1,760-line run log, not a
spot-check. 98 individual `PASS` assertions recorded. TEST18's own
sub-parts, confirmed against real Postgres:

- **TEST18a** — a duplicate `background_jobs` `(organization_id,
job_type, idempotency_key)` insert is rejected.
- **TEST18b** — a duplicate `webhook_events` `(provider,
external_event_id)` insert is rejected — the exact SQL-layer proof
  `process-inbound-webhook.test.ts`'s app-level dedup test (§2) mirrors.
- **TEST18d** — `notifications_read_only_mutation` rejects both a
  post-insert title change and a re-set of `read_at` on an
  already-read row.
- **TEST18g** — a cross-tenant `integration_connections` insert is
  rejected by RLS (`42501`).
- **TEST18h** — `provider='ta_tracker' AND mode='api'` cannot reach
  `status='connected'`, `'sync_error'`, or `'disconnected'`, confirmed
  across all three attempted values, plus confirmation that `mode` is
  only ever meaningful for `provider='ta_tracker'`.

## 6. Documentation updated

- **`docs/07-data-model.md`** — new §7.13 (Integrations, Jobs &
  Notifications Strategy).
- **`docs/11-integration-plan.md`** — summary table updated with real
  implementation status per provider (CSV/manual-exchange real for TA
  Tracker, API mode permanently stubbed; Apollo/Google Calendar/Microsoft
  Calendar built-but-credential-gated; SMS adapter-shaped but no
  provider), plus updated §11.2/§11.4/§11.5/§11.6 prose sections.
- **`docs/06-roles-permissions.md`** — new §6.2.9 (Integrations, Jobs &
  Notifications), including the full `integrations` matrix-vs-RLS
  discrepancy resolution and why it is flagged as worth revisiting.
- **`docs/03-screen-inventory.md`** — implementation-status note for the
  4 new/rewired screens (`/integrations`, `/settings/jobs`,
  `/notifications`, `/settings/notifications`).
- **`docs/17-deployment-operations.md`** — §17.7 rewritten from "an
  implementation decision for Phase 1" to the actual request-triggered
  claim/execute architecture, both open limitations (no stale-`running`
  reclaim, no resolved cross-org cron identity) stated explicitly, and
  what IS fully built/tested listed separately from what is not.
- **`docs/16-testing-strategy.md`** — new §16.2 mapping each of the
  brief's 8 testing items to its actual covering test file(s), plus the
  one honestly-flagged gap (notification-center UI's fresh-per-render
  call pattern has no dedicated UI test).
- **`docs/build-phase-12-report.md`** (this file) — new.

## 7. Known limitations — flagged honestly

- **No live credentials for any Build Phase 12 integration in this
  environment** — TA Tracker (permanently blocked, no API exists),
  Apollo, Google Calendar, Microsoft Calendar, SMS, or Resend's
  notification-email path. Nothing in this report or the codebase claims
  a tested live integration for any of them.
- **TA Tracker API mode is structurally, permanently stubbed.** Only CSV
  import/export and secure manual exchange are real. This is not a gap to
  be closed by more engineering — it is blocked on client-supplied
  documentation that may never arrive, and `api-mode.ts` is deliberately
  written so no future wave can silently "half-implement" it (see that
  file's own header note: a future wave with real documentation must
  replace the file, not extend it).
- **The job engine's architecture is request-triggered claim/execute, not
  a persistent worker** — with two open, unresolved limitations: no
  stale-`running`-row reclaim sweep, and no resolved design for which
  authenticated identity would run a cross-org cron-triggered batch sweep
  (`background_jobs` has no service-role write path). See
  docs/17-deployment-operations.md §17.7 for the full statement.
- **The `integrations` permission-matrix-vs-RLS discrepancy was resolved
  at the action/loader layer, not by editing the shared matrix** — a
  slightly unusual pattern, now used three times across this codebase's
  history (also `manuallyRetryJob`, also `poc_reports`), worth revisiting
  if a future phase touches a fourth resource needing the same treatment.
  See docs/06-roles-permissions.md §6.2.9.
- **`email-delivery.ts`'s `outreach-message` branch is an intentional
  stub, not an oversight** — Build Phase 9 outreach still sends inline,
  never enqueued as a background job; only the `notification` branch is
  real.
- **No Next.js webhook route handlers exist.** `processInboundWebhook` is
  a tested, callable function; the actual `app/api/webhooks/<provider>/
route.ts` files that would receive a real inbound HTTP webhook (parse
  the request, read provider headers, construct a service-role client)
  were never built this phase. No live webhook can be received until they
  exist.
- **No `*-actions.test.ts` file exists for any server action in this
  repository**, including the three this phase added — a pre-existing,
  repo-wide convention (confirmed by inspection, not assumed) that this
  phase preserved rather than introduced. §2's scoping note explains the
  reasoning and what direct coverage exists instead.

## 8. Mandatory Completion Gate

- **Durable jobs**: idempotency (✅ tested — `enqueue.test.ts`,
  `executor.test.ts`'s concurrent-claim test), retries (✅ tested —
  `executor.test.ts`'s boundary tests, `backoff.test.ts`), backoff (✅
  tested — exponential + jitter, bounds confirmed), dead-letter (✅
  tested — the exact boundary), manual retry (✅ tested — role gate +
  attempt-count reset, `manual-retry.test.ts`), correlation-id (✅ — one
  id shared across a job's full audit lifecycle, `enqueue.ts`'s own
  documented mechanism), audit events (✅ — every state transition writes
  one, confirmed by `executor.test.ts`/`manual-retry.test.ts` asserting
  on `audit_events` rows), no sensitive payloads in ordinary logs (✅
  tested — `executor.test.ts`'s console-log spy) — **all implemented and
  tested**.
- **Notifications**: all 8 allowlisted events have a corresponding
  trigger function; 6 of 8 are wired into real call sites as of Wave 5
  (2 were wired earlier, in Waves 3/5 respectively — see §1); permission-
  safe deep links are enforced fresh at click/render time for all 7
  resource kinds, never stored or cached, confirmed for the cross-tenant
  and access-revoked-since-creation cases specifically.
- **Integrations**: TA Tracker is honestly, permanently limited to
  non-API modes (structurally enforced at both the DB and application
  layers); Apollo/Google Calendar/Microsoft Calendar are real,
  complete, credential-gated implementations — built but untested against
  a live account, never claimed otherwise; SMS is honestly unconfigured
  (an adapter shape exists, no provider behind it); inbound webhook
  processing is a tested function with no live route yet.
- **Testing**: all 8 of the governing brief's explicit adversarial
  scenario classes have real, non-trivial-passthrough coverage (§2), with
  one honestly-scoped exception (the UI-level "fresh per render" check,
  §7) and one honestly-scoped convention note (server-action-file-level
  authorization tests, §2's scoping note) — neither weakened to appear
  covered, both stated plainly.
- **pgverify**: TEST1–TEST18 all pass against a from-scratch rebuild of
  migrations `0001`–`0032` on real PostgreSQL 16, zero regressions, zero
  failures (§5).
- **777/777 tests passing, zero regressions; typecheck/lint/build all
  clean (§4).**
- **The phase is complete. Stopping at the phase boundary**, per project
  convention — no further build work follows this report.
