import { test, expect, devices } from '@playwright/test'

/**
 * Build Phase 1 smoke test (brief §10): open the dashboard, verify the
 * shell, navigate to Projects, navigate to Candidates, switch to a mobile
 * viewport, verify the mobile nav. No visual/pixel assertions — this only
 * checks the shell renders and primary navigation works end to end.
 */
test.describe('application shell smoke test', () => {
  test('desktop: shell renders and primary navigation works', async ({ page }) => {
    await page.goto('/dashboard')

    await expect(page.getByRole('heading', { name: /dashboard/i, level: 1 })).toBeVisible()
    await expect(page.getByText('Recruitment Quality Intelligence')).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Primary' }).first()).toBeVisible()

    await page
      .getByRole('navigation', { name: 'Primary' })
      .first()
      .getByRole('link', { name: 'Recruitment Projects' })
      .click()
    await expect(page).toHaveURL(/\/projects$/)
    await expect(
      page.getByRole('heading', { name: /recruitment projects/i, level: 1 }),
    ).toBeVisible()

    await page
      .getByRole('navigation', { name: 'Primary' })
      .first()
      .getByRole('link', { name: 'Candidate Pipeline' })
      .click()
    await expect(page).toHaveURL(/\/candidates$/)
    await expect(page.getByRole('heading', { name: /candidates/i, level: 1 })).toBeVisible()
  })

  test('mobile: bottom navigation is visible and usable', async ({ browser }) => {
    const context = await browser.newContext({ ...devices['iPhone 13'] })
    const page = await context.newPage()

    await page.goto('/dashboard')

    const mobileNav = page.getByRole('navigation', { name: 'Primary' }).last()
    await expect(mobileNav).toBeVisible()
    await expect(mobileNav.getByRole('link', { name: /Home/i })).toBeVisible()
    await expect(mobileNav.getByRole('link', { name: /Projects/i })).toBeVisible()
    await expect(mobileNav.getByRole('link', { name: /Candidates/i })).toBeVisible()
    await expect(mobileNav.getByRole('link', { name: /Shortlists/i })).toBeVisible()
    await expect(mobileNav.getByRole('link', { name: /More/i })).toBeVisible()

    await mobileNav.getByRole('link', { name: /Candidates/i }).click()
    await expect(page).toHaveURL(/\/candidates$/)

    await context.close()
  })
})
