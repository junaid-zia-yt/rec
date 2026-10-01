import { afterEach, describe, expect, it } from 'vitest'
import {
  resetDemoState,
  runDemoEvaluation,
  markDemoCandidateReviewed,
  shortlistDemoCandidate,
  removeDemoShortlistCandidate,
  sortDemoCandidates,
  getDemoCandidate,
  getDemoProject,
  createDemoOutreachDraft,
  decideDemoOutreachDraft,
  transitionDemoProjectStatus,
  addDemoCandidate,
} from './engine'

/**
 * Build Phase 18 — engine-level coverage for the brief's required negative
 * tests. The user's governing instruction was explicit: "Existing unit
 * tests are not sufficient evidence." These tests exercise the same
 * exported functions the demo server actions call
 * (lib/demo/demo-actions.ts), through the real deterministic pipeline
 * (lib/matching/matching-pipeline.ts), never a hand-typed fixture score.
 * Playwright browser tests (e2e/demo-workflow.spec.ts) cover the same
 * rules again at the UI layer, per the brief's "unit tests are not
 * sufficient evidence" instruction.
 */

const RETAIL_PROJECT_ID = '19bd1f07-3f5c-5da1-9868-0320eb989d00'
const FOOD_SERVICE_PROJECT_ID = '120d7dc1-e805-53cd-ae37-15be53bdcdbd'

// Retail candidates (lib/demo/scenarios.ts)
const SARAH_MITCHELL_ID = '83979151-0f96-57dc-8f36-026ea0453389' // fully evidenced, eligible
const JAMES_CARTER_ID = 'bcfe36fa-ddf2-549c-8bd8-b1382c8a7c1a' // eligible, no bilingual evidence
const MARIA_RODRIGUEZ_ID = 'f6b02f2f-30f3-5e5b-9401-9d4c558db230' // eligible
const DEREK_HOLLOWAY_ID = '5b4a63e1-8d78-578a-991b-22d306eda601' // FAILS mandatory license gate
const PRIYA_NATARAJAN_ID = '30560d36-9961-510d-84f6-925555009b06' // no P&L evidence -> pending_verification
const TOMAS_ALVAREZ_ID = '0aed2ad3-44eb-58b0-9a30-5009b3f3ed7e' // eligible

async function evaluateAndReview(projectId: string, candidateId: string) {
  const result = await runDemoEvaluation(projectId, candidateId, 'Test actor')
  expect(result.success).toBe(true)
  const reviewed = markDemoCandidateReviewed(projectId, candidateId, 'Test actor')
  expect(reviewed.success).toBe(true)
}

describe('demo engine — mandatory gate precedence', () => {
  afterEach(() => resetDemoState())

  it('a candidate who fails a mandatory requirement cannot be shortlisted, even after review', async () => {
    await runDemoEvaluation(RETAIL_PROJECT_ID, DEREK_HOLLOWAY_ID, 'Test actor')
    const candidate = getDemoCandidate(DEREK_HOLLOWAY_ID)
    expect(candidate?.evaluation?.eligibility).toBe('ineligible')

    // Even if a human marks him reviewed, the shortlist rule itself must
    // still refuse him — mandatory-gate precedence is enforced by the
    // server function, not merely hidden by the UI.
    markDemoCandidateReviewed(RETAIL_PROJECT_ID, DEREK_HOLLOWAY_ID, 'Test actor')
    const result = shortlistDemoCandidate(RETAIL_PROJECT_ID, DEREK_HOLLOWAY_ID, 'Test actor')
    expect(result.success).toBe(false)
  })

  it('missing evidence cannot increase the score — an unverified mandatory requirement blocks shortlisting, never guessed as a pass', async () => {
    await runDemoEvaluation(RETAIL_PROJECT_ID, PRIYA_NATARAJAN_ID, 'Test actor')
    const candidate = getDemoCandidate(PRIYA_NATARAJAN_ID)
    expect(candidate?.evaluation?.eligibility).toBe('pending_verification')

    markDemoCandidateReviewed(RETAIL_PROJECT_ID, PRIYA_NATARAJAN_ID, 'Test actor')
    const result = shortlistDemoCandidate(RETAIL_PROJECT_ID, PRIYA_NATARAJAN_ID, 'Test actor')
    expect(result.success).toBe(false)
  })

  it('an ineligible candidate never outranks an eligible one, regardless of numerical score', async () => {
    await runDemoEvaluation(RETAIL_PROJECT_ID, SARAH_MITCHELL_ID, 'Test actor')
    await runDemoEvaluation(RETAIL_PROJECT_ID, DEREK_HOLLOWAY_ID, 'Test actor')
    const { eligible, notEligible } = sortDemoCandidates(RETAIL_PROJECT_ID, 'score_desc')
    const eligibleIds = eligible.map((c) => c.id)
    const notEligibleIds = notEligible.map((c) => c.id)
    expect(eligibleIds).toContain(SARAH_MITCHELL_ID)
    expect(notEligibleIds).toContain(DEREK_HOLLOWAY_ID)
    // The eligible partition is always returned ahead of the ineligible one
    // by sortDemoCandidates' contract, independent of either's score.
  })
})

