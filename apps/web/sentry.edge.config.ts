/**
 * Sentry edge-runtime init (Build Phase 15 Wave 3). Loaded by
 * `instrumentation.ts`'s `register()` for the Edge runtime (middleware,
 * edge Route Handlers) — never imported directly by application code.
 *
 * Same `sentryConfigured` gate as sentry.server.config.ts — see that file's
 * header note and docs/monitoring-runbook.md for the honest "never actually
 * configured in this environment" caveat.
 */
import * as Sentry from '@sentry/nextjs'
import { env, sentryConfigured, sentryTracesSampleRate } from '@/lib/env'

if (sentryConfigured) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NEXT_PUBLIC_ENVIRONMENT_NAME || 'development',
    release: env.NEXT_PUBLIC_RELEASE_TAG || undefined,
    tracesSampleRate: sentryTracesSampleRate,
  })
}
