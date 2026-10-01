# 17 — Deployment & Operations

## 17.1 Environment Strategy

| Environment       | Purpose                                                     | Supabase Project                                                                    | Deploy Trigger                           |
| ----------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------- |
| Local development | Individual dev work                                         | Local Supabase (Docker) or a shared dev project                                     | Manual                                   |
| Preview           | Per-PR review                                               | Shared dev Supabase project, schema-isolated by migration                           | Automatic on PR (Vercel preview deploys) |
| Staging           | Pre-production validation, client demos (including the POC) | Dedicated staging Supabase project, seeded with realistic (non-real-candidate) data | Automatic on merge to `main`             |
| Production        | Live agency usage                                           | Dedicated production Supabase project                                               | Manual promotion after staging sign-off  |

## 17.2 Environment Variables

Server-only secrets (Anthropic API key, Supabase service role key, Resend key, Apollo key when provisioned) are never exposed via `NEXT_PUBLIC_*` prefixes; only the Supabase anon/publishable key and any genuinely public config use that prefix. Managed via Vercel's environment-variable UI, scoped per environment, never committed to the repo (SEC-01).

## 17.3 Database Migrations

Every schema change ships as a versioned Supabase migration file, applied in CI against a throwaway DB before merge, and applied to staging automatically then production manually — no manual `ALTER TABLE` against a live environment, ever, per the engineering rules.

## 17.4 Seed Data

Staging is seeded with synthetic organizations/clients/candidates (explicitly fabricated test personas, never real candidate PII) so QA and client demos don't risk real people's data.

## 17.5 CI Checks

On every PR: typecheck (strict TypeScript), lint, unit tests, RLS test suite, AI schema-validation tests, and the prompt-injection fixture suite. Merge is blocked on any failure — matches the engineering rule "fix errors before moving forward."

## 17.6 Preview & Production Deployment

Vercel for both web preview deploys and production hosting, consistent with the approved stack. Mobile (Expo) uses EAS Build/Submit once Phase 13 begins, with its own preview-channel strategy (Expo's internal distribution) ahead of app-store submission.

## 17.7 Background Jobs

**Build Phase 12 update — this is no longer an open implementation decision; here is what was actually built, and its honest limitations.** There is no queue broker or persistent worker process in this deployment (Vercel serverless, no Redis/SQS) — the architecture that was actually built is **request-triggered claim/execute**: `background_jobs` (`supabase/migrations/0032`) is a durable table, `lib/jobs/enqueue.ts`'s `enqueueJob` is the only way a row is created (idempotent on `(organization_id, job_type, idempotency_key)`), and `lib/jobs/executor.ts`'s `executeJob` claims and runs exactly one job via a single optimistic `UPDATE ... WHERE status = 'queued'` — something has to _call_ `executeJob`/`claimDueJobs` for work to happen; nothing calls it on its own on a schedule yet.

**Two open limitations, flagged honestly rather than glossed over:**

1. **No stale-`running`-row reclaim sweep.** The optimistic claim provides real protection against two callers claiming the same row (Postgres's own single-row UPDATE atomicity — confirmed by `executor.test.ts`'s simulated-concurrent-claim test), but it provides _no_ protection once a job is claimed: if the claiming process is killed mid-handler (a Vercel function timeout, a crash, a deploy), the row is left `running` forever with no heartbeat and no lease expiry. `claimDueJobs` only ever selects `queued` rows, so a stuck `running` job is invisible to it. A `running` row whose `updated_at` is far in the past is a crash symptom; a sweep that forces such a row back to `failed` after N minutes (so normal retry/dead-letter logic takes over) is a natural next addition, deliberately not built this wave — no evidence yet of how long a real handler legitimately runs in this deployment, and inventing a guessed threshold now would be exactly the kind of unverified claim project conventions forbid.
2. **No resolved design for which identity runs a cross-org cron-triggered batch sweep.** `executeJob`/`claimDueJobs` run using the CALLER's own authenticated Supabase session throughout (0032's RLS note: `background_jobs` has no service-role-only write path) — so a single invocation can only ever claim jobs belonging to organizations that session is actually a member of. A real periodic trigger (e.g. a Vercel Cron-invoked route) has not been built, and two honest shapes remain to choose between: (a) one cron invocation per organization, authenticated as a designated per-org service/admin account, or (b) a single elevated account that is a member of every organization, or a schema change adding a genuine service-role write path. This is a product/security decision, not made unilaterally by this wave.

