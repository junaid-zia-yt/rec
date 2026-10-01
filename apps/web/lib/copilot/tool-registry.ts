import 'server-only'
import { z, type ZodTypeAny } from 'zod'
import type { CopilotToolName, Role } from '@rqi/types'
import type { CopilotToolContext, CopilotToolHandlerResult } from './tools/shared'

import {
  SummarizeRecruitmentProjectInputSchema,
  SummarizeRecruitmentProjectOutputSchema,
  summarizeRecruitmentProject,
  ExplainScorecardInputSchema,
  ExplainScorecardOutputSchema,
  explainScorecard,
  FindMissingJobRequirementsInputSchema,
  FindMissingJobRequirementsOutputSchema,
  findMissingJobRequirements,
} from './tools/project'
import {
  SummarizeCandidateInputSchema,
  SummarizeCandidateOutputSchema,
  summarizeCandidate,
  ExplainCandidateMatchInputSchema,
  ExplainCandidateMatchOutputSchema,
  explainCandidateMatch,
  IdentifyMissingEvidenceInputSchema,
  IdentifyMissingEvidenceOutputSchema,
  identifyMissingEvidence,
} from './tools/candidate'
import {
  CompareApprovedCandidatesInputSchema,
  CompareApprovedCandidatesOutputSchema,
  compareApprovedCandidates,
} from './tools/shortlist'
import {
  DraftVerificationQuestionsInputSchema,
  DraftVerificationQuestionsOutputSchema,
  draftVerificationQuestions,
  DraftInterviewQuestionsInputSchema,
  DraftInterviewQuestionsOutputSchema,
  draftInterviewQuestions,
  DraftOutreachMessageInputSchema,
  DraftOutreachMessageOutputSchema,
  draftOutreachMessage,
} from './tools/drafting'
import {
  SummarizeCandidateResponsesInputSchema,
  SummarizeCandidateResponsesOutputSchema,
  summarizeCandidateResponses,
} from './tools/responses'
import {
  ExplainPocMetricsInputSchema,
  ExplainPocMetricsOutputSchema,
  explainPocMetrics,
} from './tools/poc'
import {
  SuggestNextWorkflowActionInputSchema,
  SuggestNextWorkflowActionOutputSchema,
  suggestNextWorkflowAction,
} from './tools/workflow'

