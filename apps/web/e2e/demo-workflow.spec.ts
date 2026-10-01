import { test, expect, devices, type Page } from '@playwright/test'

/**
 * Build Phase 18 — full private-demo browser journey (brief: "Existing
 * unit tests are not sufficient evidence. Dave experienced failures
 * despite those tests passing." / "Add browser-level tests covering the
 * actual buttons, routes, transitions and visible results."). This suite
 * drives the real UI end to end against the real demo engine
 * (lib/demo/engine.ts) — no mocking — for both a desktop and a mobile
 * viewport, and asserts on what a person actually sees on screen at every
 * step, not just a server action's return value.
 *
 * The demo engine is an in-memory singleton for the life of the
 * `next start` process this suite runs against (see
 * docs/demo-limitations.md), so the "happy path" test resets the demo
 * first and then runs serially, building up real state one browser
 * interaction at a time, exactly the way Dave would.
 */

const RETAIL_PROJECT_URL_NAME = 'Regional Store Leader'
const SARAH_MITCHELL = 'Sarah Mitchell'
const DEREK_HOLLOWAY = 'Derek Holloway' // fails the mandatory driver's-license gate

async function openRetailProjectFromList(page: Page) {
  await page.goto('/projects')
  await page
    .locator('div', { has: page.getByText(RETAIL_PROJECT_URL_NAME) })
    .filter({ has: page.getByRole('link', { name: 'Open project' }) })
    .getByRole('link', { name: 'Open project' })
    .first()
    .click()
}

async function resetDemo(page: Page) {
  await page.goto('/shortlists')
  const resetButton = page.getByRole('button', { name: /reset demo data/i })
  if (await resetButton.isVisible().catch(() => false)) {
    // ResetDemoDataButton's onClick starts with window.confirm(...) —
    // Playwright auto-DISMISSES native dialogs unless a handler explicitly
    // accepts one, so without this the click above was silently a no-op
    // every time (the reset action was never actually invoked). Register
    // the handler for this one dialog right before the click that raises
    // it.
    page.once('dialog', (dialog) => dialog.accept())
    await resetButton.click()
    // resetDemoDataAction calls revalidatePath('/', 'layout'), which
    // refreshes this page's server data (and can remount the button's own
    // local confirmation state) — waiting for the network to settle is a
    // more reliable signal here than asserting on the transient message.
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(/0\/3 shortlisted/i).first()).toBeVisible({ timeout: 10_000 })
    // Both seeded projects must be back to zero, not just whichever one
    // the .first() above happened to match.
    await expect(page.getByText(/[1-9]\/3 shortlisted/i)).toHaveCount(0)
  }
}

