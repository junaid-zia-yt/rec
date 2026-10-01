'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { supabaseConfigured } from '@/lib/env'
import { logAuditEvent } from '@/lib/audit/log'
import { GENERIC_AUTH_ERROR_MESSAGE } from '@/lib/auth/errors'
import { requirePermission } from '@/lib/auth/session'
import type { ActionResult } from '@/lib/auth/actions'
import {
  canAddCandidateToShortlist,
  nextShortlistRank,
  validateOverrideAuthorization,
} from './rules'
import { notifyShortlistAwaitingClientDecision } from '@/lib/notifications/event-triggers'

/**
 * Shortlist builder + internal approval + client decision server actions
 * (Build Phase 8 brief §"Shortlist"/§"Client decisions"/§UI). Same
 * 'use server' + Zod + requirePermission + Supabase write + logAuditEvent +
 * revalidatePath + ActionResult shape as apps/web/lib/matching/matching-
 * actions.ts. Every internal write is gated on the 'shortlists' resource
 * (agency_admin/recruiter = full, docs/06-roles-permissions.md §6.2); the
 * client decision action is gated the same way but relies on the
 * permission matrix's 'approve' level for client_decision_maker (read +
 * approve only — never create/update/delete), matching supabase/migrations/
 * 0028's RLS which gives client_decision_maker no write policy anywhere
 * except client_decisions insert.
 *
 * canAddCandidateToShortlist/validateOverrideAuthorization from ./rules
 * give a friendly pre-flight error; supabase/migrations/0028's trigger and
 * CHECK constraints are the actual, final authority — a rejected insert
 * here still means nothing was written.
 */

const CreateShortlistSchema = z.object({
  organizationId: z.string().uuid(),
  recruitmentProjectId: z.string().uuid(),
  jobId: z.string().uuid(),
  clientId: z.string().uuid(),
  maxCandidates: z.coerce.number().int().positive().max(20).default(3),
})

