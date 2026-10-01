import { z } from 'zod'

/**
 * Environment validation (docs/21-implementation-contract.md §21.6, Build Phase 1
 * brief §3). Nothing here is read by any code path yet in Build Phase 1 — no
 * Supabase/Anthropic/Resend/Sentry client exists — but the contract is
 * established now: a missing REQUIRED var throws a clear error at import
 * time; a missing OPTIONAL var (all of today's service credentials) never
 * crashes the UI shell, it just leaves `demoMode` true.
 */
const EnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional().or(z.literal('')),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional().or(z.literal('')),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().or(z.literal('')),
  ANTHROPIC_API_KEY: z.string().optional().or(z.literal('')),
  RESEND_API_KEY: z.string().optional().or(z.literal('')),
  SENTRY_DSN: z.string().optional().or(z.literal('')),
  // Build Phase 12 Wave 3 additions — all optional, mirroring
  // RESEND_API_KEY's exact treatment (docs/11-integration-plan.md §11.4/
  // §11.5). None is configured in this environment; each corresponding
  // `*Configured` flag below is therefore `false` here, and every adapter
  // that reads it must gate on it rather than assume a live credential.
  APOLLO_API_KEY: z.string().optional().or(z.literal('')),
  GOOGLE_CALENDAR_CLIENT_ID: z.string().optional().or(z.literal('')),
  GOOGLE_CALENDAR_CLIENT_SECRET: z.string().optional().or(z.literal('')),
  MICROSOFT_CALENDAR_CLIENT_ID: z.string().optional().or(z.literal('')),
  MICROSOFT_CALENDAR_CLIENT_SECRET: z.string().optional().or(z.literal('')),
  // Build Phase 12 Wave 4 addition — the "from" identity for system-
  // generated notification emails (lib/notifications/email-template.ts).
  // Distinct from any outreach_messages.sender_account_identifier (Phase
  // 9): a notification is never sent "as" a recruiter. Optional, same
  // never-crash treatment as every other credential above — unset simply
  // means email-template.ts falls back to a clearly-labelled placeholder
  // address rather than claiming a real one exists.
  NOTIFICATIONS_FROM_EMAIL: z.string().optional().or(z.literal('')),
  // Build Phase 15 Wave 1 (staging deployment prep,
  // docs/rollback-runbook.md "identifying the live release") additions.
  // Baked in at build time by .github/workflows/staging-deploy.yml as
  // build-time env vars (NEXT_PUBLIC_-prefixed so the deployed app can read
  // its own build identity client-side too, e.g. for a future non-
  // production banner) — never set for a local dev build, so both are
  // optional and `getBuildInfo()` below returns an honest "unknown" shape
  // rather than a guessed value when absent. Neither var is read or set by
  // anything in this environment; no build here has ever gone through that
  // workflow.
  NEXT_PUBLIC_BUILD_SHA: z.string().optional().or(z.literal('')),
  NEXT_PUBLIC_RELEASE_TAG: z.string().optional().or(z.literal('')),
  // Build Phase 15 Wave 2 (staging deployment prep, Wave 2) additions — same
  // optional/never-crash treatment as every var above.
  //
  // NEXT_PUBLIC_ENVIRONMENT_NAME: which environment this build is running
  // as, for the non-production banner (components/domain/non-production-
  // banner.tsx). Unset (local dev) or 'production' both render no banner;
  // only the literal value 'staging' does. NEXT_PUBLIC_-prefixed so the
  // client bundle can read it, same reasoning as NEXT_PUBLIC_BUILD_SHA.
  NEXT_PUBLIC_ENVIRONMENT_NAME: z.string().optional().or(z.literal('')),
  // STAGING_BASIC_AUTH_USER / STAGING_BASIC_AUTH_PASSWORD: server-only HTTP
  // Basic Auth credentials enforced in proxy.ts, gating the whole staging
  // deployment behind a shared password so search engines and casual
  // visitors cannot reach it. A coarse perimeter gate only — never a
  // substitute for the app's real Supabase-Auth-based authentication, which
  // still fully applies underneath it (see proxy.ts). No-op unless BOTH are
  // set; never intended to be set in local development or (today) in
  // production, since no production posture has been decided yet.
  STAGING_BASIC_AUTH_USER: z.string().optional().or(z.literal('')),
  STAGING_BASIC_AUTH_PASSWORD: z.string().optional().or(z.literal('')),
  // SUPABASE_STORAGE_BUCKET: overrides lib/files/storage.ts's private
  // documents bucket name. Optional — defaults to the existing hardcoded
  // 'documents' value when unset, so this is non-breaking for every
  // environment that doesn't set it. A staging deployment should set this to
  // a staging-only bucket name (e.g. 'rqi-staging-documents') so seeded
  // staging documents can never collide with a hypothetical production
  // bucket (docs/staging-deployment.md).
  SUPABASE_STORAGE_BUCKET: z.string().optional().or(z.literal('')),
  // COPILOT_DAILY_MESSAGE_LIMIT / COPILOT_DAILY_COST_LIMIT_USD: override the
  // copilot rate-limit constants in lib/copilot/orchestration/
  // run-copilot-turn.ts (Phase 11, explicitly flagged there as placeholder
  // policy constants). Read as strings and parsed defensively below — an
  // absent or malformed value falls back to the existing hardcoded default
  // (200 messages / $5) rather than crashing or disabling the limit. A
  // staging deployment under UAT load from multiple testers should normally
  // set a LOWER value than production to bound AI cost exposure
  // (docs/staging-deployment.md).
  COPILOT_DAILY_MESSAGE_LIMIT: z.string().optional().or(z.literal('')),
  COPILOT_DAILY_COST_LIMIT_USD: z.string().optional().or(z.literal('')),
  // Build Phase 15 Wave 3 (monitoring/error-tracking) additions — same
  // optional/never-crash treatment as every var above. No Sentry project
  // has been created in this environment, so `sentryConfigured` is `false`
  // here; lib/monitoring/capture.ts and every sentry.*.config.ts/
  // instrumentation.ts entry point must gate on it rather than assume a
  // live DSN. SENTRY_TRACES_SAMPLE_RATE overrides the tracing/performance
  // sample rate Sentry.init() is given (docs/monitoring-runbook.md
  // "Performance" section) — parsed defensively below, falling back to a
  // conservative 0.1 (10%) default to bound event volume/cost.
  SENTRY_TRACES_SAMPLE_RATE: z.string().optional().or(z.literal('')),
  // NEXT_PUBLIC_SENTRY_DSN: the browser/client-side entry point
  // (instrumentation-client.ts) needs its own DSN reference because only a
  // NEXT_PUBLIC_-prefixed var reaches the client bundle (same reasoning as
  // NEXT_PUBLIC_BUILD_SHA above) — SENTRY_DSN itself stays server-only and
  // is never read by client code. A Sentry DSN is a public, non-secret
  // identifier by Sentry's own design (it authorizes sending events, not
  // reading them), so exposing it client-side is the documented, intended
  // use, not a credential leak. In practice a real deployment sets both
  // vars to the identical DSN value.
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional().or(z.literal('')),
  // Build Phase 17D Wave A (private client demo readiness) addition.
  // NEXT_PUBLIC_DEMO_MODE: whether this build is running as a private,
  // client-facing demonstration using only seeded fictional data (scripts/
  // seed-demo.ts). NEXT_PUBLIC_-prefixed (same reasoning as
  // NEXT_PUBLIC_ENVIRONMENT_NAME above) because both server code (the
  // outreach-send adapter selector, lib/outreach/channels/email.ts) and
  // client components (components/domain/demo-mode-banner.tsx, the
  // outreach draft "preview only" badge, the sample-AI-assessment notice)
  // need to read it. Optional, defaults to unset/false — a build that never
  // sets this var behaves exactly as before this wave existed. Distinct
  // from NEXT_PUBLIC_ENVIRONMENT_NAME: a demo could in principle run under
  // NEXT_PUBLIC_ENVIRONMENT_NAME=staging too (the two banners can coexist),
  // though in practice this runs locally with only DEMO_MODE set.
  NEXT_PUBLIC_DEMO_MODE: z.string().optional().or(z.literal('')),
})

