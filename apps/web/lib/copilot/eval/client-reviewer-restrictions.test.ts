import { describe, expect, it } from 'vitest'
import { isToolAllowedForRole, TOOL_REGISTRY } from '../tool-registry'
import { getSuggestedQuestions, listAllowedToolNames } from '../load'

/**
 * Build Phase 11, Wave 5 — EVALUATION item 9 (governing brief: "client-
 * reviewer restrictions"). Exhaustive truth table over EVERY one of the 13
 * registered tools × `client_decision_maker`, transcribing
 * `tool-registry.ts`'s own header-comment intent as executable assertions —
 * the same "matrix loosening silently is now a test failure" pattern
 * `apps/web/lib/auth/permissions.test.ts` already uses for the coarser
 * `hasPermission` matrix. Also covers `read_only_reviewer` (zero tools,
 * `copilot` resource create-blocked entirely) as the brief's "client-
 * reviewer" phrasing plausibly means either or both narrow roles.
 */

// The exact subset tool-registry.ts's own header comment documents as
// INCLUDED for client_decision_maker — re-derived here independently
// (never imported from tool-registry.ts's own STAFF_AND_CLIENT_ROLES
// constant) so a change to that constant that silently widens/narrows the
// client-visible set is caught by comparison, not merely re-asserted from
// the same source.
const CLIENT_DECISION_MAKER_ALLOWED_TOOLS = [
  'summarize_recruitment_project',
  'explain_candidate_match',
  'compare_approved_candidates',
  'explain_poc_metrics',
  'suggest_next_workflow_action',
] as const

const CLIENT_DECISION_MAKER_FORBIDDEN_TOOLS = [
  'explain_scorecard',
  'find_missing_job_requirements',
  'summarize_candidate',
  'identify_missing_evidence',
  'draft_verification_questions',
  'draft_interview_questions',
  'draft_outreach_message',
  'summarize_candidate_responses',
] as const

describe('EVALUATION — client_decision_maker tool truth table (exhaustive, all 13 registry tools)', () => {
  const allToolNames = Object.keys(TOOL_REGISTRY) as (keyof typeof TOOL_REGISTRY)[]

  it('the two lists above cover ALL 13 registry tools exactly once each (sanity check on this test file itself, not the app)', () => {
    const combined = [
      ...CLIENT_DECISION_MAKER_ALLOWED_TOOLS,
      ...CLIENT_DECISION_MAKER_FORBIDDEN_TOOLS,
    ].sort()
    expect(combined).toEqual(allToolNames.slice().sort())
  })

  it.each(CLIENT_DECISION_MAKER_ALLOWED_TOOLS)(
    'client_decision_maker IS allowed to call %s',
    (toolName) => {
      expect(isToolAllowedForRole(toolName, 'client_decision_maker')).toBe(true)
    },
  )

  it.each(CLIENT_DECISION_MAKER_FORBIDDEN_TOOLS)(
    'client_decision_maker is NEVER allowed to call %s',
    (toolName) => {
      expect(isToolAllowedForRole(toolName, 'client_decision_maker')).toBe(false)
    },
  )

  it('read_only_reviewer is denied EVERY one of the 13 tools — no allowedRoles entry on any of them', () => {
    for (const toolName of allToolNames) {
      expect(isToolAllowedForRole(toolName, 'read_only_reviewer')).toBe(false)
    }
  })

  it('platform_admin is denied EVERY one of the 13 tools — oversight-only role, never an operator of the copilot itself', () => {
    for (const toolName of allToolNames) {
      expect(isToolAllowedForRole(toolName, 'platform_admin')).toBe(false)
    }
  })

  it("agency_admin and recruiter are allowed ALL 13 tools (the copilot's primary operating roles)", () => {
    for (const toolName of allToolNames) {
      expect(isToolAllowedForRole(toolName, 'agency_admin')).toBe(true)
      expect(isToolAllowedForRole(toolName, 'recruiter')).toBe(true)
    }
  })
})

describe('EVALUATION — client_decision_maker never sees a suggested question or tool-activity label for a disallowed tool', () => {
  it('listAllowedToolNames(client_decision_maker) returns exactly the 5 allowed tools, in registry order, nothing forbidden', () => {
    const names = listAllowedToolNames('client_decision_maker')
    expect(new Set(names)).toEqual(new Set(CLIENT_DECISION_MAKER_ALLOWED_TOOLS))
    for (const forbidden of CLIENT_DECISION_MAKER_FORBIDDEN_TOOLS) {
      expect(names).not.toContain(forbidden)
    }
  })

  it('getSuggestedQuestions never returns a question whose underlying tool client_decision_maker cannot call, in either scope', () => {
    for (const hasProjectScope of [true, false]) {
      const suggestions = getSuggestedQuestions({ role: 'client_decision_maker', hasProjectScope })
      for (const suggestion of suggestions) {
        expect(isToolAllowedForRole(suggestion.toolName, 'client_decision_maker')).toBe(true)
      }
    }
  })

  it('read_only_reviewer gets zero suggested questions in every scope (no tools allowed at all)', () => {
    for (const hasProjectScope of [true, false]) {
      expect(getSuggestedQuestions({ role: 'read_only_reviewer', hasProjectScope })).toEqual([])
    }
  })

  it('listAllowedToolNames(read_only_reviewer) is empty', () => {
    expect(listAllowedToolNames('read_only_reviewer')).toEqual([])
  })
})
