import { describe, expect, it } from 'vitest'
import { compareApprovedCandidates } from '../tools/shortlist'
import { createFakeSupabase } from '../orchestration/test-fake-supabase'
import { runCopilotTurn, type CopilotConversationProvider } from '../orchestration/run-copilot-turn'
import type {
  CopilotConversationLoopResult,
  CopilotToolExecutor,
} from '../orchestration/conversation-loop'
import {
  baseParams,
  baseSeed,
  CLIENT_A,
  CONVERSATION,
  ORG_A,
  PROJECT,
  SHORTLIST,
  USER,
} from './fixtures'

/**
 * Build Phase 11, Wave 5 — EVALUATION item 3 (governing brief: "hidden-note
 * leakage"). A `client_decision_maker`-scoped (`restricted_notes_excluded`)
 * conversation must never surface `recruiterNotes`/`recruiterNote`/
 * `reviewerNote` content — not in a raw tool output, and (more importantly,
 * since that is the actual user-facing surface) not in the final assistant
 * message text or citations after a full `runCopilotTurn`.
 *
 * `compareApprovedCandidates` is driven with REAL seed data containing a
 * recruiter note (`shortlist_candidates.recruiter_note`) — this is the one
 * tool in the registry whose output shape actually carries that field
 * (redaction.ts's own module comment). Build Phase 11 Wave 5 also fixed a
 * genuine bug found while writing this test: `compareApprovedCandidates`
 * was calling `loadShortlistDetail` with NO Supabase client at all (it
 * silently constructed its own via `createServerSupabaseClient()`,
 * discarding `ctx.supabase`), which made it both untestable against this
 * fake-Supabase harness and inconsistent with `runCopilotTurn`'s single-
 * client-per-turn invariant every other tool follows — see
 * `apps/web/lib/shortlists/load-detail.ts`'s `existingClient` parameter and
 * docs/build-phase-11-report.md for the full writeup.
 */

const HIDDEN_NOTE =
  'Flight risk — do not mention counter-offer to client. Salary expectation may be inflated in CV.'

function seedShortlistWithRecruiterNote(role: 'recruiter' | 'client_decision_maker') {
  return baseSeed({
    organization_memberships: [
      role === 'client_decision_maker'
        ? { organization_id: ORG_A, user_id: USER, role, status: 'active', client_id: CLIENT_A }
        : { organization_id: ORG_A, user_id: USER, role, status: 'active' },
    ],
    copilot_conversations: [
      {
        id: CONVERSATION,
        organization_id: ORG_A,
        user_id: USER,
        role_at_creation: role,
        client_id: role === 'client_decision_maker' ? CLIENT_A : null,
        recruitment_project_id: PROJECT,
        data_classification:
          role === 'client_decision_maker' ? 'restricted_notes_excluded' : 'standard',
        status: 'active',
      },
    ],
    shortlists: [
      {
        id: SHORTLIST,
        organization_id: ORG_A,
        recruitment_project_id: PROJECT,
        job_id: 'job-1',
        client_id: CLIENT_A,
        status: 'submitted_to_client',
        max_candidates: 3,
        current_version_id: 'ver-1',
      },
    ],
    jobs: [
      {
        id: 'job-1',
        organization_id: ORG_A,
        recruitment_project_id: PROJECT,
        title: 'Store Manager',
        status: 'active',
      },
    ],
    clients: [{ id: CLIENT_A, organization_id: ORG_A, name: 'Acme Retail' }],
    shortlist_versions: [
      { id: 'ver-1', organization_id: ORG_A, shortlist_id: SHORTLIST, status: 'submitted' },
    ],
    shortlist_candidates: [
      {
        id: 'sc-1',
        shortlist_version_id: 'ver-1',
        candidate_id: 'cand-1',
        candidate_role_match_id: 'crm-1',
        matching_run_id: 'run-1',
        scorecard_version_id: 'sv-1',
        rank: 1,
        recruiter_note: HIDDEN_NOTE,
      },
    ],
    candidates: [{ id: 'cand-1', organization_id: ORG_A, full_name: 'Jordan Smith' }],
    candidate_role_matches: [
      {
        id: 'crm-1',
        organization_id: ORG_A,
        candidate_id: 'cand-1',
        overall_score: 88,
        evidence_coverage_pct: 90,
        data_completeness_pct: 95,
      },
    ],
    mandatory_gate_results: [{ candidate_role_match_id: 'crm-1', state: 'passed' }],
  })
}