const parsed = EnvSchema.safeParse({
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  SENTRY_DSN: process.env.SENTRY_DSN,
  APOLLO_API_KEY: process.env.APOLLO_API_KEY,
  GOOGLE_CALENDAR_CLIENT_ID: process.env.GOOGLE_CALENDAR_CLIENT_ID,
  GOOGLE_CALENDAR_CLIENT_SECRET: process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
  MICROSOFT_CALENDAR_CLIENT_ID: process.env.MICROSOFT_CALENDAR_CLIENT_ID,
  MICROSOFT_CALENDAR_CLIENT_SECRET: process.env.MICROSOFT_CALENDAR_CLIENT_SECRET,
  NOTIFICATIONS_FROM_EMAIL: process.env.NOTIFICATIONS_FROM_EMAIL,
  NEXT_PUBLIC_BUILD_SHA: process.env.NEXT_PUBLIC_BUILD_SHA,
  NEXT_PUBLIC_RELEASE_TAG: process.env.NEXT_PUBLIC_RELEASE_TAG,
  NEXT_PUBLIC_ENVIRONMENT_NAME: process.env.NEXT_PUBLIC_ENVIRONMENT_NAME,
  STAGING_BASIC_AUTH_USER: process.env.STAGING_BASIC_AUTH_USER,
  STAGING_BASIC_AUTH_PASSWORD: process.env.STAGING_BASIC_AUTH_PASSWORD,
  SUPABASE_STORAGE_BUCKET: process.env.SUPABASE_STORAGE_BUCKET,
  COPILOT_DAILY_MESSAGE_LIMIT: process.env.COPILOT_DAILY_MESSAGE_LIMIT,
  COPILOT_DAILY_COST_LIMIT_USD: process.env.COPILOT_DAILY_COST_LIMIT_USD,
  SENTRY_TRACES_SAMPLE_RATE: process.env.SENTRY_TRACES_SAMPLE_RATE,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  NEXT_PUBLIC_DEMO_MODE: process.env.NEXT_PUBLIC_DEMO_MODE,
})