/**
 * Build Phase 11, Wave 2 — the central, exhaustive copilot tool allowlist.
 *
 * `supabase/migrations/0031_copilot.sql`'s `copilot_tool_calls.tool_name`
 * CHECK constraint already allowlists exactly these 13 values at the
 * database layer, independent of this file (0031's own header note: "DB-
 * CHECK-enforced independently of the application-layer allowlist wave 2
 * also enforces — defense in depth"). This registry is the APPLICATION
 * layer half of that defense-in-depth pair, and the ONLY place wave 3's
 * orchestration code should ever look up which tool to call, what its
 * input/output shapes are, or whether a given role may call it — never a
 * bespoke switch statement elsewhere.
 *
 * ROLE -> TOOL-SUBSET MAPPING (packages/types/src/permissions.ts's `copilot`
 * resource comment flags this as an OPEN DESIGN QUESTION for wave 2 to
 * resolve — this is that resolution). Reasoning is documented per tool
 * below; the overall shape:
 *
 *   - platform_admin: NO tools. The `copilot` resource matrix grants
 *     platform_admin only 'read' (oversight of other users' conversation
 *     records for audit purposes — 0031's read-only cross-org policy), not
 *     the ability to operate the copilot themselves in a tenant's context
 *     (mirrors the `organizations` row's platform_admin: 'read' — oversees,
 *     does not operate). A platform_admin has no allowedRoles entry on any
 *     of the 13 tools below.
 *   - agency_admin: ALL 13 tools. Full operational + oversight role
 *     ('full' on `copilot`), and every one of the 13 capabilities is
 *     something an agency admin legitimately does as a recruiter would, or
 *     needs for audit/quality oversight.
 *   - recruiter: ALL 13 tools. The copilot's primary day-to-day user
 *     (`copilot` resource: 'full'); every capability in the brief's list is
 *     squarely a recruiter's own workflow.
 *   - client_decision_maker: A DELIBERATELY NARROW subset — the brief's own
 *     example list ("summarize-project/explain-POC-metrics-they-can-see
 *     only, never candidate internal notes or scorecards with recruiter-
 *     only content", quoted in permissions.ts's copilot resource comment).
 *     Included: summarize_recruitment_project (their own project only —
 *     resource-ownership.ts's client branch already narrows this to
 *     projects belonging to their represented client), explain_candidate_
 *     match (only reachable for a candidate_role_match whose candidate is
 *     client_visible on a project of theirs — resource-ownership.ts's
 *     clientCanAccessCandidate), compare_approved_candidates (their own
 *     shortlist only), explain_poc_metrics (their own benchmark only),
 *     suggest_next_workflow_action (suggestions are independently filtered
 *     through hasPermission for THEIR role inside the handler itself, so
 *     this tool can never suggest an action they could not actually take).
 *     Excluded, explicitly: explain_scorecard / find_missing_job_
 *     requirements (a scorecard's requirement descriptions and evidence-
 *     expected text are recruiter/agency working detail, never part of the
 *     `scorecards` resource's client_decision_maker: 'none' grant — see
 *     permissions.ts MATRIX), summarize_candidate (candidate profiles carry
 *     recruiter_notes and full extraction detail beyond what a client
 *     should see even after redaction — the redacted PROFILE alone is
 *     still a broader candidate-detail surface than the brief intends for
 *     a client; explain_candidate_match's narrower, already-scored,
 *     already-redacted view is the client-safe equivalent), identify_
 *     missing_evidence (internal quality-review workflow — `human_reviews`
 *     resource is client_decision_maker: 'none' entirely), draft_
 *     verification_questions / draft_interview_questions / draft_
 *     outreach_message (all internal recruiter drafting actions — outreach
 *     resource itself is client_decision_maker: 'none'), summarize_
 *     candidate_responses (candidate replies are an internal recruiter
 *     communication channel, never surfaced to the client directly).
 *   - read_only_reviewer: NO tools. `copilot` resource grants only 'read',
 *     and `hasPermission('read_only_reviewer', 'copilot', 'create')` is
 *     already false at the conversation-creation layer (permissions.ts's
 *     own comment: "this role's application-layer gate blocks starting a
 *     new conversation entirely... has nothing of their own to read"). No
 *     allowedRoles entry on any tool, consistent with that.
 *
 * `requiresConfirmation` is `false` for all 13, documented individually
 * below rather than left as an unexplained default: every one of the 13
 * capabilities is read/summarize/explain/compare/draft/suggest — NONE of
 * them writes to a candidate/job/shortlist/outreach record (see
 * gate-override-guard.ts's FORBIDDEN_COPILOT_WRITE_TARGETS list, which no
 * tool handler here imports or calls). `copilot_tool_calls.requires_
 * confirmation`/`confirmed_at`/`confirmed_by` (0031) remain unused
 * propose -> confirm scaffolding until a FUTURE wave adds an actual
 * mutation tool (e.g. "apply this draft as a real outreach message") — that
 * future tool, and only that one, would set `requiresConfirmation: true`.
 */

export interface CopilotToolDefinition<
  TInput extends ZodTypeAny = ZodTypeAny,
  TOutput extends ZodTypeAny = ZodTypeAny,
> {
  toolName: CopilotToolName
  description: string
  inputSchema: TInput
  outputSchema: TOutput
  /** Roles permitted to invoke this tool. Deny by default: a role NOT listed here is denied even though the coarse `copilot` resource grant (permissions.ts) might otherwise allow the conversation to exist. */
  allowedRoles: readonly Role[]
  requiresConfirmation: false
  requiresConfirmationReason: string
  handler: (
    ctx: CopilotToolContext,
    input: z.infer<TInput>,
  ) => Promise<CopilotToolHandlerResult<z.infer<TOutput>>>
}

const NEVER_MUTATES =
  'This tool only reads/summarizes/explains/drafts/compares/suggests — it never writes to a candidate, job, scorecard, shortlist, or outreach record (see gate-override-guard.ts), so there is nothing here for a human to confirm.'

