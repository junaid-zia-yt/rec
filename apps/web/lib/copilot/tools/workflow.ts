import 'server-only'
import { z } from 'zod'
import { hasPermission } from '@rqi/types'
import { assertResourceOwnership } from '../resource-ownership'
import { nextLegalOutreachMessageStatuses } from '@/lib/outreach/status-transitions'
import type { OutreachMessageStatus } from '@rqi/types'
import { type CopilotToolContext, type CopilotToolHandlerResult } from './shared'

/**
 * Build Phase 11, Wave 2 — suggest_next_workflow_action.
 *
 * The most novel of the 13 tools (task brief): looks at where a
 * project/job/candidate/shortlist/outreach message currently sits in its
 * own already-existing status lifecycle and suggests, in STRUCTURED form
 * (wave 3 turns this into a sentence — no free text is authored here,
 * matching this wave's "zero direct AI calls" constraint), which of the
 * role's ALREADY-PERMITTED next actions they could take. Every suggestion
 * is filtered through `hasPermission(role, resource, action)` before it is
 * ever included — this tool NEVER suggests an action the caller's role
 * would not actually be allowed to perform, and it never claims to perform
 * the action itself (`permitted: true` on a row is a description of what
 * the UI would let them click, not something this tool does).
 */

export const SuggestNextWorkflowActionInputSchema = z.object({
  recruitmentProjectId: z.string().uuid(),
  jobId: z.string().uuid().nullable().optional(),
  shortlistId: z.string().uuid().nullable().optional(),
  outreachMessageId: z.string().uuid().nullable().optional(),
})
export type SuggestNextWorkflowActionInput = z.infer<typeof SuggestNextWorkflowActionInputSchema>

const SuggestionSchema = z.object({
  action: z.string(),
  description: z.string(),
  /** Always true for anything actually included in `suggestions` — a denied suggestion is filtered out before output, never surfaced with permitted: false. Kept as an explicit field (rather than omitting denied ones silently) so a future test can assert the invariant directly. */
  permitted: z.literal(true),
})

export const SuggestNextWorkflowActionOutputSchema = z.object({
  recruitmentProjectId: z.string(),
  suggestions: z.array(SuggestionSchema),
})
export type SuggestNextWorkflowActionOutput = z.infer<typeof SuggestNextWorkflowActionOutputSchema>

