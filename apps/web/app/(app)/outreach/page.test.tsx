import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@rqi/testing'
import OutreachPage from './page'
import {
  resetDemoState,
  runDemoEvaluation,
  createDemoOutreachDraft,
  decideDemoOutreachDraft,
} from '@/lib/demo/engine'

// Build Phase 18 priority #7 ("Implement outreach drafting and approval in
// demo mode"). This used to assert on a fixed empty state that rendered no
// matter what happened elsewhere in the demo (see
// docs/client-feedback-reproduction-report.md §6 — no mock outreach
// activity existed at all). It now exercises the real demo engine: only an
// eligible candidate can be drafted for, and approving a draft never
// invokes an external provider — it is a pure state transition.

const RETAIL_PROJECT_ID = '19bd1f07-3f5c-5da1-9868-0320eb989d00'
const SARAH_MITCHELL_ID = '83979151-0f96-57dc-8f36-026ea0453389'

describe('OutreachPage', () => {
  afterEach(() => {
    resetDemoState()
  })

  it('shows the demo-mode notice and an honest empty state before any candidate is eligible', async () => {
    render(await OutreachPage())
    expect(screen.getByText('Demo mode — messages are not sent.')).toBeInTheDocument()
    expect(
      screen.getByText(/no candidate has passed every mandatory requirement yet/i),
    ).toBeInTheDocument()
    expect(screen.getByText('Drafts (0)')).toBeInTheDocument()
  })

  it('lets an eligible candidate be drafted for, and approving never sends a message', async () => {
    await runDemoEvaluation(RETAIL_PROJECT_ID, SARAH_MITCHELL_ID, 'Test actor')
    const draft = createDemoOutreachDraft(
      RETAIL_PROJECT_ID,
      SARAH_MITCHELL_ID,
      'tmpl-email-intro',
      'Test actor',
    )
    expect(draft.success).toBe(true)

    render(await OutreachPage())
    expect(screen.getAllByText(/Sarah Mitchell/).length).toBeGreaterThan(0)
    expect(screen.getByText('Drafts (1)')).toBeInTheDocument()
    expect(screen.getByText(/Approve \(not sent\)/i)).toBeInTheDocument()

    const decision = decideDemoOutreachDraft(draft.data!.draftId, 'approve', 'Test actor')
    expect(decision.success).toBe(true)
    expect(decision.message).toMatch(/messages are not sent/i)
  })

  it('refuses to draft outreach for a candidate who has not passed every mandatory requirement', () => {
    // No evaluation has been run at all — the server-side rule (not just
    // the UI) must reject this.
    const result = createDemoOutreachDraft(
      RETAIL_PROJECT_ID,
      SARAH_MITCHELL_ID,
      'tmpl-email-intro',
      'Test actor',
    )
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/mandatory requirement/i)
  })
})
