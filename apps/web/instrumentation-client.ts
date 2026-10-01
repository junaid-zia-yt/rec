/**
 * Sentry browser-runtime init (Build Phase 15 Wave 3). This file's name/
 * location is a Next.js 16 + `@sentry/nextjs` v11 convention — it is loaded
 * automatically for the client bundle, replacing the older
 * `sentry.client.config.ts` pattern from earlier SDK versions (verified
 * against this repo's installed `@sentry/nextjs@11.1.0` package: its own
 * build warns "your `instrumentation-client.(js|ts)` file" by name for the
 * router-transition hook below — this is not guessed from training data
 * alone, but double-check it against Sentry's own current Next.js docs
 * before relying on it, since SDK conventions do shift between majors).
 *
 * Gated on `sentryConfigured`, which for the CLIENT bundle resolves from
 * `NEXT_PUBLIC_SENTRY_DSN` specifically (see lib/env.ts's header note on
 * that var) — no DSN is configured in this environment, so `Sentry.init()`
 * is never actually called here today.
 */
import * as Sentry from '@sentry/nextjs'
import { env, sentryConfigured, sentryTracesSampleRate } from '@/lib/env'

if (sentryConfigured) {
  Sentry.init({
    dsn: env.NEXT_PUBLIC_SENTRY_DSN,
    environment: env.NEXT_PUBLIC_ENVIRONMENT_NAME || 'development',
    release: env.NEXT_PUBLIC_RELEASE_TAG || undefined,
    tracesSampleRate: sentryTracesSampleRate,
  })
}

/** Required for the SDK's client-side router-transition instrumentation to work at all (App Router navigation spans) — a no-op export when Sentry is not configured, since `Sentry.captureRouterTransitionStart` itself no-ops without an active client. */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