export async function suggestNextWorkflowAction(
  ctx: CopilotToolContext,
  input: SuggestNextWorkflowActionInput,
): Promise<CopilotToolHandlerResult<SuggestNextWorkflowActionOutput>> {
  const { supabase, organizationId, userId, role } = ctx

  const ownership = await assertResourceOwnership(supabase, {
    organizationId,
    userId,
    role,
    resourceType: 'recruitment_project',
    resourceId: input.recruitmentProjectId,
  })

  const suggestions: { action: string; description: string; permitted: true }[] = []
  const allow = (
    resource: Parameters<typeof hasPermission>[1],
    action: Parameters<typeof hasPermission>[2],
  ) => hasPermission(role, resource, action)

  const { data: project } = await supabase
    .from('recruitment_projects')
    .select('status')
    .eq('id', input.recruitmentProjectId)
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (project?.status === 'intake' && allow('recruitment_projects', 'update')) {
    suggestions.push({
      action: 'open_project',
      description:
        'This project is still in intake. Add a job and upload a job description to begin building the scorecard.',
      permitted: true,
    })
  }

  if (input.jobId) {
    const [{ data: scorecard }, { data: requirements }] = await Promise.all([
      supabase
        .from('scorecards')
        .select('id')
        .eq('job_id', input.jobId)
        .eq('organization_id', organizationId)
        .maybeSingle(),
      supabase
        .from('job_requirements')
        .select('id')
        .eq('job_id', input.jobId)
        .eq('organization_id', organizationId),
    ])

    if (!scorecard && allow('scorecards', 'create')) {
      suggestions.push({
        action: 'extract_requirements',
        description:
          'No scorecard exists for this job yet. Run requirement extraction from the job description to start one.',
        permitted: true,
      })
    } else if (scorecard && (requirements ?? []).length > 0 && allow('scorecards', 'update')) {
      const { data: version } = await supabase
        .from('scorecard_versions')
        .select('status')
        .eq('scorecard_id', scorecard.id)
        .order('version_no', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (version?.status === 'draft' && allow('scorecards', 'update')) {
        suggestions.push({
          action: 'submit_scorecard_for_approval',
          description:
            'The scorecard is drafted. Submit it for approval so candidate matching can begin.',
          permitted: true,
        })
      }
    }

    if (scorecard && allow('candidate_records', 'read')) {
      const { data: eligibleMatches } = await supabase
        .from('candidate_role_matches')
        .select('id')
        .eq('job_id', input.jobId)
        .eq('organization_id', organizationId)
        .eq('eligibility', 'eligible')
      const { data: existingShortlist } = await supabase
        .from('shortlists')
        .select('id')
        .eq('job_id', input.jobId)
        .eq('organization_id', organizationId)
        .maybeSingle()

      if (
        (eligibleMatches ?? []).length > 0 &&
        !existingShortlist &&
        allow('shortlists', 'create')
      ) {
        suggestions.push({
          action: 'build_shortlist',
          description: `${(eligibleMatches ?? []).length} eligible candidate(s) are ready but no shortlist has been started for this job.`,
          permitted: true,
        })
      }
    }
  }

  if (input.shortlistId) {
    const { data: shortlist } = await supabase
      .from('shortlists')
      .select('status')
      .eq('id', input.shortlistId)
      .eq('organization_id', organizationId)
      .maybeSingle()

    if (shortlist?.status === 'draft' && allow('shortlists', 'update')) {
      suggestions.push({
        action: 'submit_shortlist_for_internal_approval',
        description:
          'This shortlist is still a draft. Submit it for internal approval before it can go to the client.',
        permitted: true,
      })
    }
    if (shortlist?.status === 'internally_approved' && allow('shortlists', 'update')) {
      suggestions.push({
        action: 'send_shortlist_to_client',
        description: 'This shortlist has internal approval. Send it to the client for review.',
        permitted: true,
      })
    }
    if (shortlist?.status === 'sent_to_client' && allow('shortlists', 'approve')) {
      suggestions.push({
        action: 'record_client_decision',
        description:
          'The client has this shortlist under review. Record their decision once you hear back.',
        permitted: true,
      })
    }
  }

  if (input.outreachMessageId) {
    const { data: message } = await supabase
      .from('outreach_messages')
      .select('status')
      .eq('id', input.outreachMessageId)
      .eq('organization_id', organizationId)
      .maybeSingle()

    if (message && allow('outreach', 'update')) {
      const nextStatuses: OutreachMessageStatus[] = [
        ...nextLegalOutreachMessageStatuses(message.status as OutreachMessageStatus),
      ]
      if (nextStatuses.includes('awaiting_approval')) {
        suggestions.push({
          action: 'submit_outreach_for_approval',
          description: 'This outreach draft is ready to be sent for approval.',
          permitted: true,
        })
      }
    }
    // NOTE: hasPermission's 'approve' action is only ever true for a
    // resource whose matrix level is literally 'approve' (e.g. shortlists
    // for client_decision_maker) — outreach approval in this codebase is
    // an internal recruiter/admin 'update'-level action
    // (apps/web/lib/outreach/outreach-actions.ts), not a distinct
    // 'approve' permission level, so 'update' is the correct check here.
    if (message && message.status === 'awaiting_approval' && allow('outreach', 'update')) {
      suggestions.push({
        action: 'review_outreach_approval',
        description:
          'An outreach message is awaiting approval — a human decision is required before it can be sent.',
        permitted: true,
      })
    }
  }

  return {
    output: { recruitmentProjectId: input.recruitmentProjectId, suggestions },
    citations: [],
    ownership: [ownership],
  }
}