const STAFF_ROLES: readonly Role[] = ['agency_admin', 'recruiter']
const STAFF_AND_CLIENT_ROLES: readonly Role[] = [
  'agency_admin',
  'recruiter',
  'client_decision_maker',
]

export const TOOL_REGISTRY = {
  summarize_recruitment_project: {
    toolName: 'summarize_recruitment_project',
    description:
      'Summarizes a recruitment project: its jobs, status, and candidate pipeline counts.',
    inputSchema: SummarizeRecruitmentProjectInputSchema,
    outputSchema: SummarizeRecruitmentProjectOutputSchema,
    allowedRoles: STAFF_AND_CLIENT_ROLES,
    requiresConfirmation: false,
    requiresConfirmationReason: NEVER_MUTATES,
    handler: summarizeRecruitmentProject,
  },
  explain_scorecard: {
    toolName: 'explain_scorecard',
    description:
      "Explains a job's scorecard: its requirements, types, weights, and verification status.",
    inputSchema: ExplainScorecardInputSchema,
    outputSchema: ExplainScorecardOutputSchema,
    allowedRoles: STAFF_ROLES,
    requiresConfirmation: false,
    requiresConfirmationReason: NEVER_MUTATES,
    handler: explainScorecard,
  },
  find_missing_job_requirements: {
    toolName: 'find_missing_job_requirements',
    description:
      "Finds gaps in a job's requirements: missing evidence-expected text, unverified requirements, or no scorecard at all.",
    inputSchema: FindMissingJobRequirementsInputSchema,
    outputSchema: FindMissingJobRequirementsOutputSchema,
    allowedRoles: STAFF_ROLES,
    requiresConfirmation: false,
    requiresConfirmationReason: NEVER_MUTATES,
    handler: findMissingJobRequirements,
  },
  summarize_candidate: {
    toolName: 'summarize_candidate',
    description: 'Summarizes a candidate: profile, evidence completeness, and verification status.',
    inputSchema: SummarizeCandidateInputSchema,
    outputSchema: SummarizeCandidateOutputSchema,
    allowedRoles: STAFF_ROLES,
    requiresConfirmation: false,
    requiresConfirmationReason: NEVER_MUTATES,
    handler: summarizeCandidate,
  },
  explain_candidate_match: {
    toolName: 'explain_candidate_match',
    description:
      "Explains a candidate's match result: eligibility, gates, score breakdown, and confidence.",
    inputSchema: ExplainCandidateMatchInputSchema,
    outputSchema: ExplainCandidateMatchOutputSchema,
    allowedRoles: STAFF_AND_CLIENT_ROLES,
    requiresConfirmation: false,
    requiresConfirmationReason: NEVER_MUTATES,
    handler: explainCandidateMatch,
  },
  compare_approved_candidates: {
    toolName: 'compare_approved_candidates',
    description: "Compares the candidates on a shortlist's current version side by side.",
    inputSchema: CompareApprovedCandidatesInputSchema,
    outputSchema: CompareApprovedCandidatesOutputSchema,
    allowedRoles: STAFF_AND_CLIENT_ROLES,
    requiresConfirmation: false,
    requiresConfirmationReason: NEVER_MUTATES,
    handler: compareApprovedCandidates,
  },
  identify_missing_evidence: {
    toolName: 'identify_missing_evidence',
    description:
      'Lists exactly which gates, scoring criteria, and extracted fields are missing evidence or verification for a candidate match.',
    inputSchema: IdentifyMissingEvidenceInputSchema,
    outputSchema: IdentifyMissingEvidenceOutputSchema,
    allowedRoles: STAFF_ROLES,
    requiresConfirmation: false,
    requiresConfirmationReason: NEVER_MUTATES,
    handler: identifyMissingEvidence,
  },
  draft_verification_questions: {
    toolName: 'draft_verification_questions',
    description:
      "Drafts questions to verify a candidate's currently unverified or missing evidence.",
    inputSchema: DraftVerificationQuestionsInputSchema,
    outputSchema: DraftVerificationQuestionsOutputSchema,
    allowedRoles: STAFF_ROLES,
    requiresConfirmation: false,
    requiresConfirmationReason: NEVER_MUTATES,
    handler: draftVerificationQuestions,
  },
  draft_interview_questions: {
    toolName: 'draft_interview_questions',
    description: "Drafts interview questions grounded in a job's scorecard requirements.",
    inputSchema: DraftInterviewQuestionsInputSchema,
    outputSchema: DraftInterviewQuestionsOutputSchema,
    allowedRoles: STAFF_ROLES,
    requiresConfirmation: false,
    requiresConfirmationReason: NEVER_MUTATES,
    handler: draftInterviewQuestions,
  },
  draft_outreach_message: {
    toolName: 'draft_outreach_message',
    description:
      'Drafts a personalized outreach message for a candidate, grounded in their verified evidence (never sends it).',
    inputSchema: DraftOutreachMessageInputSchema,
    outputSchema: DraftOutreachMessageOutputSchema,
    allowedRoles: STAFF_ROLES,
    requiresConfirmation: false,
    requiresConfirmationReason:
      'Drafting text is not itself a mutation of any candidate/job/outreach record — nothing is persisted or sent by this tool (mirrors apps/web/lib/outreach/channels/linkedin.ts\'s "no send() exists" structure). A FUTURE tool that actually saves this draft as a real outreach_messages row, or a future one that sends it, would need requiresConfirmation: true (and would itself still need the existing approval-required/opt-out hard gates, brief: "must not approve outreach") — neither exists in this registry.',
    handler: draftOutreachMessage,
  },
  summarize_candidate_responses: {
    toolName: 'summarize_candidate_responses',
    description:
      'Summarizes the inbound responses a candidate has sent, with their AI-suggested and human-confirmed classifications.',
    inputSchema: SummarizeCandidateResponsesInputSchema,
    outputSchema: SummarizeCandidateResponsesOutputSchema,
    allowedRoles: STAFF_ROLES,
    requiresConfirmation: false,
    requiresConfirmationReason: NEVER_MUTATES,
    handler: summarizeCandidateResponses,
  },
  explain_poc_metrics: {
    toolName: 'explain_poc_metrics',
    description:
      "Explains a POC benchmark's already-computed metrics, vendor vs. client, with the correlation-vs-causation disclaimer.",
    inputSchema: ExplainPocMetricsInputSchema,
    outputSchema: ExplainPocMetricsOutputSchema,
    allowedRoles: STAFF_AND_CLIENT_ROLES,
    requiresConfirmation: false,
    requiresConfirmationReason: NEVER_MUTATES,
    handler: explainPocMetrics,
  },
  suggest_next_workflow_action: {
    toolName: 'suggest_next_workflow_action',
    description:
      'Suggests which already-permitted next workflow action the caller could take, given the current status of their project/job/shortlist/outreach — never performs the action itself.',
    inputSchema: SuggestNextWorkflowActionInputSchema,
    outputSchema: SuggestNextWorkflowActionOutputSchema,
    allowedRoles: STAFF_AND_CLIENT_ROLES,
    requiresConfirmation: false,
    requiresConfirmationReason:
      NEVER_MUTATES +
      " Every suggestion this tool returns is additionally filtered through hasPermission() for the caller's own live role before being included, so it can never suggest an action outside what their role could already do.",
    handler: suggestNextWorkflowAction,
  },
} as const satisfies Record<CopilotToolName, CopilotToolDefinition>

export type CopilotToolRegistryKey = keyof typeof TOOL_REGISTRY

/** True only when `role` is in the tool's `allowedRoles` list — deny by default, allowlist by exception. Never based on anything the model claims; always evaluated against the caller's CURRENT, live role (see tools/shared.ts's CopilotToolContext doc). */
export function isToolAllowedForRole(toolName: CopilotToolName, role: Role): boolean {
  const entry = TOOL_REGISTRY[toolName]
  return (entry.allowedRoles as readonly Role[]).includes(role)
}

export function getToolDefinition(toolName: CopilotToolName): CopilotToolDefinition {
  return TOOL_REGISTRY[toolName]
}