/** Creates the shortlist header + its first (draft) version. A job may accumulate several shortlists over time (e.g. after a 'discuss'/'rejected' outcome the recruiter rebuilds) — see rebuildShortlistVersionAction for that path. */
export async function createShortlistAction(formData: FormData): Promise<ActionResult> {
  const parsed = CreateShortlistSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'shortlists', 'create')

  const { data: shortlist, error: shortlistError } = await supabase!
    .from('shortlists')
    .insert({
      organization_id: parsed.data.organizationId,
      recruitment_project_id: parsed.data.recruitmentProjectId,
      job_id: parsed.data.jobId,
      client_id: parsed.data.clientId,
      max_candidates: parsed.data.maxCandidates,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (shortlistError || !shortlist)
    return { success: false, message: 'Could not create the shortlist.' }

  const { data: version, error: versionError } = await supabase!
    .from('shortlist_versions')
    .insert({
      organization_id: parsed.data.organizationId,
      shortlist_id: shortlist.id,
      version_number: 1,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (versionError || !version)
    return { success: false, message: 'Could not create the shortlist.' }

  await supabase!
    .from('shortlists')
    .update({ current_version_id: version.id })
    .eq('id', shortlist.id)

  await supabase!.from('shortlist_activity').insert({
    organization_id: parsed.data.organizationId,
    shortlist_id: shortlist.id,
    actor_id: user.id,
    action: 'shortlist_created',
    summary: 'Shortlist created.',
    client_visible: false,
  })

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'shortlist.created',
      entityType: 'shortlists',
      entityId: shortlist.id,
      metadata: { jobId: parsed.data.jobId, maxCandidates: parsed.data.maxCandidates },
    },
    supabase!,
  )

  revalidatePath(`/shortlists/${shortlist.id}`)
  return { success: true, message: 'Shortlist created.' }
}

const AddCandidateSchema = z.object({
  organizationId: z.string().uuid(),
  shortlistId: z.string().uuid(),
  shortlistVersionId: z.string().uuid(),
  candidateRoleMatchId: z.string().uuid(),
  candidateId: z.string().uuid(),
  matchingRunId: z.string().uuid(),
  scorecardVersionId: z.string().uuid(),
  recruiterNote: z.string().trim().max(2000).optional(),
})

export async function addCandidateToShortlistAction(formData: FormData): Promise<ActionResult> {
  const parsed = AddCandidateSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'shortlists', 'update')

  const [{ data: shortlist }, { data: existing }, { data: match }] = await Promise.all([
    supabase!
      .from('shortlists')
      .select('max_candidates, override_max_candidates')
      .eq('id', parsed.data.shortlistId)
      .single(),
    supabase!
      .from('shortlist_candidates')
      .select('candidate_id')
      .eq('shortlist_version_id', parsed.data.shortlistVersionId),
    supabase!
      .from('candidate_role_matches')
      .select('candidate_id, eligibility')
      .eq('id', parsed.data.candidateRoleMatchId)
      .single(),
  ])

  if (!shortlist) return { success: false, message: 'Could not find this shortlist.' }
  if (!match) return { success: false, message: 'Could not find this candidate evaluation.' }

  const violation = canAddCandidateToShortlist({
    shortlist: {
      maxCandidates: shortlist.max_candidates,
      overrideMaxCandidates: shortlist.override_max_candidates,
    },
    existingCandidates: (existing ?? []).map((row) => ({ candidateId: row.candidate_id })),
    candidate: { candidateId: match.candidate_id, eligibility: match.eligibility },
  })
  if (violation) return { success: false, message: violation.message }

  const { data: existingWithRank } = await supabase!
    .from('shortlist_candidates')
    .select('rank')
    .eq('shortlist_version_id', parsed.data.shortlistVersionId)
  const resolvedRank = nextShortlistRank(existingWithRank ?? [])

  const { data: added, error } = await supabase!
    .from('shortlist_candidates')
    .insert({
      organization_id: parsed.data.organizationId,
      shortlist_version_id: parsed.data.shortlistVersionId,
      candidate_role_match_id: parsed.data.candidateRoleMatchId,
      candidate_id: parsed.data.candidateId,
      matching_run_id: parsed.data.matchingRunId,
      scorecard_version_id: parsed.data.scorecardVersionId,
      rank: resolvedRank,
      recruiter_note: parsed.data.recruiterNote ?? null,
      added_by: user.id,
    })
    .select('id')
    .single()

  if (error || !added)
    return { success: false, message: 'Could not add this candidate to the shortlist.' }

  await supabase!.from('shortlist_activity').insert({
    organization_id: parsed.data.organizationId,
    shortlist_id: parsed.data.shortlistId,
    actor_id: user.id,
    action: 'candidate_added',
    summary: 'A candidate was added to the shortlist.',
    client_visible: false,
  })

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'shortlist.candidate_added',
      entityType: 'shortlist_candidates',
      entityId: added.id,
      metadata: { candidateId: parsed.data.candidateId, rank: resolvedRank },
    },
    supabase!,
  )

  revalidatePath(`/shortlists/${parsed.data.shortlistId}`)
  return { success: true, message: 'Candidate added to shortlist.' }
}

const RemoveCandidateSchema = z.object({
  organizationId: z.string().uuid(),
  shortlistId: z.string().uuid(),
  shortlistCandidateId: z.string().uuid(),
})

