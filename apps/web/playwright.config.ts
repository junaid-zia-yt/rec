import { defineConfig, devices } from '@playwright/test'
import { existsSync } from 'node:fs'

/**
 * Playwright configuration — Build Phase 1 smoke test only (brief §10).
 * Starts the Next.js production build against a local server; CI reuses
 * the same command. No visual/screenshot assertions here — those are
 * covered by manual visual verification per the brief §14.
 */

// This development container ships a pre-installed Chromium build that may
// not match @playwright/test's expected browser version; if present, launch
// it directly instead of downloading a new one. CI environments without
// this path fall back to Playwright's normal browser resolution.
const localChromium = '/opt/pw-browsers/chromium'
const executablePath = existsSync(localChromium) ? localChromium : undefined

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: executablePath ? { executablePath } : {},
      },
    },
  ],
  webServer: {
    command: 'pnpm exec next start -p 3100',
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
