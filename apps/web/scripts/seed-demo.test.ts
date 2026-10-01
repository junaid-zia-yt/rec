import { describe, expect, it } from 'vitest'
import type { FrozenRequirement } from '@rqi/types'
import { buildCandidateEvidenceBundle } from '../lib/matching/evidence-bundle'
import { runMatchingPipeline } from '../lib/matching/matching-pipeline'
import { SampleAssessmentMatchingProvider } from '../lib/matching/demo-sample-assessment-provider'
import { canAddCandidateToShortlist } from '../lib/shortlists/rules'
import {
  DISTRICT_MANAGER_CANDIDATES,
  DISTRICT_MANAGER_ROLE,
  PRITI_CONFLICTING_NOTE,
  SASHA_CONFLICTING_NOTE,
  SHIFT_LEAD_CANDIDATES,
  SHIFT_LEAD_ROLE,
  type DemoCandidateDef,
  type DemoRoleDef,
} from './seed-demo'

/**
 * Build Phase 17D Wave A smoke test. No live Supabase project is connected
 * in this environment, so this test never calls `seedDemoData()` itself
 * (which needs a real database) — instead it exercises the exact same
 * fixture definitions and the exact same real deterministic pipeline
 * (`runMatchingPipeline` + `SampleAssessmentMatchingProvider`) the seed
 * script's DB-writing loop calls, proving the CORE DATA SHAPE the brief
 * asks for: expected candidate/scenario counts, and that a failed-
 * mandatory-gate candidate is correctly excluded from its shortlist by the
 * real `canAddCandidateToShortlist` rule (Core Rule #6).
 */

function frozenRequirements(role: DemoRoleDef): FrozenRequirement[] {
  return role.requirements.map((req, i) => ({
    requirementId: `${role.title}-req-${i}`,
    name: req.name,
    type: req.type,
    weight: req.weight,
  }))
}

async function evaluate(role: DemoRoleDef, candidate: DemoCandidateDef, extraNote?: unknown) {
  const evidence = buildCandidateEvidenceBundle({
    profile: null,
    experiences: candidate.experiences.map((e, i) => ({
      id: `exp-${i}`,
      company: e.company,
      title: e.title,
      location: null,
      startDate: e.startDate,
      endDate: e.endDate,
      isCurrent: e.isCurrent,
      description: e.description,
    })),
    education: [],
    certifications: candidate.certifications.map((c, i) => ({
      id: `cert-${i}`,
      name: c.name,
      issuingBody: c.issuingBody,
      issuedDate: c.issuedDate,
      expiresDate: c.expiresDate,
    })),
    skills: candidate.skills.map((s, i) => ({
      id: `skill-${i}`,
      skillName: s.skillName,
      proficiency: s.proficiency ?? null,
      yearsExperience: s.yearsExperience ?? null,
    })),
    extractedFields: [],
  })
  if (candidate.scenario === 'borderline' && extraNote) {
    evidence.push(extraNote as (typeof evidence)[number])
  }

  return runMatchingPipeline({
    jobTitle: role.title,
    requirements: frozenRequirements(role),
    candidateEvidence: evidence,
    aiProvider: new SampleAssessmentMatchingProvider(),
  })
}

describe('seed-demo.ts fixture data shape', () => {
  it('seeds 5 candidates per role, 10 total, each role covering every required scenario', () => {
    for (const candidates of [SHIFT_LEAD_CANDIDATES, DISTRICT_MANAGER_CANDIDATES]) {
      expect(candidates).toHaveLength(5)
      const scenarios = candidates.map((c) => c.scenario)
      expect(scenarios).toContain('clear_pass')
      expect(scenarios).toContain('clear_fail')
      expect(scenarios).toContain('borderline')
      expect(scenarios).toContain('missing_information')
      expect(scenarios.filter((s) => s === 'clear_pass')).toHaveLength(2)
    }
    expect(SHIFT_LEAD_CANDIDATES.length + DISTRICT_MANAGER_CANDIDATES.length).toBe(10)
  })

  it.each([
    ['Shift Lead role', SHIFT_LEAD_ROLE, SHIFT_LEAD_CANDIDATES, SASHA_CONFLICTING_NOTE],
    [
      'District Manager role',
      DISTRICT_MANAGER_ROLE,
      DISTRICT_MANAGER_CANDIDATES,
      PRITI_CONFLICTING_NOTE,
    ],
  ] as const)(
    '%s: the real deterministic pipeline computes the intended eligibility per scenario',
    async (_label, role, candidates, conflictingNote) => {
      for (const candidate of candidates) {
        const result = await evaluate(role, candidate, conflictingNote)
        expect(result.status).toBe('completed')
        const eligibility = result.deterministic?.eligibility

        switch (candidate.scenario) {
          case 'clear_pass':
          case 'borderline':
            // Borderline isolates preferred-scoring ambiguity only —
            // mandatory gates pass cleanly, so it is still eligible.
            expect(eligibility).toBe('eligible')
            break
          case 'clear_fail':
            expect(eligibility).toBe('ineligible')
            break
          case 'missing_information':
            expect(eligibility).toBe('pending_verification')
            break
        }
      }
    },
  )

  it('a clear_fail candidate is excluded from the shortlist by the real canAddCandidateToShortlist rule', async () => {
    const failCandidate = SHIFT_LEAD_CANDIDATES.find((c) => c.scenario === 'clear_fail')!
    const result = await evaluate(SHIFT_LEAD_ROLE, failCandidate)
    expect(result.deterministic?.eligibility).toBe('ineligible')

    const violation = canAddCandidateToShortlist({
      shortlist: { maxCandidates: 3, overrideMaxCandidates: false },
      existingCandidates: [],
      candidate: {
        candidateId: 'fail-candidate',
        eligibility: result.deterministic!.eligibility,
      },
    })
    expect(violation).not.toBeNull()
    expect(violation?.code).toBe('not_eligible')
  })

  it('a clear_pass candidate is accepted onto the shortlist by the same rule', async () => {
    const passCandidate = SHIFT_LEAD_CANDIDATES.find((c) => c.scenario === 'clear_pass')!
    const result = await evaluate(SHIFT_LEAD_ROLE, passCandidate)
    expect(result.deterministic?.eligibility).toBe('eligible')

    const violation = canAddCandidateToShortlist({
      shortlist: { maxCandidates: 3, overrideMaxCandidates: false },
      existingCandidates: [],
      candidate: {
        candidateId: 'pass-candidate',
        eligibility: result.deterministic!.eligibility,
      },
    })
    expect(violation).toBeNull()
  })
})