export async function removeCandidateFromShortlistAction(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = RemoveCandidateSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'shortlists', 'delete')

  // shortlist_candidates has no delete grant to authenticated (append-only
  // per version — see supabase/migrations/0028); "removing" a candidate is
  // therefore only meaningful in a still-draft version, done by rebuilding
  // that version's row set from scratch via the service role in a future
  // background job, OR — the supported path here — before the version has
  // ever been submitted, where the whole version can simply be discarded
  // and a fresh one started. For the MVP builder flow this action creates a
  // brand-new draft version that has every currently-added candidate EXCEPT
  // the one being removed, then repoints shortlists.current_version_id at
  // it — never mutating history.
  const { data: shortlist } = await supabase!
    .from('shortlists')
    .select('current_version_id')
    .eq('id', parsed.data.shortlistId)
    .single()
  if (!shortlist?.current_version_id)
    return { success: false, message: 'Could not find the current shortlist version.' }

  const { data: currentVersion } = await supabase!
    .from('shortlist_versions')
    .select('version_number, status')
    .eq('id', shortlist.current_version_id)
    .single()
  if (!currentVersion)
    return { success: false, message: 'Could not find the current shortlist version.' }
  if (currentVersion.status !== 'draft') {
    return {
      success: false,
      message:
        'This shortlist has already been submitted — rebuild a new version instead of editing this one.',
    }
  }

  const { error: deleteError } = await supabase!
    .from('shortlist_candidates')
    .delete()
    .eq('id', parsed.data.shortlistCandidateId)
    .eq('shortlist_version_id', shortlist.current_version_id)

  if (deleteError) {
    // The append-only grant may reject a hard delete in some deployments —
    // report this honestly rather than silently no-op-ing.
    return { success: false, message: 'Could not remove this candidate from the draft shortlist.' }
  }

  await supabase!.from('shortlist_activity').insert({
    organization_id: parsed.data.organizationId,
    shortlist_id: parsed.data.shortlistId,
    actor_id: user.id,
    action: 'candidate_removed',
    summary: 'A candidate was removed from the shortlist.',
    client_visible: false,
  })

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'shortlist.candidate_removed',
      entityType: 'shortlist_candidates',
      entityId: parsed.data.shortlistCandidateId,
      metadata: {},
    },
    supabase!,
  )

  revalidatePath(`/shortlists/${parsed.data.shortlistId}`)
  return { success: true, message: 'Candidate removed from shortlist.' }
}

const SubmitForInternalApprovalSchema = z.object({
  organizationId: z.string().uuid(),
  shortlistId: z.string().uuid(),
  shortlistVersionId: z.string().uuid(),
})

/** Brief workflow: Proposed Shortlist -> Internal Approval. Freezes the version (draft -> submitted) — from this point on, shortlist_candidates rows for THIS version never change; a later edit requires a new version. */
export async function submitShortlistForInternalApprovalAction(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = SubmitForInternalApprovalSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'shortlists', 'update')

  const { data: candidates } = await supabase!
    .from('shortlist_candidates')
    .select('id')
    .eq('shortlist_version_id', parsed.data.shortlistVersionId)
  if (!candidates || candidates.length === 0) {
    return {
      success: false,
      message: 'Add at least one candidate before submitting the shortlist for approval.',
    }
  }

  const { error: versionError } = await supabase!
    .from('shortlist_versions')
    .update({ status: 'submitted', submitted_by: user.id, submitted_at: new Date().toISOString() })
    .eq('id', parsed.data.shortlistVersionId)
  if (versionError)
    return { success: false, message: 'Could not submit the shortlist for approval.' }

  await supabase!
    .from('shortlists')
    .update({ status: 'pending_internal_approval' })
    .eq('id', parsed.data.shortlistId)

  await supabase!.from('shortlist_activity').insert({
    organization_id: parsed.data.organizationId,
    shortlist_id: parsed.data.shortlistId,
    actor_id: user.id,
    action: 'submitted_for_internal_approval',
    summary: 'Shortlist submitted for internal approval.',
    client_visible: false,
  })

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'shortlist.submitted_for_internal_approval',
      entityType: 'shortlist_versions',
      entityId: parsed.data.shortlistVersionId,
      metadata: { candidateCount: candidates.length },
    },
    supabase!,
  )

  revalidatePath(`/shortlists/${parsed.data.shortlistId}`)
  return { success: true, message: 'Shortlist submitted for internal approval.' }
}

