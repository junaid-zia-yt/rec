# Monitoring runbook

Build Phase 15, Wave 3 (Staging Deployment Preparation). This document
covers the 9 failure surfaces this wave wires to Sentry via
`apps/web/lib/monitoring/capture.ts`, plus how to set up a real Sentry
project against this code.

## Honest status: nothing has been verified against a real Sentry project

**No Sentry project has ever been created for this codebase, and no
`SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN` has ever been set in this
environment.** Every code path described below is wired correctly against
the `@sentry/nextjs@11.1.0` SDK's documented API (`Sentry.init()`,
`captureException`, `captureMessage`, `captureRequestError`,
`withSentryConfig`, `instrumentation.ts` / `instrumentation-client.ts` /
`sentry.server.config.ts` / `sentry.edge.config.ts`) and is exercised by
this repo's automated tests with the SDK mocked — but no event described
here has ever actually reached a real Sentry project, because none exists.
Treat this build as **code-complete, operationally unverified**. Before
relying on any of it in a real incident, complete the "Sentry project
setup" section below and confirm a test event actually arrives.

`@sentry/nextjs`'s exact conventions (file names, subpath exports) do shift
between major versions. This document and the code it describes were
verified against the specific version installed in this repo
(`apps/web/package.json`'s `@sentry/nextjs` entry) by reading its own
`build/types`/`package.json` — not assumed from training data alone.
Double-check against Sentry's current Next.js docs if the SDK is ever
upgraded.

## How this is wired (read this before reading the 9 surfaces below)

- **`apps/web/lib/env.ts`** — `sentryConfigured` (true only when
  `SENTRY_DSN` or `NEXT_PUBLIC_SENTRY_DSN` is set; both are unset today) and
  `sentryTracesSampleRate` (defaults to `0.1`, overridable via
  `SENTRY_TRACES_SAMPLE_RATE`).
- **`apps/web/instrumentation.ts`** — Next.js's `register()`/
  `onRequestError` hooks; loads `sentry.server.config.ts` (Node runtime) or
  `sentry.edge.config.ts` (Edge runtime) and forwards SSR/Route Handler
  errors to Sentry via `captureRequestError`.
- **`apps/web/instrumentation-client.ts`** — the browser-runtime
  `Sentry.init()` (replaces the older `sentry.client.config.ts` convention
  in this SDK version) plus the router-transition instrumentation hook.
- **`apps/web/sentry.server.config.ts`** / **`sentry.edge.config.ts`** — the
  Node/Edge `Sentry.init()` calls, both gated on `sentryConfigured`.
- **`apps/web/next.config.ts`** — wraps the Next config with
  `withSentryConfig` (imported from the `@sentry/nextjs/config` subpath in
  this SDK version, not the package root) for automatic route
  instrumentation and build-time source-map upload; source-map upload
  itself is gated on `SENTRY_AUTH_TOKEN` being set (never set in this
  environment).
- **`apps/web/lib/monitoring/capture.ts`** — the shared helper every wired
  surface below calls (`captureError`, `captureMonitoringMessage`,
  `captureBusinessMetric`). No-ops safely when `sentryConfigured` is false;
  tags every event with a `category` (one of the 9 surfaces below) and,
  where available, `organizationId`; never sends candidate PII, document
  text, or full request/response bodies — only short, structured `extra`
  fields (ids, counts, error classes/messages already produced elsewhere in
  this codebase).
- **`apps/web/app/error.tsx`** / **`app/global-error.tsx`** — the App
  Router error boundaries (new this wave; neither existed before).

## The 9 failure surfaces

For each: what fires it, severity, where to look in Sentry once a project
exists, and the first-response action.

### 1. Application errors

- **Fires when:** an uncaught rendering/runtime error inside `app/`'s route
  tree (`app/error.tsx`), the root layout itself (`app/global-error.tsx`),
  or an SSR/Route Handler error Next.js surfaces via `onRequestError`
  (`instrumentation.ts`).
- **Severity:** error (root-layout failures are effectively fatal for that
  request — the whole shell failed to render).
- **Where to look:** Sentry issues tagged `category:application`. The
  `error.digest` Next.js attaches (when present) correlates a client report
  back to the exact server-side render that failed.
- **First response:** reproduce from the stack trace; if it's a root-layout
  failure (`boundary:root` tag), treat as more urgent — it takes down every
  page, not one route.

### 2. API failures

- **Fires when:** a mobile API route (`app/api/mobile/**/route.ts`) hits a
  genuine server-side failure — a DB write failing after a business
  decision was already recorded (e.g. `outreach/[id]/approve`'s status
  update), or `lib/auth/mobile-session.ts` receiving a request while
  Supabase itself is not configured for this deployment. A well-formed
  400/403 (validation failure, permission denial) is normal operation and
  is **not** captured — only genuine 500s / environment-misconfiguration
  cases are.
- **Severity:** error (a recorded decision + an inconsistent status is a
  real, actionable bug) / warning (the not-configured case — an
  environment/ops issue, not a code bug).
- **Where to look:** `category:api`, tagged with the route and any relevant
  entity id in `monitoring_extra`.
- **First response:** for the outreach-approval case, check
  `outreach_messages`/`outreach_approvals` for the affected row and
  reconcile its status manually; for not-configured, check the
  deployment's `SUPABASE_*` env vars.

### 3. Background-job failures

- **Fires when:** `lib/jobs/executor.ts` dead-letters a job (exhausted its
  `max_attempts`), or `lib/jobs/claim-due-jobs.ts` cannot even progress a
  job because the engine itself hit a DB/infra error (`failed_permanently`
  — distinct from a normal handler failure).
- **Severity:** error.
- **Where to look:** `category:background_job`; `monitoring_extra` carries
  `jobId`/`jobType`/`attemptCount`/`errorClass`.
- **First response:** check `background_jobs.last_error`/`failure_reason`
  via the admin Jobs page (Build Phase 12) for the affected job; decide
  manual-retry vs. a code fix. Remember `executor.ts`'s own documented
  limitation: a `running` row with a stale `updated_at` is a crash symptom,
  not something this wave's monitoring detects on its own (no
  heartbeat/reclaim sweep exists yet).