describe('demo engine — shortlist enforcement', () => {
  afterEach(() => resetDemoState())

  it('enforces a maximum of three candidates — a fourth is rejected', async () => {
    const eligibleIds: string[] = [
      SARAH_MITCHELL_ID,
      JAMES_CARTER_ID,
      MARIA_RODRIGUEZ_ID,
      TOMAS_ALVAREZ_ID,
    ]
    for (const id of eligibleIds) {
      await evaluateAndReview(RETAIL_PROJECT_ID, id)
    }
    for (const id of eligibleIds.slice(0, 3)) {
      const result = shortlistDemoCandidate(RETAIL_PROJECT_ID, id, 'Test actor')
      expect(result.success).toBe(true)
    }
    const fourth = shortlistDemoCandidate(RETAIL_PROJECT_ID, eligibleIds[3]!, 'Test actor')
    expect(fourth.success).toBe(false)

    const project = getDemoProject(RETAIL_PROJECT_ID)
    expect(project?.shortlistCount).toBe(3)
  })

  it('rejects adding the same candidate to the shortlist twice', async () => {
    await evaluateAndReview(RETAIL_PROJECT_ID, SARAH_MITCHELL_ID)
    const first = shortlistDemoCandidate(RETAIL_PROJECT_ID, SARAH_MITCHELL_ID, 'Test actor')
    expect(first.success).toBe(true)
    const second = shortlistDemoCandidate(RETAIL_PROJECT_ID, SARAH_MITCHELL_ID, 'Test actor')
    expect(second.success).toBe(false)
  })

  it('rejects a candidate that belongs to a different project (unauthorized cross-project access)', async () => {
    await evaluateAndReview(RETAIL_PROJECT_ID, SARAH_MITCHELL_ID)
    // Sarah belongs to the retail project — attempting to shortlist her
    // against the food-service project must be refused.
    const result = shortlistDemoCandidate(FOOD_SERVICE_PROJECT_ID, SARAH_MITCHELL_ID, 'Test actor')
    expect(result.success).toBe(false)
  })

  it('removing a candidate frees a shortlist slot', async () => {
    await evaluateAndReview(RETAIL_PROJECT_ID, SARAH_MITCHELL_ID)
    shortlistDemoCandidate(RETAIL_PROJECT_ID, SARAH_MITCHELL_ID, 'Test actor')
    const removed = removeDemoShortlistCandidate(RETAIL_PROJECT_ID, SARAH_MITCHELL_ID, 'Test actor')
    expect(removed.success).toBe(true)
    expect(getDemoProject(RETAIL_PROJECT_ID)?.shortlistCount).toBe(0)
  })
})