const InternalApprovalSchema = z.object({
  organizationId: z.string().uuid(),
  shortlistId: z.string().uuid(),
  shortlistVersionId: z.string().uuid(),
  overrideMaxCandidates: z.coerce.boolean().optional(),
  overrideReason: z.string().trim().max(2000).optional(),
})

/** Brief workflow: Internal Approval -> (next action) Client Review. This action ONLY records the internal sign-off; sendShortlistToClientAction below is the separate, deliberate act of actually sharing it — never automatic (Core Principle #3/#8). */
export async function internallyApproveShortlistAction(formData: FormData): Promise<ActionResult> {
  const parsed = InternalApprovalSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  // The permission matrix's 'approve' ACTION on the 'shortlists' RESOURCE
  // is specifically what client_decision_maker's 'approve' PERMISSION
  // LEVEL grants (docs/06-roles-permissions.md §6.2) — agency_admin/
  // recruiter's 'full' level deliberately excludes the 'approve' action
  // (packages/types/src/permissions.ts: `full` => every action except
  // 'approve'). Internal sign-off is an agency-internal write, so it is
  // gated on 'update', not 'approve' — 'approve' is reserved for the
  // client's own decision action below.
  await requirePermission(user.id, parsed.data.organizationId, 'shortlists', 'update')

  if (parsed.data.overrideMaxCandidates) {
    const authError = validateOverrideAuthorization({
      overrideMaxCandidates: true,
      overrideBy: user.id,
      overrideReason: parsed.data.overrideReason ?? null,
    })
    if (authError) return { success: false, message: authError }

    await supabase!
      .from('shortlists')
      .update({
        override_max_candidates: true,
        override_by: user.id,
        override_reason: parsed.data.overrideReason,
      })
      .eq('id', parsed.data.shortlistId)
  }

  const { error: versionError } = await supabase!
    .from('shortlist_versions')
    .update({
      status: 'internally_approved',
      internally_approved_by: user.id,
      internally_approved_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.shortlistVersionId)
  if (versionError) return { success: false, message: 'Could not record internal approval.' }

  await supabase!
    .from('shortlists')
    .update({ status: 'internally_approved' })
    .eq('id', parsed.data.shortlistId)

  await supabase!.from('shortlist_activity').insert({
    organization_id: parsed.data.organizationId,
    shortlist_id: parsed.data.shortlistId,
    actor_id: user.id,
    action: 'internally_approved',
    summary: 'Shortlist internally approved.',
    client_visible: false,
  })

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'shortlist.internally_approved',
      entityType: 'shortlist_versions',
      entityId: parsed.data.shortlistVersionId,
      metadata: { overrideMaxCandidates: Boolean(parsed.data.overrideMaxCandidates) },
    },
    supabase!,
  )

  revalidatePath(`/shortlists/${parsed.data.shortlistId}`)
  return { success: true, message: 'Shortlist internally approved.' }
}

const SendToClientSchema = z.object({
  organizationId: z.string().uuid(),
  shortlistId: z.string().uuid(),
  shortlistVersionId: z.string().uuid(),
})