**What IS fully built and tested:** idempotent enqueue, exponential backoff with jitter (`lib/jobs/backoff.ts`), the retry-vs-dead-letter decision at the exact `attempt_count`/`max_attempts` boundary, manual retry with an attempt-count reset (`lib/jobs/manual-retry.ts`, `platform_admin`/`agency_admin`-gated), a `correlation_id` shared across one job's full audit-event lifecycle, and a hard rule that no job's `payload` or raw `last_error` object ever reaches an ordinary log line (confirmed by `executor.test.ts`).

**Inbound webhooks** (`lib/integrations/webhook/process-inbound-webhook.ts`) are similarly a tested, callable function, not yet a live endpoint — the actual `app/api/webhooks/<provider>/route.ts` route handlers (parsing the raw request, reading provider-specific headers, constructing a service-role Supabase client) were never built this phase; no live webhook can actually be received until those routes exist.

## 17.8 Monitoring & Error Tracking

Sentry across web, mobile, and background jobs. Alert routing for: AI schema-validation failure spikes, RLS-denial spikes (possible attack or a broken policy), and background-job failure/retry-exhaustion.

## 17.9 AI Cost Monitoring

`AI_runs.cost` aggregated into a per-org, per-workflow dashboard; alert threshold if daily spend materially exceeds baseline (protects both the business and, indirectly, the "cost expected to be lower than current time investment" promise made to the client in the MOM).

## 17.10 Audit Retention

Per [[12-security-compliance]] §12.8 — long retention (recommended 7 years) for `audit_events`, distinct from and outliving the candidate-PII retention window.

## 17.11 Backup & Rollback

Supabase automated backups + a tested restore procedure before production launch (not just a documented one). Application rollback via Vercel's instant-rollback to a prior deployment; database migrations are written to be forward-compatible for at least one release so a code rollback doesn't require a simultaneous schema rollback.

## 17.12 Incident Response

See [[12-security-compliance]] §12.17 — a written runbook is a Phase 15 exit criterion, not an afterthought.

## 17.13 Mobile Build & Distribution — Build Phase 13

**This section is documentation only — no build, submission, or distribution action has been taken in this environment.** Per the governing brief for Build Phase 13: _"Do not publish to app stores in this build."_ Nothing below has been executed; it records how the already-built `apps/mobile` Expo app would actually be built and distributed once that decision is made.

**Build tooling.** Expo Application Services (**EAS Build**) is the intended path — it is the standard toolchain for an Expo-managed-workflow app and needs no native Xcode/Android-Studio project checked into this repo (none exists today). `eas.json` (build profiles: `development`, `preview`, `production`) has not been created yet; that is a Phase 15+ exit-criterion item, not built this phase.

**Environment variables the mobile app needs at build/run time** (see `apps/mobile/lib/env.ts`), all Expo-public-prefixed since a mobile client binary cannot hold a server secret:

| Variable                        | Purpose                                                                                                  | Current state in this environment                                                                                                                                                                          |
| ------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_SUPABASE_URL`      | Supabase project URL the app connects to                                                                 | Unset — no live Supabase project is configured anywhere in this build environment; `supabaseConfigured` is `false`, and the app renders `NotConfiguredScreen` honestly rather than assuming a live backend |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/publishable key (RLS-scoped, safe to ship in a client binary — never the service-role key) | Unset, same reason                                                                                                                                                                                         |
| `EXPO_PUBLIC_API_BASE_URL`      | Base URL for the `/api/mobile/*` route layer (see [[13-api-service-boundaries]] §13.8)                   | Unset — falls back to `http://localhost:3000`, a local-dev default only; a real build must point this at the actual deployed web app's URL                                                                 |

None of these three are set in this environment (confirmed: `apps/mobile/__tests__/App.test.tsx`'s whole premise is asserting the honest not-configured screen renders because they're absent) — every mobile test in this repo runs, and every screen renders correctly, without a live backend, by design.

**Distribution channels, once building is actually undertaken:** EAS's internal-distribution channel (an installable build shared by link/QR code, no app-store review) for staging/QA use, ahead of any eventual App Store Connect / Google Play Console submission — which, again, is explicitly out of scope for this build per the brief.

**Native module surface:** the app uses only Expo-managed-workflow packages (`expo-secure-store`, `expo-font`, `expo-google-fonts`, `react-native-safe-area-context`, `react-native-reanimated`, `@gorhom/bottom-sheet`, `@react-navigation/*`, `@react-native-async-storage/async-storage`) — none require a custom native module or a bare-workflow eject, so an EAS managed build should work without additional native configuration once undertaken; this has not been verified against a real EAS build in this environment (see [[16-testing-strategy]] §16.3's iOS/Android static-analysis-only limitation).

Related documents: [[12-security-compliance]] · [[15-implementation-roadmap]] · [[16-testing-strategy]] · [[13-api-service-boundaries]] · [[build-phase-13-report]]