describe('EVALUATION — hidden-note leakage: recruiterNote/reviewerNote never reach a client_decision_maker', () => {
  it('the raw compareApprovedCandidates tool output OMITS recruiterNote entirely for a restricted_notes_excluded conversation (field absent, not merely nulled)', async () => {
    const seed = seedShortlistWithRecruiterNote('client_decision_maker')
    const supabase = createFakeSupabase(seed)
    const result = await compareApprovedCandidates(
      {
        supabase,
        organizationId: ORG_A,
        userId: USER,
        role: 'client_decision_maker',
        dataClassification: 'restricted_notes_excluded',
      },
      { shortlistId: SHORTLIST },
    )
    const candidate = result.output.candidates[0]!
    expect('recruiterNote' in candidate).toBe(false)
    // The rest of the comparison data (score, evidence coverage, gates) is
    // still present — redaction is field-scoped, not a wholesale block of
    // the tool.
    expect(candidate.candidateName).toBe('Jordan Smith')
    expect(candidate.overallScore).toBe(88)
    // No citation excerpt this tool builds is derived from the recruiter
    // note either (tools/shortlist.ts's citation excerpt uses only name/
    // rank/score).
    expect(result.citations.every((c) => !c.excerpt?.includes(HIDDEN_NOTE))).toBe(true)
  })

  it('the SAME tool output for an internal recruiter (standard classification) DOES include recruiterNote — proving this is real redaction, not an accidental universal omission', async () => {
    const seed = seedShortlistWithRecruiterNote('recruiter')
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
    expect(result.output.candidates[0]!.recruiterNote).toBe(HIDDEN_NOTE)
  })

  it('a full runCopilotTurn for a client_decision_maker never surfaces the recruiter note in the final assistant message, even against a WORST-CASE "model" that echoes the entire raw tool result verbatim', async () => {
    // A maximally uncooperative/compromised model would just dump whatever
    // the tool gave it straight into its answer, ignoring every prompt
    // instruction. This provider does exactly that on purpose — the point
    // of this test is that even THIS worst case leaks nothing, because
    // redaction (redaction.ts, applied inside compareApprovedCandidates
    // itself) happens BEFORE the data is ever handed to "the model", not
    // because a well-behaved model chose to omit it.
    class LeakAttemptProvider implements CopilotConversationProvider {
      readonly name = 'leak-attempt'
      async runConversationTurn(params: {
        executeTool: CopilotToolExecutor
      }): Promise<CopilotConversationLoopResult> {
        const toolResult = await params.executeTool('compare_approved_candidates', {
          shortlistId: SHORTLIST,
        })
        return {
          status: 'final',
          model: 'leak-attempt',
          finalRaw: { text: `Full raw data dump, verbatim: ${toolResult.content}`, claims: [] },
          toolCallsExecuted: [
            {
              name: 'compare_approved_candidates',
              input: { shortlistId: SHORTLIST },
              resultContent: toolResult.content,
              isError: toolResult.isError,
            },
          ],
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          iterations: 1,
        }
      }
    }

    const seed = seedShortlistWithRecruiterNote('client_decision_maker')
    const result = await runCopilotTurn(
      baseParams(seed, new LeakAttemptProvider(), { currentRole: 'client_decision_maker' }),
    )
    expect(result.status).toBe('success')
    if (result.status !== 'success') return
    expect(result.text).not.toContain(HIDDEN_NOTE)
    expect(result.text).not.toContain('counter-offer')
    expect(result.citations.every((c) => !(c.excerpt ?? '').includes(HIDDEN_NOTE))).toBe(true)
    // Confirms the tool actually ran and returned real data (not an error
    // that trivially contained nothing) — the leak-proof property is
    // genuine, not a vacuous pass.
    expect(result.text).toContain('Jordan Smith')
  })
})
