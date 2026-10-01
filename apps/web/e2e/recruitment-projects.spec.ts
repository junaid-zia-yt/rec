import { test, expect, devices } from '@playwright/test'

/**
 * Build Phase 3 smoke test — client management, recruitment projects, and
 * job intake screens. Like e2e/auth.spec.ts, this runs against the
 * unconfigured (demo-mode) state, since no live Supabase project is
 * connected in this environment; it verifies the demo fixtures render and
 * primary navigation between the new screens works, at both desktop and
 * mobile viewports, per the Build Phase 3 brief's "Desktop and mobile core
 * journey" testing requirement.
 */
test.describe('client and project management (demo mode)', () => {
  test('clients list renders demo clients and supports search', async ({ page }) => {
    await page.goto('/clients')

    await expect(page.getByRole('heading', { name: /clients/i, level: 1 })).toBeVisible()
    await expect(page.getByText('Northfield Retail Group')).toBeVisible()
    await expect(page.getByText('Harborline Food Service Group')).toBeVisible()

    await page.getByLabel(/search clients/i).fill('harborline')
    await expect(page.getByText('Northfield Retail Group')).not.toBeVisible()
    await expect(page.getByText('Harborline Food Service Group')).toBeVisible()
  })

  test('projects list links to Clients, and a project opens to show its jobs and activity link', async ({
    page,
  }) => {
    await page.goto('/projects')
    await expect(page.getByRole('link', { name: 'Clients' })).toBeVisible()

    await page.getByRole('link', { name: 'Open project' }).first().click()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('link', { name: /view activity/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /add job/i })).toBeVisible()
  })

  test('job description screen shows the demo pasted version', async ({ page }) => {
    await page.goto('/projects/proj-1/jobs/job-1/description')
    await expect(page.getByText(/demo version/i)).toBeVisible()
  })

  test('mobile: Clients is reachable from the More screen', async ({ browser }) => {
    const context = await browser.newContext({ ...devices['iPhone 13'] })
    const page = await context.newPage()

    await page.goto('/more')
    await expect(page.getByRole('link', { name: 'Clients' })).toBeVisible()
    await page.getByRole('link', { name: 'Clients' }).click()
    await expect(page).toHaveURL(/\/clients$/)
    await expect(page.getByText('Northfield Retail Group')).toBeVisible()

    await context.close()
  })
})