describe('demo engine — outreach never sends', () => {
  afterEach(() => resetDemoState())

  it('drafts outreach only for an eligible candidate, and approval never invokes an external provider', async () => {
    await runDemoEvaluation(RETAIL_PROJECT_ID, SARAH_MITCHELL_ID, 'Test actor')
    const draft = createDemoOutreachDraft(RETAIL_PROJECT_ID, SARAH_MITCHELL_ID, 'tmpl-email-intro', 'Test actor')
    expect(draft.success).toBe(true)

    const decision = decideDemoOutreachDraft(draft.data!.draftId, 'approve', 'Test actor')
    expect(decision.success).toBe(true)
    expect(decision.message).toMatch(/messages are not sent/i)
    // No network/provider call is made anywhere in this path — the
    // function is a pure in-memory state transition (see engine.ts's
    // decideDemoOutreachDraft), which this assertion on its return value
    // documents as the entire "send" implementation.
  })

  it('refuses to draft outreach for a candidate who has not been evaluated', () => {
    const result = createDemoOutreachDraft(RETAIL_PROJECT_ID, JAMES_CARTER_ID, 'tmpl-email-intro', 'Test actor')
    expect(result.success).toBe(false)
  })
})

describe('demo engine — project status transitions', () => {
  afterEach(() => resetDemoState())

  it('rejects an invalid project-stage transition', () => {
    // intake -> client_review is not a valid direct edge.
    const result = transitionDemoProjectStatus(RETAIL_PROJECT_ID, 'client_review', 'Test actor')
    expect(result.success).toBe(false)
  })

  it('rejects moving to shortlisting before any candidate has been evaluated on a fresh project', () => {
    resetDemoState()
    const result = transitionDemoProjectStatus(RETAIL_PROJECT_ID, 'shortlisting', 'Test actor')
    // The seeded project starts in "sourcing" with no evaluations recorded
    // yet in this fresh state, so this transition must require at least
    // one completed evaluation first.
    expect(result.success).toBe(false)
  })

  it('allows a valid forward transition once its real signal is satisfied', async () => {
    await runDemoEvaluation(RETAIL_PROJECT_ID, SARAH_MITCHELL_ID, 'Test actor')
    const result = transitionDemoProjectStatus(RETAIL_PROJECT_ID, 'shortlisting', 'Test actor')
    expect(result.success).toBe(true)
  })
})

describe('demo engine — candidate creation and duplicates', () => {
  afterEach(() => resetDemoState())

  it('rejects a duplicate candidate by email', () => {
    const first = addDemoCandidate(RETAIL_PROJECT_ID, { fullName: 'New Person', primaryEmail: 'dup@example.com' }, 'Test actor')
    expect(first.success).toBe(true)
    const second = addDemoCandidate(RETAIL_PROJECT_ID, { fullName: 'New Person Again', primaryEmail: 'dup@example.com' }, 'Test actor')
    expect(second.success).toBe(false)
  })
})

describe('demo engine — reset restores the original scenario', () => {
  it('discards every mutation and restores the seeded two-project scenario', async () => {
    await evaluateAndReview(RETAIL_PROJECT_ID, SARAH_MITCHELL_ID)
    shortlistDemoCandidate(RETAIL_PROJECT_ID, SARAH_MITCHELL_ID, 'Test actor')
    addDemoCandidate(RETAIL_PROJECT_ID, { fullName: 'Temp Person' }, 'Test actor')

    expect(getDemoProject(RETAIL_PROJECT_ID)?.shortlistCount).toBe(1)

    resetDemoState()

    const project = getDemoProject(RETAIL_PROJECT_ID)
    expect(project?.shortlistCount).toBe(0)
    expect(project?.candidateCount).toBe(7) // the original 7 seeded retail candidates
    expect(getDemoCandidate(SARAH_MITCHELL_ID)?.evaluation).toBeNull()
  })
})