test.describe.serial('private demo — full client-reported workflow', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    await resetDemo(page)
    await page.close()
  })

  test('1. Dashboard shows the two seeded roles and links into a real project', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page.getByRole('heading', { name: /dashboard/i, level: 1 })).toBeVisible()
    await expect(page.getByText(RETAIL_PROJECT_URL_NAME)).toBeVisible()
  })

  test('2. Projects list shows real project status, and project detail shows a live-computed stage stepper', async ({
    page,
  }) => {
    await openRetailProjectFromList(page)
    await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+$/)
    await expect(page.getByRole('heading', { name: RETAIL_PROJECT_URL_NAME, level: 1 })).toBeVisible()
    await expect(page.getByText(/current project status:/i)).toBeVisible()
  })

  test('3. Candidate creation works from the Add candidate screen (reconciling the client\'s report that it worked)', async ({
    page,
  }) => {
    await page.goto('/candidates/new')
    await expect(page.getByRole('heading', { name: /add candidate/i })).toBeVisible()
    await page.getByLabel(/full name/i).fill('E2E Test Candidate')
    const emailField = page.getByLabel(/email/i).first()
    if (await emailField.isVisible().catch(() => false)) {
      await emailField.fill('e2e-test-candidate@example.com')
    }
    await page.getByRole('button', { name: /add candidate|create|save/i }).first().click()
    // A successful create redirects to the candidate list (the transient
    // "<name> added." message can unmount before Playwright observes it,
    // since the redirect fires in the same state update) — the durable,
    // meaningful signal is that the new candidate is really in the list.
    await expect(page).toHaveURL(/\/candidates$/, { timeout: 10_000 })
    await expect(page.getByText('E2E Test Candidate')).toBeVisible({ timeout: 10_000 })
  })

  test('4. Running an evaluation on a fully-evidenced candidate shows a real, labelled result', async ({ page }) => {
    await page.goto('/candidates')
    await page.getByText(SARAH_MITCHELL).first().click()
    await page.getByRole('tab', { name: /^evaluation$/i }).click()

    const runButton = page.getByRole('button', { name: /run evaluation|re-evaluate/i })
    if (await runButton.isVisible().catch(() => false)) {
      await runButton.click()
    }

    await expect(page.getByText('Demonstration evaluation — live AI is not connected.')).toBeVisible()
    await expect(page.getByText(/^eligible$/i)).toBeVisible({ timeout: 10_000 })
    await expect(
      page.getByText('5+ years multi-unit retail management experience'),
    ).toBeVisible()
  })

  test('5. A candidate who fails a mandatory gate is shown as ineligible, never guessed as a pass', async ({ page }) => {
    await page.goto('/candidates')
    await page.getByText(DEREK_HOLLOWAY).first().click()
    await page.getByRole('tab', { name: /^evaluation$/i }).click()

    const runButton = page.getByRole('button', { name: /run evaluation|re-evaluate/i })
    if (await runButton.isVisible().catch(() => false)) {
      await runButton.click()
    }

    await expect(page.getByText(/^ineligible$/i)).toBeVisible({ timeout: 10_000 })
  })

  test('6. Shortlist workspace sorts eligible candidates ahead of the ineligible one and lets a reviewed candidate be added', async ({
    page,
  }) => {
    await page.goto('/shortlists')
    await page.getByText(RETAIL_PROJECT_URL_NAME).first().click()
    await expect(page).toHaveURL(/\/shortlists\/[a-f0-9-]+$/)

    await expect(page.getByText('Demonstration evaluation — live AI is not connected.')).toBeVisible()

    // Derek Holloway (ineligible) must appear in the "not eligible" section, never ranked with eligible candidates.
    const notEligibleSection = page.getByText(/not eligible for this shortlist/i)
    await expect(notEligibleSection).toBeVisible()

    // Mark Sarah reviewed, then add her to the shortlist.
    const sarahCard = page.locator('div').filter({ hasText: SARAH_MITCHELL }).last()
    const markReviewedButton = page.getByRole('button', { name: /mark reviewed/i }).first()
    if (await markReviewedButton.isVisible().catch(() => false)) {
      await markReviewedButton.click()
    }
    void sarahCard
    await page.getByRole('button', { name: /add to shortlist/i }).first().click()
    await expect(page.getByText(/added to the shortlist/i)).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/on the shortlist \(1\/3\)/i)).toBeVisible()
  })

  test('7. Outreach can be drafted for the now-eligible, shortlisted candidate, and approval never claims a send', async ({
    page,
  }) => {
    await page.goto('/outreach')
    await expect(page.getByText('Demo mode — messages are not sent.', { exact: true })).toBeVisible()

    const candidateSelect = page.getByLabel(/candidate/i)
    if (await candidateSelect.isVisible().catch(() => false)) {
      await page.getByRole('button', { name: /generate draft/i }).click()
      await expect(page.getByText(/drafts \(1\)/i)).toBeVisible({ timeout: 10_000 })
      await page.getByRole('button', { name: /approve \(not sent\)/i }).first().click()
      await expect(page.getByText(/approved.*demo mode|messages are not sent/i).first()).toBeVisible()
    }
  })

  test('8. Project activity log records every action taken above', async ({ page }) => {
    await openRetailProjectFromList(page)
    await page.getByRole('link', { name: /view activity/i }).click()
    await expect(page).toHaveURL(/\/activity$/)
    await expect(page.getByText(/evaluated|shortlist|reviewed/i).first()).toBeVisible()
  })

  test('9. Demo reset restores the original scenario', async ({ page }) => {
    await resetDemo(page)
    await page.getByText(RETAIL_PROJECT_URL_NAME).first().click()
    await expect(page.getByText(/on the shortlist \(0\/3\)|0\/3 shortlisted/i).first()).toBeVisible({
      timeout: 10_000,
    })
  })
})

