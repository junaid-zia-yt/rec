import { describe, expect, it } from 'vitest'
import { compareApprovedCandidates } from '../tools/shortlist'
import { createFakeSupabase } from '../orchestration/test-fake-supabase'
import { ResourceOwnershipError } from '../resource-ownership'
import { baseSeed, CLIENT_A, ORG_A, ORG_B, PROJECT, SHORTLIST, USER } from './fixtures'

/**
 * Build Phase 11, Wave 5 — EVALUATION item 7 (governing brief: "incorrect
 * candidate comparison"). `compare_approved_candidates` is the only tool
 * whose whole job is to compare several candidate records side by side —
 * the one place a bug could quietly blend candidates from different jobs,
 * different shortlists, or non-approved candidates into one comparison.
 * `loadShortlistDetail` (apps/web/lib/shortlists/load-detail.ts) sources its
 * candidate set from exactly one `shortlist_version_id` — this suite proves
 * that scoping actually holds under adversarial input, never assumed from
 * reading the query once.
 */

function seedWithTwoShortlists() {
  return baseSeed({
    organization_memberships: [
      { organization_id: ORG_A, user_id: USER, role: 'recruiter', status: 'active' },
    ],
    project_assignments: [{ id: 'pa-1', user_id: USER, recruitment_project_id: PROJECT }],
    jobs: [
      {
        id: 'job-a',
        organization_id: ORG_A,
        recruitment_project_id: PROJECT,
        title: 'Store Manager',
        status: 'active',
      },
      {
        id: 'job-b',
        organization_id: ORG_A,
        recruitment_project_id: PROJECT,
        title: 'Assistant Manager',
        status: 'active',
      },
    ],
    clients: [{ id: CLIENT_A, organization_id: ORG_A, name: 'Acme Retail' }],
    shortlists: [
      {
        id: SHORTLIST,
        organization_id: ORG_A,
        recruitment_project_id: PROJECT,
        job_id: 'job-a',
        client_id: CLIENT_A,
        status: 'submitted_to_client',
        max_candidates: 3,
        current_version_id: 'ver-a',
      },
      {
        id: 'shortlist-b',
        organization_id: ORG_A,
        recruitment_project_id: PROJECT,
        job_id: 'job-b',
        client_id: CLIENT_A,
        status: 'draft',
        max_candidates: 3,
        current_version_id: 'ver-b',
      },
    ],
    shortlist_versions: [
      { id: 'ver-a', organization_id: ORG_A, shortlist_id: SHORTLIST, status: 'submitted' },
      { id: 'ver-b', organization_id: ORG_A, shortlist_id: 'shortlist-b', status: 'draft' },
    ],
    shortlist_candidates: [
      {
        id: 'sc-a1',
        shortlist_version_id: 'ver-a',
        candidate_id: 'cand-a1',
        candidate_role_match_id: 'crm-a1',
        matching_run_id: 'run-a1',
        scorecard_version_id: 'sv-a',
        rank: 1,
        recruiter_note: null,
      },
      // A DIFFERENT shortlist's (job-b's) candidate — must never leak into shortlist A's comparison.
      {
        id: 'sc-b1',
        shortlist_version_id: 'ver-b',
        candidate_id: 'cand-b1',
        candidate_role_match_id: 'crm-b1',
        matching_run_id: 'run-b1',
        scorecard_version_id: 'sv-b',
        rank: 1,
        recruiter_note: null,
      },
    ],
    candidates: [
      { id: 'cand-a1', organization_id: ORG_A, full_name: 'Store Manager Candidate' },
      { id: 'cand-b1', organization_id: ORG_A, full_name: 'Assistant Manager Candidate' },
    ],
    candidate_role_matches: [
      {
        id: 'crm-a1',
        organization_id: ORG_A,
        candidate_id: 'cand-a1',
        overall_score: 80,
        evidence_coverage_pct: 90,
        data_completeness_pct: 90,
      },
      {
        id: 'crm-b1',
        organization_id: ORG_A,
        candidate_id: 'cand-b1',
        overall_score: 70,
        evidence_coverage_pct: 85,
        data_completeness_pct: 85,
      },
    ],
    mandatory_gate_results: [
      { candidate_role_match_id: 'crm-a1', state: 'passed' },
      { candidate_role_match_id: 'crm-b1', state: 'passed' },
    ],
  })
}

