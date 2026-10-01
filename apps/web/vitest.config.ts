import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

/**
 * Vitest configuration — Build Phase 1 testing foundation (brief §10).
 * jsdom environment for component rendering; @rqi/testing supplies the
 * jest-dom matchers via setupFiles.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['@rqi/testing/setup'],
    globals: true,
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['node_modules', '.next', 'e2e/**', 'playwright-report/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // Next.js's bundler resolves `server-only` to an empty module in
      // server bundles via a build-time "react-server" condition; outside
      // Next's build (i.e. here, in Vitest/Node) the package's real
      // index.js unconditionally throws on import, by design, regardless
      // of whether the importer is actually server or client code. This
      // alias reproduces Next's build-time behavior for tests so
      // server-only-guarded modules (lib/supabase/*, lib/auth/session.ts,
      // lib/audit/log.ts) can be imported and unit-tested directly.
      'server-only': path.resolve(__dirname, 'node_modules/server-only/empty.js'),
    },
  },
})