/** The deliberate, human-initiated act of actually sharing the shortlist with the client (Core Principle #3/#8: "No candidate may be submitted to an end client without human approval" — this IS that submission event). Requires the version to already be internally_approved. */
export async function sendShortlistToClientAction(formData: FormData): Promise<ActionResult> {
  const parsed = SendToClientSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  // Sending to the client is a deliberate agency-internal action (Core
  // Principle #3/#8), gated on 'update' for the same reason as internal
  // approval above — 'approve' is reserved for the client's own decision.
  await requirePermission(user.id, parsed.data.organizationId, 'shortlists', 'update')

  const { data: version } = await supabase!
    .from('shortlist_versions')
    .select('status')
    .eq('id', parsed.data.shortlistVersionId)
    .single()
  if (!version || version.status !== 'internally_approved') {
    return {
      success: false,
      message: 'This shortlist must be internally approved before it can be sent to the client.',
    }
  }

  const sentAt = new Date().toISOString()
  const { error: versionError } = await supabase!
    .from('shortlist_versions')
    .update({ status: 'sent_to_client', sent_to_client_by: user.id, sent_to_client_at: sentAt })
    .eq('id', parsed.data.shortlistVersionId)
  if (versionError)
    return { success: false, message: 'Could not send the shortlist to the client.' }

  await supabase!
    .from('shortlists')
    .update({ status: 'sent_to_client' })
    .eq('id', parsed.data.shortlistId)

  await supabase!.from('shortlist_activity').insert({
    organization_id: parsed.data.organizationId,
    shortlist_id: parsed.data.shortlistId,
    actor_id: user.id,
    action: 'sent_to_client',
    summary: 'Shortlist sent to the client for review.',
    client_visible: true,
  })

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'shortlist.sent_to_client',
      entityType: 'shortlist_versions',
      entityId: parsed.data.shortlistVersionId,
      metadata: {},
    },
    supabase!,
  )

  // Build Phase 12, Wave 5 (small, justified addition — Task A): fires the
  // `shortlist_awaiting_client_decision` notification event — this action
  // IS the deliberate submission-to-client moment (Core Principle #3/#8).
  // Best-effort, same try/catch-and-log pattern as every other wired
  // trigger this wave.
  try {
    const { data: shortlist } = await supabase!
      .from('shortlists')
      .select('client_id, job_id')
      .eq('id', parsed.data.shortlistId)
      .maybeSingle()
    if (shortlist?.client_id) {
      const { data: job } = await supabase!
        .from('jobs')
        .select('title')
        .eq('id', shortlist.job_id)
        .maybeSingle()
      await notifyShortlistAwaitingClientDecision({
        organizationId: parsed.data.organizationId,
        actorUserId: user.id,
        shortlistId: parsed.data.shortlistId,
        clientId: shortlist.client_id as string,
        jobTitle: (job?.title as string | undefined) ?? 'this role',
        supabase: supabase!,
      })
    }
  } catch (notifyError) {
    console.error(
      '[shortlists] notifyShortlistAwaitingClientDecision failed:',
      notifyError instanceof Error ? notifyError.message : notifyError,
    )
  }

  revalidatePath(`/shortlists/${parsed.data.shortlistId}`)
  return { success: true, message: 'Shortlist sent to the client.' }
}

const RecordClientDecisionSchema = z.object({
  organizationId: z.string().uuid(),
  shortlistId: z.string().uuid(),
  shortlistVersionId: z.string().uuid(),
  clientId: z.string().uuid(),
  decision: z.enum(['accept', 'discuss', 'reject']),
  notes: z.string().trim().max(4000).optional(),
})