describe('EVALUATION — incorrect candidate comparison', () => {
  it("never blends candidates from a DIFFERENT job's shortlist into this shortlist's comparison", async () => {
    const seed = seedWithTwoShortlists()
    const supabase = createFakeSupabase(seed)
    const result = await compareApprovedCandidates(
      {
        supabase,
        organizationId: ORG_A,
        userId: USER,
        role: 'recruiter',
        dataClassification: 'standard',
      },
      { shortlistId: SHORTLIST },
    )
    expect(result.output.jobId).toBe('job-a')
    expect(result.output.candidates).toHaveLength(1)
    expect(result.output.candidates[0]!.candidateName).toBe('Store Manager Candidate')
    expect(
      result.output.candidates.some((c) => c.candidateName === 'Assistant Manager Candidate'),
    ).toBe(false)
  })

  it('refuses cleanly rather than fabricating a comparison for a shortlist id that does not exist', async () => {
    // `compareApprovedCandidates` runs `assertResourceOwnership` BEFORE
    // `loadShortlistDetail` — a nonexistent id and an unowned id therefore
    // collapse into the SAME fail-closed `ResourceOwnershipError` (ownership
    // of a row that doesn't exist is, correctly, "no") rather than reaching
    // `loadShortlistDetail`'s own `CopilotToolInputError` "not found" path at
    // all. This is the stronger, fail-closed ordering — asserted directly
    // rather than assumed.
    const seed = seedWithTwoShortlists()
    const supabase = createFakeSupabase(seed)
    await expect(
      compareApprovedCandidates(
        {
          supabase,
          organizationId: ORG_A,
          userId: USER,
          role: 'recruiter',
          dataClassification: 'standard',
        },
        { shortlistId: '00000000-0000-0000-0000-000000000099' },
      ),
    ).rejects.toThrow(ResourceOwnershipError)
  })

  it('refuses a shortlist belonging to a DIFFERENT organization (ownership check runs before any data is read)', async () => {
    const seed = baseSeed({
      shortlists: [
        {
          id: SHORTLIST,
          organization_id: ORG_B,
          client_id: 'client-b',
          recruitment_project_id: PROJECT,
        },
      ],
    })
    const supabase = createFakeSupabase(seed)
    await expect(
      compareApprovedCandidates(
        {
          supabase,
          organizationId: ORG_A,
          userId: USER,
          role: 'recruiter',
          dataClassification: 'standard',
        },
        { shortlistId: SHORTLIST },
      ),
    ).rejects.toThrow(ResourceOwnershipError)
  })

  it('a shortlist with no current version / no candidates yet returns an EMPTY comparison, never an invented placeholder candidate', async () => {
    const seed = baseSeed({
      shortlists: [
        {
          id: SHORTLIST,
          organization_id: ORG_A,
          recruitment_project_id: PROJECT,
          job_id: 'job-a',
          client_id: CLIENT_A,
          status: 'draft',
          max_candidates: 3,
          current_version_id: null,
        },
      ],
      jobs: [
        {
          id: 'job-a',
          organization_id: ORG_A,
          recruitment_project_id: PROJECT,
          title: 'Store Manager',
          status: 'active',
        },
      ],
      clients: [{ id: CLIENT_A, organization_id: ORG_A, name: 'Acme Retail' }],
    })
    const supabase = createFakeSupabase(seed)
    const result = await compareApprovedCandidates(
      {
        supabase,
        organizationId: ORG_A,
        userId: USER,
        role: 'recruiter',
        dataClassification: 'standard',
      },
      { shortlistId: SHORTLIST },
    )
    expect(result.output.candidates).toEqual([])
    expect(result.citations).toEqual([])
  })

  it("a client_decision_maker can only compare a shortlist belonging to their OWN represented client, never another client's", async () => {
    const seed = seedWithTwoShortlists()
    seed.organization_memberships = [
      {
        organization_id: ORG_A,
        user_id: USER,
        role: 'client_decision_maker',
        status: 'active',
        client_id: 'some-other-client',
      },
    ]
    const supabase = createFakeSupabase(seed)
    await expect(
      compareApprovedCandidates(
        {
          supabase,
          organizationId: ORG_A,
          userId: USER,
          role: 'client_decision_maker',
          dataClassification: 'restricted_notes_excluded',
        },
        { shortlistId: SHORTLIST }, // belongs to CLIENT_A, not 'some-other-client'
      ),
    ).rejects.toThrow(ResourceOwnershipError)
  })
})