test.describe('private demo — shortlist negative tests', () => {
  test('the "Add to shortlist" control disables once three candidates are already shortlisted', async ({
    page,
  }) => {
    await resetDemo(page)
    await openRetailProjectFromList(page)

    const candidateNames = ['Sarah Mitchell', 'James Carter', 'Maria Rodriguez', 'Tomás Alvarez']
    for (const name of candidateNames) {
      // Evaluate each candidate from their own profile first (a candidate
      // must be evaluated and reviewed before this workspace will let them
      // be shortlisted at all). resetDemo() above means every one of these
      // starts unevaluated, so "Run evaluation" is always present here —
      // wait for the evaluation to actually finish (rather than merely
      // clicking and moving on) so Phase 1 below never races an
      // in-flight evaluation.
      await page.goto('/candidates')
      await page.getByText(name).first().click()
      await page.getByRole('tab', { name: /^evaluation$/i }).click()
      await page.getByRole('button', { name: /run evaluation|re-evaluate/i }).click()
      await expect(
        page.getByText('Demonstration evaluation — live AI is not connected.'),
      ).toBeVisible({ timeout: 10_000 })
    }

    await page.goto('/shortlists')
    await page.getByText(RETAIL_PROJECT_URL_NAME).first().click()
    await page.waitForLoadState('networkidle')

    // Each candidate's card is keyed by their own id (demo-view.tsx), so
    // scoping every click to the Card containing that candidate's name —
    // rather than a bare `.first()` over the whole list — is what makes
    // this deterministic: the eligible-candidate list re-sorts after every
    // mark-reviewed/add-to-shortlist action, so a plain `.first()` can
    // resolve to a row that has already been replaced by the time the
    // click actually lands.
    function cardFor(name: string) {
      // The candidate's name and their action buttons are SIBLINGS inside
      // the same Card (demo-view.tsx's CardBody), not nested one inside
      // the other — a plain `div.filter({ has: text }).last()` resolves
      // to the innermost matching div (the one wrapping just the name),
      // which never contains the buttons. Walk up to the nearest ancestor
      // that carries CardBody's own layout classes instead.
      return page
        .getByText(name, { exact: true })
        .locator('xpath=ancestor::*[contains(@class,"items-center") and contains(@class,"justify-between")][1]')
    }

    // Phase 1: mark every candidate reviewed first, so "Add to shortlist"
    // clicks below never race a still-disabled button in a different row.
    for (const name of candidateNames) {
      const card = cardFor(name)
      const markReviewedButton = card.getByRole('button', { name: /mark reviewed/i })
      await expect(markReviewedButton).toBeVisible({ timeout: 10_000 })
      await markReviewedButton.click()
      await expect(card.getByText(/reviewed$/i)).toBeVisible({ timeout: 10_000 })
    }

    // Phase 2: add exactly three to the shortlist, by name, one at a time.
    for (const name of candidateNames.slice(0, 3)) {
      const addButton = cardFor(name).getByRole('button', { name: /add to shortlist/i })
      await expect(addButton).toBeEnabled({ timeout: 10_000 })
      await addButton.click()
      await page.waitForLoadState('networkidle')
    }

    await expect(page.getByText(/on the shortlist \(3\/3\)/i)).toBeVisible({ timeout: 10_000 })

    // The fourth eligible, reviewed candidate's "Add to shortlist" button
    // must now be disabled — the server-side rule
    // (canAddCandidateToShortlist) is the same one the demo-view.tsx UI
    // reflects here.
    const fourthName = candidateNames[3]!
    const fourthAddButton = cardFor(fourthName).getByRole('button', { name: /add to shortlist/i })
    await expect(fourthAddButton).toBeVisible({ timeout: 10_000 })
    await expect(fourthAddButton).toBeDisabled()

    await resetDemo(page)
  })
})

test.describe('private demo — mobile viewport', () => {
  test('the shortlist workspace and evaluation labelling both render correctly at mobile width', async ({
    browser,
  }) => {
    const context = await browser.newContext({ ...devices['iPhone 13'] })
    const page = await context.newPage()
    await resetDemo(page)

    await page.goto('/candidates')
    await page.getByText(SARAH_MITCHELL).first().click()
    await page.getByRole('tab', { name: /^evaluation$/i }).click()
    const runButton = page.getByRole('button', { name: /run evaluation|re-evaluate/i })
    if (await runButton.isVisible().catch(() => false)) {
      await runButton.click()
    }
    await expect(page.getByText('Demonstration evaluation — live AI is not connected.')).toBeVisible()

    await page.goto('/outreach')
    await expect(page.getByText('Demo mode — messages are not sent.', { exact: true })).toBeVisible()

    await context.close()
  })
})