if (!parsed.success) {
  // A REQUIRED variable (currently only NEXT_PUBLIC_APP_URL, which has a
  // default and so cannot actually fail) is missing or malformed.
  throw new Error(
    `Invalid environment configuration:\n${parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')}`,
  )
}

export const env = parsed.data

/**
 * True whenever no external service credential is configured. In Build
 * Phase 1 this is always true, since no integration is wired up yet — but
 * the flag exists now so later phases can branch on it instead of the UI
 * assuming a service is reachable.
 */
export const demoMode =
  !env.NEXT_PUBLIC_SUPABASE_URL && !env.ANTHROPIC_API_KEY && !env.RESEND_API_KEY

/**
 * True only when a Supabase project is actually configured (Build Phase 2,
 * docs/21-implementation-contract.md §21.2/§21.6). Auth, RLS-backed reads,
 * and anything under lib/supabase/* must gate on this specific flag rather
 * than the broader `demoMode` — Supabase can be configured while Anthropic/
 * Resend are still absent, and auth must not silently no-op in that case.
 *
 * No live Supabase project is connected in this environment: this flag is
 * `false` in every environment that has not been given real credentials, and
 * nothing in this codebase claims an authenticated session exists when it
 * does not.
 */
export const supabaseConfigured = Boolean(
  env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
)

/**
 * True only when the service-role key is present. Checked exclusively by
 * server-only code (lib/supabase/admin.ts) — never imported by anything that
 * could end up in a client bundle.
 */
export const supabaseAdminConfigured = Boolean(
  env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY,
)

/**
 * True only when a real Anthropic API key is present (Build Phase 4 brief:
 * "If a real Anthropic key is unavailable, implement a typed provider
 * interface and deterministic test adapter. Do not fake a successful live
 * integration."). No `ANTHROPIC_API_KEY` is configured in this environment,
 * so this flag is `false` here — lib/ai/provider.ts must return an honest
 * "AI extraction is not available" result rather than silently falling back
 * to the deterministic test adapter, which is wired only into the test
 * suite (lib/ai/test-adapter.ts), never into a live request path.
 */