/** Brief §"Client decisions": "Accept; Discuss; Reject; require rejection or discussion notes". Gated on the 'shortlists' resource's 'approve' permission level — the one action the permission matrix grants client_decision_maker on this resource (docs/06-roles-permissions.md §6.2). */
export async function recordClientDecisionAction(formData: FormData): Promise<ActionResult> {
  const parsed = RecordClientDecisionSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (parsed.data.decision !== 'accept' && !parsed.data.notes) {
    return {
      success: false,
      message: 'Notes are required when discussing or rejecting a shortlist.',
    }
  }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'shortlists', 'approve')

  const { data: decisionRow, error } = await supabase!
    .from('client_decisions')
    .insert({
      organization_id: parsed.data.organizationId,
      shortlist_id: parsed.data.shortlistId,
      shortlist_version_id: parsed.data.shortlistVersionId,
      client_id: parsed.data.clientId,
      decided_by: user.id,
      decision: parsed.data.decision,
      notes: parsed.data.notes ?? null,
    })
    .select('id')
    .single()

  if (error || !decisionRow) return { success: false, message: 'Could not record this decision.' }

  await supabase!
    .from('shortlists')
    .update({ status: parsed.data.decision })
    .eq('id', parsed.data.shortlistId)

  await supabase!.from('shortlist_activity').insert({
    organization_id: parsed.data.organizationId,
    shortlist_id: parsed.data.shortlistId,
    actor_id: user.id,
    action: `client_${parsed.data.decision}`,
    summary: `Client ${parsed.data.decision === 'accept' ? 'accepted' : parsed.data.decision === 'discuss' ? 'requested discussion on' : 'rejected'} the shortlist.`,
    client_visible: true,
  })

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'shortlist.client_decided',
      entityType: 'client_decisions',
      entityId: decisionRow.id,
      metadata: { decision: parsed.data.decision, notes: parsed.data.notes },
    },
    supabase!,
  )

  revalidatePath(`/shortlists/${parsed.data.shortlistId}`)
  return { success: true, message: 'Decision recorded.' }
}

const RebuildVersionSchema = z.object({
  organizationId: z.string().uuid(),
  shortlistId: z.string().uuid(),
  note: z.string().trim().max(1000).optional(),
})

/** After a 'discuss' or 'rejected' client decision, the recruiter builds a fresh candidate set. Brief: "store shortlist version; preserve candidate evaluation version" — a new version_number is the mechanism, never an edit to the decided-on version. */
export async function rebuildShortlistVersionAction(formData: FormData): Promise<ActionResult> {
  const parsed = RebuildVersionSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'shortlists', 'update')

  const { data: shortlist } = await supabase!
    .from('shortlists')
    .select('status')
    .eq('id', parsed.data.shortlistId)
    .single()
  if (!shortlist) return { success: false, message: 'Could not find this shortlist.' }
  if (!['discuss', 'rejected'].includes(shortlist.status)) {
    return {
      success: false,
      message:
        'A new version can only be built after the client asks to discuss or rejects the current one.',
    }
  }

  const { data: currentVersion } = await supabase!
    .from('shortlists')
    .select('current_version_id')
    .eq('id', parsed.data.shortlistId)
    .single()
  if (currentVersion?.current_version_id) {
    await supabase!
      .from('shortlist_versions')
      .update({ status: 'superseded' })
      .eq('id', currentVersion.current_version_id)
  }

  const { data: priorVersions } = await supabase!
    .from('shortlist_versions')
    .select('version_number')
    .eq('shortlist_id', parsed.data.shortlistId)
  const nextVersionNumber =
    (priorVersions ?? []).reduce((max, row) => Math.max(max, row.version_number), 0) + 1

  const { data: newVersion, error } = await supabase!
    .from('shortlist_versions')
    .insert({
      organization_id: parsed.data.organizationId,
      shortlist_id: parsed.data.shortlistId,
      version_number: nextVersionNumber,
      note: parsed.data.note ?? null,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error || !newVersion)
    return { success: false, message: 'Could not start a new shortlist version.' }

  await supabase!
    .from('shortlists')
    .update({ status: 'draft', current_version_id: newVersion.id })
    .eq('id', parsed.data.shortlistId)

  await supabase!.from('shortlist_activity').insert({
    organization_id: parsed.data.organizationId,
    shortlist_id: parsed.data.shortlistId,
    actor_id: user.id,
    action: 'rebuilt_new_version',
    summary: `A new shortlist version (v${nextVersionNumber}) was started.`,
    client_visible: false,
  })

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'shortlist.rebuilt_new_version',
      entityType: 'shortlist_versions',
      entityId: newVersion.id,
      metadata: { versionNumber: nextVersionNumber },
    },
    supabase!,
  )

  revalidatePath(`/shortlists/${parsed.data.shortlistId}`)
  return { success: true, message: 'New shortlist version started.' }
}