### 4. AI failures

- **Fires when:** a genuine AI-provider-shaped failure occurs in one of the
  three durable AI job handlers — `ai-extraction.ts` (`outcome.status ===
'error'`, i.e. an `AIProviderError`, not the deterministic
  `not_configured` value or a `rejected_by_validation` model-output issue),
  `document-processing.ts` (`errorKind` in `timeout`/`network`/
  `provider_error`/`ai_not_configured`), or `candidate-evaluation.ts`
  (`result.status === 'failed'` with an AI-shaped `errorKind`).
- **Severity:** error.
- **Where to look:** `category:ai_provider`; `monitoring_extra` carries the
  workflow/`errorKind`/model. Cross-reference the corresponding `ai_runs`
  row (always written regardless of outcome, per this project's "every AI
  action must be auditable" rule) for the full non-sensitive record.
- **First response:** check whether it's transient (timeout/network —
  these are already retried automatically by the job engine) or persistent
  (repeated `provider_error`/`ai_not_configured` — check the Anthropic API
  key/quota).

### 5. AI cost

- **Fires when:** `lib/copilot/orchestration/run-copilot-turn.ts`
  increments a `copilot_usage_counters` row and the organization's running
  daily total reaches 80% of `copilotDailyCostLimitUsd` (warning) or
  exceeds it (error) — `captureBusinessMetric` in
  `lib/monitoring/capture.ts`.
- **Severity:** warning (approaching) / error (exceeded).
- **Where to look:** `category:ai_cost`; `monitoring_extra` carries the
  organization's current total vs. limit and the window date.
- **First response:** confirm the org's real usage in
  `copilot_usage_counters` for that `window_date`; if legitimate heavy use,
  consider raising `COPILOT_DAILY_COST_LIMIT_USD` for that environment; if
  anomalous, check for a runaway conversation loop.

### 6. Authentication anomalies

- **Fires when:** `signInAction` (`lib/auth/actions.ts`) fails — wrong
  password, unknown email, or unconfirmed email are all indistinguishable
  here by design (same generic error the user sees).
- **Severity:** info — this is observability only, **not** brute-force/
  rate-limit detection. `docs/security-review.md` (Phase 14) already tracks
  the absence of failed-login rate limiting as a separate, still-open gap;
  this wave does not attempt to close it.