export const anthropicConfigured = Boolean(env.ANTHROPIC_API_KEY)

/**
 * True only when a real Resend API key is present (Build Phase 9 brief
 * §"EMAIL": "If Resend credentials are configured: Implement a provider
 * adapter... If credentials are unavailable, use a clearly labelled
 * development adapter and do not claim live delivery."). No
 * `RESEND_API_KEY` is configured in this environment, so this flag is
 * `false` here — lib/outreach/channels/email.ts must select the
 * development adapter rather than silently pretending mail was sent.
 */
export const resendConfigured = Boolean(env.RESEND_API_KEY)

/**
 * True only when a real Apollo API key is present (Build Phase 12 Wave 3,
 * docs/11-integration-plan.md §11.4). No `APOLLO_API_KEY` is configured in
 * this environment, so this flag is `false` here —
 * lib/integrations/apollo/apollo-client.ts must select the
 * not-configured adapter rather than attempting a live enrichment call.
 */
export const apolloConfigured = Boolean(env.APOLLO_API_KEY)

/**
 * True only when both Google OAuth client credentials are present (Build
 * Phase 12 Wave 3, docs/18-blocking-questions.md Q-P3-01). No live
 * credentials are configured in this environment, so this flag is `false`
 * here — lib/integrations/calendar/google-calendar-adapter.ts must return
 * `not_configured` rather than attempting an OAuth flow or API call.
 */
export const googleCalendarConfigured = Boolean(
  env.GOOGLE_CALENDAR_CLIENT_ID && env.GOOGLE_CALENDAR_CLIENT_SECRET,
)

/**
 * True only when both Microsoft (Azure AD) app registration credentials are
 * present (Build Phase 12 Wave 3, docs/18-blocking-questions.md Q-P3-01). No
 * live credentials are configured in this environment, so this flag is
 * `false` here — lib/integrations/calendar/microsoft-calendar-adapter.ts
 * must return `not_configured` rather than attempting an OAuth flow or API
 * call.
 */
export const microsoftCalendarConfigured = Boolean(
  env.MICROSOFT_CALENDAR_CLIENT_ID && env.MICROSOFT_CALENDAR_CLIENT_SECRET,
)

/**
 * Build Phase 15 Wave 1 — data plumbing only, no UI. Returns this build's
 * git SHA and release tag when the app was built by
 * .github/workflows/staging-deploy.yml (which bakes NEXT_PUBLIC_BUILD_SHA/
 * NEXT_PUBLIC_RELEASE_TAG in at build time, see that workflow and
 * docs/rollback-runbook.md). A local dev build, or any build that hasn't
 * gone through that workflow, sets neither — `isKnownBuild` is `false` and
 * both string fields fall back to `'unknown'` rather than an empty string,
 * so any future consumer (a footer string, or the non-production banner a
 * later wave owns) never has to special-case blank vs. missing itself.
 */
export interface BuildInfo {
  sha: string
  releaseTag: string
  isKnownBuild: boolean
}

export function getBuildInfo(): BuildInfo {
  const sha = env.NEXT_PUBLIC_BUILD_SHA || ''
  const releaseTag = env.NEXT_PUBLIC_RELEASE_TAG || ''
  return {
    sha: sha || 'unknown',
    releaseTag: releaseTag || 'unknown',
    isKnownBuild: Boolean(sha),
  }
}

/**
 * Build Phase 15 Wave 2 — true only when BOTH staging Basic Auth
 * credentials are set. Read by proxy.ts to decide whether to enforce the
 * coarse staging-access gate at all; false (the default everywhere this
 * pair isn't explicitly configured) means the gate is a complete no-op, by
 * construction, never "on but misconfigured".
 */
export const stagingBasicAuthConfigured = Boolean(
  env.STAGING_BASIC_AUTH_USER && env.STAGING_BASIC_AUTH_PASSWORD,
)

/**
 * Build Phase 15 Wave 2 — the private-documents Supabase Storage bucket
 * name (lib/files/storage.ts). Defaults to the pre-existing hardcoded
 * 'documents' value so every environment that doesn't set
 * SUPABASE_STORAGE_BUCKET keeps its current behavior unchanged. A staging
 * deployment should set this to a staging-only bucket name, distinct from
 * any hypothetical production bucket (docs/staging-deployment.md).
 */
