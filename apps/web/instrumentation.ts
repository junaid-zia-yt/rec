/**
 * Next.js instrumentation hook (Build Phase 15 Wave 3) — the single entry
 * point Next.js itself calls once per server/edge runtime start-up
 * (`register()`), and the request-error hook it calls on every server-side
 * rendering/Route Handler error (`onRequestError`). This is the standard
 * `@sentry/nextjs` v11 wiring: `register()` conditionally imports the
 * runtime-specific config file (never imports the Node-only
 * `sentry.server.config.ts` from the Edge runtime, and vice versa —
 * `process.env.NEXT_RUNTIME` is how Next.js itself distinguishes them), and
 * `onRequestError` forwards to `Sentry.captureRequestError`, which is how
 * Sentry captures SSR/Route Handler errors it would otherwise never see
 * (this covers "Application errors" for anything Next.js renders/handles
 * outside a component that has its own `error.tsx` boundary — see that
 * file for the client-side rendering-error boundary itself).
 *
 * Both `register()` and `onRequestError` are no-ops in effect when
 * `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN` are unset (the imported config files
 * gate their own `Sentry.init()` on `sentryConfigured`; `captureRequestError`
 * itself no-ops with no active Sentry client) — see
 * docs/monitoring-runbook.md for the honest "never configured in this
 * environment" caveat.
 */
import * as Sentry from '@sentry/nextjs'

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}

export const onRequestError = Sentry.captureRequestError
