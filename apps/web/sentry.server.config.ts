/**
 * Sentry server-runtime init (Build Phase 15 Wave 3). Loaded by
 * `instrumentation.ts`'s `register()` for the Node.js runtime — never
 * imported directly by application code.
 *
 * Gated on `sentryConfigured` (lib/env.ts): no `SENTRY_DSN` is set in this
 * environment, so `Sentry.init()` is never actually called here today. See
 * docs/monitoring-runbook.md for the honest "code-complete, operationally
 * unverified" caveat — no Sentry project has ever received an event from
 * this codebase.
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