export const documentsStorageBucket = env.SUPABASE_STORAGE_BUCKET || 'documents'

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * Build Phase 15 Wave 2 — overridable copilot rate-limit policy constants
 * (lib/copilot/orchestration/run-copilot-turn.ts, Phase 11's placeholder
 * policy values: 200 messages/day, $5/day). An absent, empty, or malformed
 * override falls back to that exact original default — never crashes, never
 * silently disables the limit. Intended use: a staging deployment under
 * multi-tester UAT load sets a LOWER COPILOT_DAILY_MESSAGE_LIMIT /
 * COPILOT_DAILY_COST_LIMIT_USD than production to bound AI cost exposure
 * (docs/staging-deployment.md); production is free to leave both unset and
 * keep the original defaults.
 */
export const copilotDailyMessageLimit = parsePositiveInt(env.COPILOT_DAILY_MESSAGE_LIMIT, 200)
export const copilotDailyCostLimitUsd = parsePositiveNumber(env.COPILOT_DAILY_COST_LIMIT_USD, 5)

/**
 * Build Phase 15 Wave 3 — true only when a Sentry DSN is present. No
 * `SENTRY_DSN` is configured in this environment, so this flag is `false`
 * here: `Sentry.init()` must never be called with an empty DSN (it would
 * silently no-op inside the SDK anyway, but every entry point in this
 * codebase gates explicitly rather than relying on that), and
 * lib/monitoring/capture.ts's helpers must fall back to a true no-op rather
 * than attempting to reach a Sentry project that does not exist.
 *
 * Checks BOTH `SENTRY_DSN` (server/edge) and `NEXT_PUBLIC_SENTRY_DSN`
 * (client) because this same flag gates lib/monitoring/capture.ts, which is
 * called from both server code and the client-side `app/error.tsx` — only
 * the `NEXT_PUBLIC_`-prefixed var actually survives into a client bundle
 * (Next.js inlines it at build time; the bare `SENTRY_DSN` reference
 * resolves to `undefined` there), so checking only one would leave the
 * other runtime silently un-gated correctly but for the wrong reason.
 */
export const sentryConfigured = Boolean(env.SENTRY_DSN || env.NEXT_PUBLIC_SENTRY_DSN)

/**
 * Build Phase 15 Wave 3 — the tracing/performance sample rate passed to
 * `Sentry.init({ tracesSampleRate })` in every sentry.*.config.ts /
 * instrumentation.ts entry point. An absent, empty, or malformed override
 * falls back to a conservative 0.1 (10%) default to bound event volume and
 * cost (docs/monitoring-runbook.md "Performance" section) — clamped to
 * [0, 1] since Sentry's SDK treats an out-of-range value as undefined
 * behavior rather than clamping it itself.
 */
function parseSampleRate(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback
}
export const sentryTracesSampleRate = parseSampleRate(env.SENTRY_TRACES_SAMPLE_RATE, 0.1)

/**
 * Build Phase 17D Wave A — true only when `NEXT_PUBLIC_DEMO_MODE` is
 * exactly the string `'true'`. Unset (the default everywhere this var
 * isn't explicitly set, including every environment before this wave)
 * means `false` — no existing behavior changes unless a deployment
 * explicitly opts in. When `true`:
 *   - `components/domain/demo-mode-banner.tsx` renders on every page.
 *   - `lib/outreach/channels/email.ts`'s adapter selector unconditionally
 *     returns the development/no-op adapter, even if `resendConfigured` is
 *     also true — demo mode must never send a real message regardless of
 *     what credentials happen to be configured.
 *   - The outreach draft UI shows a "preview only, not sent" badge.
 *   - Candidate-evaluation/quality-review/shortlist UI shows a "sample AI
 *     assessment" notice next to gate/score/evidence content seeded by
 *     `scripts/seed-demo.ts` (never claims a live model call produced it).
 */
export const demoModeEnabled = env.NEXT_PUBLIC_DEMO_MODE === 'true'
