import type { NextConfig } from 'next'
// `withSentryConfig` moved to the `@sentry/nextjs/config` subpath as of
// this installed version (`@sentry/nextjs@11.1.0`) — it is NOT re-exported
// from the package's main entry point. Verified against this repo's own
// installed `node_modules/@sentry/nextjs/package.json` `exports` map, not
// assumed from training data alone; double-check this import path against
// Sentry's current Next.js docs if upgrading the SDK later.
import { withSentryConfig } from '@sentry/nextjs/config'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@rqi/ui', '@rqi/config', '@rqi/types'],
  // Build Phase 18 repair: the client Router Cache's default 30s
  // `staleTimes.dynamic` window let a client-side Link navigation reuse a
  // page's previously-fetched RSC payload even after a server action had
  // already revalidated it — a recruiter (or the private demo's reset
  // button) could take an action on one screen, click into another
  // screen they had visited less than 30s earlier, and see the OLD data.
  // Discovered via Playwright browser testing (revisiting the shortlist
  // workspace immediately after "Reset demo data" still showed the
  // pre-reset shortlist) — every screen here reflects live, mutable
  // state (the demo engine in-memory, or Supabase in live mode), so a
  // stale client cache is a correctness bug, not a performance trade-off
  // worth keeping. See docs/demo-limitations.md §8.
  experimental: {
    staleTimes: { dynamic: 0 },
  },
}

/**
 * `withSentryConfig` (Build Phase 15 Wave 3) — enables the SDK's automatic
 * instrumentation (route/component wrapping, source-map upload at build
 * time) and is itself safe to apply unconditionally: without a Sentry
 * auth token/org/project configured (none is, in this environment — see
 * docs/monitoring-runbook.md), the wrapper's own build-time steps
 * (source-map upload, release creation) are skipped with a console notice
 * rather than failing the build; it does not require `SENTRY_DSN` to be
 * set (that only gates whether `Sentry.init()` actually runs at request
 * time — see instrumentation.ts / sentry.*.config.ts).
 */
export default withSentryConfig(nextConfig, {
  silent: true,
  widenClientFileUpload: false,
  // No Sentry org/project has been created (docs/monitoring-runbook.md) —
  // these stay unset rather than pointing at a placeholder that would look
  // configured but is not.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
})