- **Where to look:** `category:auth`. No email or other identifying detail
  is included in the event (the email is unverified user input at the
  point of failure, not an established identity).
- **First response:** a single event needs no action. A sudden volume
  spike (visible only via Sentry's own issue-frequency view, since no
  custom rate tracking exists) is worth a manual look, but this surface
  does not alert on that pattern itself.

### 7. Integration failures

- **Fires when:** `lib/jobs/handlers/integration-sync.ts` reports a
  `failed` sync outcome for any provider (TA Tracker, Apollo, Google/
  Microsoft Calendar, SMS), or
  `lib/integrations/webhook/process-inbound-webhook.ts` hits a genuine DB
  error, or rejects an inbound webhook for an invalid signature.
- **Severity:** warning (sync failure, invalid signature) / error (DB
  write failure).
- **Where to look:** `category:integration`; `monitoring_extra` carries the
  `provider`/`integrationConnectionId` or webhook provider/id.
- **First response:** check `integration_connections.last_sync_error` for
  the sync case; for a rejected webhook signature, confirm the provider's
  configured signing secret still matches (a genuinely malicious/replayed
  webhook and a rotated-secret misconfiguration look identical here — check
  both).

### 8. Performance

- **Fires when:** N/A — this is not a discrete event but the SDK's own
  built-in tracing/performance instrumentation (`Sentry.init({
tracesSampleRate })` in every entry point above), sampled at
  `sentryTracesSampleRate` (default 10%, env-configurable via
  `SENTRY_TRACES_SAMPLE_RATE`) to bound event volume/cost. No custom code
  was written for this surface — it is "turn on the SDK's own feature
  correctly," per this wave's brief.
- **Severity:** N/A (traces, not alerts, unless a Sentry performance alert
  rule is configured separately once a project exists).
- **Where to look:** the Performance tab of the Sentry project, once one
  exists.
- **First response:** N/A until a real project's trace data exists to look
  at.

### 9. Audit-event failures

- **Fires when:** `logAuditEvent` (`lib/audit/log.ts`) itself fails to
  insert an `audit_events` row — checked directly against its actual
  existing error handling (a best-effort `console.error`, never a thrown
  error, so the business action it was recording is never blocked by an
  audit-write failure).
- **Severity:** error — a silently dropped audit event is
  compliance-relevant on its own, distinct from whatever action it was
  recording (which may well have succeeded).
- **Where to look:** `category:audit`; `monitoring_extra` carries the
  `action`/`entityType` and the Postgres error message (never row
  content/PII).
- **First response:** treat as a compliance gap for that specific action —
  there is no audit trail for it. Check Supabase/Postgres health at that
  timestamp (RLS policy issue, connection issue, etc.).

## Sentry project setup (not done in this environment)

1. Create a Sentry account/organization and a new Next.js project.
2. Copy its DSN.
3. Set `SENTRY_DSN` (server/edge) **and** `NEXT_PUBLIC_SENTRY_DSN` (browser
   — same value; a Sentry DSN is a public, non-secret identifier by
   Sentry's own design) as environment variables:
   - Locally: `.env.local` (never committed).
   - Vercel: project Settings → Environment Variables, for whichever
     environment(s) should report (staging first, per this build phase).
   - GitHub Actions: as a repository secret, referenced by
     `.github/workflows/staging-deploy.yml` (Wave 1) if that workflow needs
     to inject it at build time.
4. Optionally set `SENTRY_ORG`, `SENTRY_PROJECT`, and `SENTRY_AUTH_TOKEN`
   (a Sentry auth token with project:releases scope) to enable build-time
   source-map upload via `withSentryConfig` in `next.config.ts` — without
   these, the build still succeeds and Sentry still receives events, just
   with unminified/unmapped stack traces.
5. Optionally set `SENTRY_TRACES_SAMPLE_RATE` (default `0.1`) and
   `COPILOT_DAILY_COST_LIMIT_USD` (default `5`, Wave 2) to the deployment's
   real intended values.
6. Deploy, then trigger one real event per surface above (e.g. a deliberate
   failed sign-in, a deliberately-broken webhook signature) and confirm it
   actually appears in the Sentry project before trusting this wiring in a
   real incident.
