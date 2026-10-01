import { afterEach, describe, expect, it } from 'vitest'
import { render, screen, userEvent } from '@rqi/testing'
import CandidateDetailPage from './page'
import { resetDemoState, runDemoEvaluation, getDemoProjectIdForJob } from '@/lib/demo/engine'

// Build Phase 18: these tests used to exercise the dead "AI match preview"
// legacy tab against static cand-1/cand-2 mock-data fixtures that no longer
// exist (see docs/client-feedback-reproduction-report.md §1 — the real
// Evaluation tab was hardcoded to empty arrays regardless of what happened
// in demo mode). They now run a candidate through the SAME deterministic
// pipeline a live "Run evaluation" click uses (lib/demo/engine.ts's
// runDemoEvaluation) and assert on the real Evaluation tab's output —
// never inventing evidence, and honestly showing missing evidence as
// unverified/insufficient rather than a guessed pass.

const RETAIL_PROJECT_ID = '19bd1f07-3f5c-5da1-9868-0320eb989d00'
// Sarah Mitchell — evidence captured for every requirement on the retail role.
const SARAH_MITCHELL_ID = '83979151-0f96-57dc-8f36-026ea0453389'
// Priya Natarajan — no evidence at all for the mandatory P&L requirement
// (sourced via cold outreach, CV not yet parsed) — see lib/demo/scenarios.ts.
const PRIYA_NATARAJAN_ID = '30560d36-9961-510d-84f6-925555009b06'

describe('CandidateDetailPage', () => {
  afterEach(() => {
    resetDemoState()
  })

  it('never invents evidence for a mandatory requirement with none captured, and marks it unverified rather than a guessed pass', async () => {
    await runDemoEvaluation(RETAIL_PROJECT_ID, PRIYA_NATARAJAN_ID, 'Test actor')

    render(await CandidateDetailPage({ params: Promise.resolve({ candidateId: PRIYA_NATARAJAN_ID }) }))
    const user = userEvent.setup()
    await user.click(screen.getByRole('tab', { name: /^evaluation$/i }))

    // The mandatory P&L requirement has zero evidence items for this
    // candidate — missing information must be marked unverified
    // (pending_verification), never silently treated as a pass.
    expect(
      screen.getByText('5+ years multi-unit retail management experience'),
    ).toBeInTheDocument()
    expect(screen.getByText(/pending verification/i)).toBeInTheDocument()
    expect(screen.getByText(/never treated as a pass/i)).toBeInTheDocument()
  })

  it('renders a fully-evidenced candidate as eligible with every mandatory gate passed', async () => {
    await runDemoEvaluation(RETAIL_PROJECT_ID, SARAH_MITCHELL_ID, 'Test actor')

    render(await CandidateDetailPage({ params: Promise.resolve({ candidateId: SARAH_MITCHELL_ID }) }))
    const user = userEvent.setup()
    await user.click(screen.getByRole('tab', { name: /^evaluation$/i }))

    expect(screen.getByText(/^eligible$/i)).toBeInTheDocument()
    expect(
      screen.getByText('5+ years multi-unit retail management experience'),
    ).toBeInTheDocument()
  })

  it('shows an honest "not evaluated yet" state before any evaluation has run', async () => {
    render(await CandidateDetailPage({ params: Promise.resolve({ candidateId: PRIYA_NATARAJAN_ID }) }))
    const user = userEvent.setup()
    await user.click(screen.getByRole('tab', { name: /^evaluation$/i }))
    expect(getDemoProjectIdForJob).toBeDefined() // sanity: helper is exported for the page's jobId lookup
    expect(screen.queryByText(/^eligible$/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^ineligible$/i)).not.toBeInTheDocument()
  })
})
