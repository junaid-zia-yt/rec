import { test, expect } from '@playwright/test'

/**
 * Build Phase 2 e2e coverage. No live Supabase project is connected in this
 * environment (docs/build-phase-2-report.md), so `x-rqi-auth-enforced` is
 * `false` and every route remains reachable without a session — these tests
 * verify that state is honest end-to-end (the proxy/middleware says so via
 * a response header, and every auth screen says so in its own UI) rather
 * than asserting a real sign-in flow this environment cannot exercise.
 */
test.describe('authentication (Supabase not configured in this environment)', () => {
  test('the proxy marks auth as not enforced via a response header, matching the unconfigured state', async ({
    page,
  }) => {
    const response = await page.goto('/dashboard')
    expect(response?.headers()['x-rqi-auth-enforced']).toBe('false')
  })

  test('sign-in, forgot-password, and reset-password all render an honest "not configured" state', async ({
    page,
  }) => {
    await page.goto('/sign-in')
    await expect(page.getByText(/authentication is not configured/i)).toBeVisible()
    await expect(page.getByLabel(/email/i)).toHaveCount(0)

    await page.goto('/forgot-password')
    await expect(page.getByText(/authentication is not configured/i)).toBeVisible()

    await page.goto('/reset-password')
    await expect(page.getByText(/authentication is not configured/i)).toBeVisible()
  })

  test('the unauthorized screen renders a generic, non-leaking message', async ({ page }) => {
    await page.goto('/unauthorized')
    await expect(page.getByRole('heading', { name: /you don't have access/i })).toBeVisible()
    await page.getByRole('link', { name: /back to dashboard/i }).click()
    await expect(page).toHaveURL(/\/dashboard$/)
  })

  test('the team settings shell lists members and states that inviting requires Supabase', async ({
    page,
  }) => {
    await page.goto('/settings/team')
    await expect(page.getByRole('heading', { name: /^team$/i })).toBeVisible()
    await expect(page.getByText('Dana Reyes')).toBeVisible()
    await expect(page.getByText(/requires a configured supabase project/i)).toBeVisible()
  })
})
