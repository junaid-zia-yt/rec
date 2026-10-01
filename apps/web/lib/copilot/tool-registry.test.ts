import { describe, expect, it } from 'vitest'
import type { Role } from '@rqi/types'
import { EXPECTED_COPILOT_TOOL_NAMES } from './gate-override-guard'
import { TOOL_REGISTRY, isToolAllowedForRole } from './tool-registry'

const ALL_ROLES: Role[] = [
  'platform_admin',
  'agency_admin',
  'recruiter',
  'client_decision_maker',
  'read_only_reviewer',
]

describe('TOOL_REGISTRY', () => {
  it("has exactly the 13 allowlisted tool names, matching gate-override-guard.ts's independently-maintained list", () => {
    const registryKeys = Object.keys(TOOL_REGISTRY).sort()
    expect(registryKeys).toEqual([...EXPECTED_COPILOT_TOOL_NAMES].sort())
    expect(registryKeys).toHaveLength(13)
  })

  it('never requires confirmation for any tool (no mutation tool exists this wave)', () => {
    for (const definition of Object.values(TOOL_REGISTRY)) {
      expect(definition.requiresConfirmation).toBe(false)
      expect(definition.requiresConfirmationReason.length).toBeGreaterThan(0)
    }
  })

  it('never allows platform_admin or read_only_reviewer to call any tool', () => {
    for (const definition of Object.values(TOOL_REGISTRY)) {
      expect(definition.allowedRoles).not.toContain('platform_admin')
      expect(definition.allowedRoles).not.toContain('read_only_reviewer')
    }
  })

  it('always allows agency_admin and recruiter (the two full-access operational roles)', () => {
    for (const definition of Object.values(TOOL_REGISTRY)) {
      expect(definition.allowedRoles).toContain('agency_admin')
      expect(definition.allowedRoles).toContain('recruiter')
    }
  })

  it('excludes client_decision_maker from every recruiter-only / internal drafting tool', () => {
    const clientForbidden = [
      'explain_scorecard',
      'find_missing_job_requirements',
      'summarize_candidate',
      'identify_missing_evidence',
      'draft_verification_questions',
      'draft_interview_questions',
      'draft_outreach_message',
      'summarize_candidate_responses',
    ] as const

    for (const toolName of clientForbidden) {
      expect(TOOL_REGISTRY[toolName].allowedRoles).not.toContain('client_decision_maker')
    }
  })

  it('permits client_decision_maker only on the narrow, brief-specified subset', () => {
    const clientAllowed = [
      'summarize_recruitment_project',
      'explain_candidate_match',
      'compare_approved_candidates',
      'explain_poc_metrics',
      'suggest_next_workflow_action',
    ] as const

    for (const toolName of clientAllowed) {
      expect(TOOL_REGISTRY[toolName].allowedRoles).toContain('client_decision_maker')
    }

    const totalWithClient = Object.values(TOOL_REGISTRY).filter((d) =>
      (d.allowedRoles as readonly Role[]).includes('client_decision_maker'),
    ).length
    expect(totalWithClient).toBe(clientAllowed.length)
  })

  it("isToolAllowedForRole agrees with the registry's allowedRoles for every (tool, role) pair", () => {
    for (const definition of Object.values(TOOL_REGISTRY)) {
      for (const role of ALL_ROLES) {
        expect(isToolAllowedForRole(definition.toolName, role)).toBe(
          (definition.allowedRoles as readonly Role[]).includes(role),
        )
      }
    }
  })

  it('every tool schema pair is a real Zod schema (input/output both parse an empty-ish shape without throwing at the schema-construction level)', () => {
    for (const definition of Object.values(TOOL_REGISTRY)) {
      expect(typeof definition.inputSchema.safeParse).toBe('function')
      expect(typeof definition.outputSchema.safeParse).toBe('function')
    }
  })
})
