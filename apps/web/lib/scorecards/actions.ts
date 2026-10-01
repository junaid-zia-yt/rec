'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { supabaseConfigured } from '@/lib/env'
import { logAuditEvent } from '@/lib/audit/log'
import { logProjectActivity } from '@/lib/audit/activity'
import { GENERIC_AUTH_ERROR_MESSAGE, InsufficientRoleError } from '@/lib/auth/errors'
import { requireOrgMembership, requirePermission } from '@/lib/auth/session'
import { requireProjectAccess } from '@/lib/auth/project-access'
import {
  buildRequirementSnapshot,
  canApproveScorecardVersion,
  nextVersionNumber,
  requiresNewDraftVersion,
} from '@/lib/scoring/scorecard-versions'
import { canDecideScorecardApproval } from './approval-permission'
import type { WeightCheckRequirement } from '@/lib/scoring/validate-weights'
import type { ActionResult } from '@/lib/auth/actions'
import type { Membership } from '@/lib/auth/membership'
import { notifyScorecardAwaitingApproval } from '@/lib/notifications/event-triggers'

/**
 * Scorecard-version and approval server actions (Build Phase 4 brief
 * §"Scoring validation" / §PERMISSIONS). CORE RULE from the approval brief:
 * "AI may propose requirements, but sourcing cannot begin until an
 * authorized human approves a scorecard version" — nothing in this module,
 * or anywhere else in the codebase, moves a scorecard_versions row to
 * `active` except decideScorecardApprovalAction, and it never does so
 * without first passing canApproveScorecardVersion (lib/scoring/
 * scorecard-versions.ts) — a pure, deterministic check, never an AI call.
 */

async function loadJobRequirements(
  supabase: NonNullable<Awaited<ReturnType<typeof createServerSupabaseClient>>>,
  jobId: string,
): Promise<WeightCheckRequirement[]> {
  const { data } = await supabase
    .from('job_requirements')
    .select('id, type, weight')
    .eq('job_id', jobId)
  return (data ?? []).map((row) => ({ id: row.id, type: row.type, weight: row.weight }))
}

const SubmitForApprovalSchema = z.object({
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  projectClientId: z.string().uuid(),
  jobId: z.string().uuid(),
})

/**
 * Submits the job's current requirement set for approval: finds or creates
 * the job's scorecard row, opens a new draft version whenever the existing
 * one has already been active/superseded (Build Phase 4 brief: "Changes
 * after approval create a new draft version"), freezes a
 * requirement_snapshot, and moves the version to `pending_approval`. Refuses
 * — before writing anything — when the deterministic weight check fails, so
 * an approver is never shown a scorecard that could not legally be approved.
 */
export async function submitScorecardForApprovalAction(formData: FormData): Promise<ActionResult> {
  const parsed = SubmitForApprovalSchema.safeParse({
    organizationId: formData.get('organizationId'),
    projectId: formData.get('projectId'),
    projectClientId: formData.get('projectClientId'),
    jobId: formData.get('jobId'),
  })
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured) {
    return { success: false, message: 'This environment is not connected to a live database yet.' }
  }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  const membership = await requirePermission(
    user.id,
    parsed.data.organizationId,
    'scorecards',
    'create',
  )
  await requireProjectAccess(user.id, membership, {
    id: parsed.data.projectId,
    clientId: parsed.data.projectClientId,
  })

  const requirements = await loadJobRequirements(supabase!, parsed.data.jobId)
  const gate = canApproveScorecardVersion({ versionStatus: 'draft', requirements })
  // canApproveScorecardVersion also checks version-status transitions that
  // don't apply yet at submission time (a brand-new draft has no status
  // conflict) — only its weight/content reasons are relevant here, so only
  // those are surfaced if submission fails.
  const contentReasons = gate.reasons.filter(
    (reason) => !reason.includes('already active') && !reason.includes('superseded'),
  )
  if (contentReasons.length > 0) {
    return { success: false, message: contentReasons.join(' ') }
  }

  let { data: scorecard } = await supabase!
    .from('scorecards')
    .select('id, current_version_id')
    .eq('job_id', parsed.data.jobId)
    .maybeSingle()

  if (!scorecard) {
    const { data: created, error: createError } = await supabase!
      .from('scorecards')
      .insert({
        organization_id: parsed.data.organizationId,
        job_id: parsed.data.jobId,
        created_by: user.id,
      })
      .select('id, current_version_id')
      .single()
    if (createError || !created)
      return { success: false, message: 'Could not create the scorecard.' }
    scorecard = created

    await logAuditEvent(
      {
        organizationId: parsed.data.organizationId,
        actorId: user.id,
        action: 'scorecard.draft_created',
        entityType: 'scorecards',
        entityId: scorecard.id,
      },
      supabase,
    )
  }

  const { data: versions } = await supabase!
    .from('scorecard_versions')
    .select('id, version_no, status')
    .eq('scorecard_id', scorecard.id)
    .order('version_no', { ascending: false })

  const latest = versions?.[0] ?? null
  const snapshot = buildRequirementSnapshot(requirements)

  let versionId: string
  if (latest && !requiresNewDraftVersion(latest.status)) {
    // Still draft or pending_approval — update it in place rather than
    // forking a new version number for every resubmission.
    const { error } = await supabase!
      .from('scorecard_versions')
      .update({ requirement_snapshot: snapshot, status: 'pending_approval' })
      .eq('id', latest.id)
    if (error) return { success: false, message: 'Could not submit the scorecard for approval.' }
    versionId = latest.id
  } else {
    const versionNo = nextVersionNumber((versions ?? []).map((v) => v.version_no))
    const { data: created, error } = await supabase!
      .from('scorecard_versions')
      .insert({
        organization_id: parsed.data.organizationId,
        scorecard_id: scorecard.id,
        version_no: versionNo,
        status: 'pending_approval',
        requirement_snapshot: snapshot,
        created_by: user.id,
      })
      .select('id')
      .single()
    if (error || !created)
      return { success: false, message: 'Could not submit the scorecard for approval.' }
    versionId = created.id
  }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'scorecard.submitted_for_approval',
      entityType: 'scorecard_versions',
      entityId: versionId,
      after: { requirementCount: requirements.length },
    },
    supabase,
  )
  await logProjectActivity(
    {
      organizationId: parsed.data.organizationId,
      recruitmentProjectId: parsed.data.projectId,
      actorId: user.id,
      action: 'scorecard.submitted_for_approval',
      summary: `Submitted the scorecard for approval (${requirements.length} requirement(s)).`,
    },
    supabase,
  )

  // Build Phase 12, Wave 5 (small, justified addition — Task A): fires the
  // `scorecard_awaiting_approval` notification event once the version has
  // actually moved to `pending_approval` above. Best-effort, mirroring
  // Wave 4's own `notifyPocCompleted` call in poc-actions.ts exactly — a
  // notification failure must never turn an otherwise-successful
  // submission into a user-facing error.
  try {
    const { data: job } = await supabase!
      .from('jobs')
      .select('title')
      .eq('id', parsed.data.jobId)
      .maybeSingle()
    const { data: project } = await supabase!
      .from('recruitment_projects')
      .select('client_can_approve_scorecards')
      .eq('id', parsed.data.projectId)
      .maybeSingle()

    await notifyScorecardAwaitingApproval({
      organizationId: parsed.data.organizationId,
      actorUserId: user.id,
      scorecardVersionId: versionId,
      recruitmentProjectId: parsed.data.projectId,
      projectClientId: parsed.data.projectClientId,
      projectClientCanApproveScorecards: Boolean(project?.client_can_approve_scorecards),
      jobTitle: (job?.title as string | undefined) ?? 'this role',
      supabase: supabase!,
    })
  } catch (notifyError) {
    console.error(
      '[scorecards] notifyScorecardAwaitingApproval failed:',
      notifyError instanceof Error ? notifyError.message : notifyError,
    )
  }

  revalidatePath(`/projects/${parsed.data.projectId}/scorecard`)
  return { success: true, message: 'Scorecard submitted for approval.' }
}

/**
 * Agency Admin always may approve (docs/06-roles-permissions.md §6.2 "F
 * (approve)"). A Client Decision-Maker may approve ONLY when the project's
 * `client_can_approve_scorecards` flag is set AND the project belongs to
 * their own client (Build Phase 4 brief §PERMISSIONS) — this mirrors, at
 * the application layer, the exact same condition 0016_scorecards.sql's
 * `scorecard_approvals_insert_client_decision_maker` RLS policy enforces in
 * the database, so a caller gets the same honest permission error from
 * either layer rather than an opaque RLS rejection. The actual decision
 * logic is the pure, independently-unit-tested canDecideScorecardApproval
 * (lib/scorecards/approval-permission.ts) — this wrapper only turns "no"
 * into the standard thrown error.
 */
async function assertCanDecideApproval(
  userId: string,
  membership: Membership,
  project: { id: string; clientId: string; clientCanApproveScorecards: boolean },
): Promise<void> {
  const allowed = canDecideScorecardApproval({
    role: membership.role,
    callerClientId: membership.clientId ?? null,
    projectClientId: project.clientId,
    projectClientCanApproveScorecards: project.clientCanApproveScorecards,
  })
  if (!allowed) throw new InsufficientRoleError()
}

const DecideApprovalSchema = z.object({
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  projectClientId: z.string().uuid(),
  projectClientCanApproveScorecards: z.coerce.boolean(),
  scorecardVersionId: z.string().uuid(),
  decision: z.enum(['approved', 'rejected', 'changes_requested']),
  reason: z.string().trim().max(2000).optional(),
})

/**
 * Records an approve/reject/request-changes decision. An `approved`
 * decision is the ONLY path that ever sets a scorecard_versions row to
 * `active` — and it re-runs canApproveScorecardVersion against the
 * version's own frozen snapshot immediately before doing so, refusing the
 * approval (writing nothing) if the deterministic gate fails, even though
 * submitScorecardForApprovalAction already checked it once — content could
 * not have changed since the snapshot was frozen, but the gate is
 * re-checked here anyway rather than trusted from an earlier request, per
 * the project's rule that a scorecard must never be approved with invalid
 * totals under any code path.
 */
export async function decideScorecardApprovalAction(formData: FormData): Promise<ActionResult> {
  const parsed = DecideApprovalSchema.safeParse({
    organizationId: formData.get('organizationId'),
    projectId: formData.get('projectId'),
    projectClientId: formData.get('projectClientId'),
    projectClientCanApproveScorecards: formData.get('projectClientCanApproveScorecards') ?? 'false',
    scorecardVersionId: formData.get('scorecardVersionId'),
    decision: formData.get('decision'),
    reason: formData.get('reason') ?? undefined,
  })
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured) {
    return { success: false, message: 'This environment is not connected to a live database yet.' }
  }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  const membership = await requireOrgMembership(user.id, parsed.data.organizationId)
  await requireProjectAccess(user.id, membership, {
    id: parsed.data.projectId,
    clientId: parsed.data.projectClientId,
  })
  await assertCanDecideApproval(user.id, membership, {
    id: parsed.data.projectId,
    clientId: parsed.data.projectClientId,
    clientCanApproveScorecards: parsed.data.projectClientCanApproveScorecards,
  })

  const { data: version } = await supabase!
    .from('scorecard_versions')
    .select('id, scorecard_id, status, requirement_snapshot')
    .eq('id', parsed.data.scorecardVersionId)
    .single()

  if (!version) return { success: false, message: 'This scorecard version could not be found.' }

  if (parsed.data.decision === 'approved') {
    const snapshotRequirements: WeightCheckRequirement[] = (
      version.requirement_snapshot as Array<{
        requirementId: string
        type: string
        weight: number | null
      }>
    ).map((entry) => ({
      id: entry.requirementId,
      type: entry.type as WeightCheckRequirement['type'],
      weight: entry.weight,
    }))

    const gate = canApproveScorecardVersion({
      versionStatus: version.status,
      requirements: snapshotRequirements,
    })
    if (!gate.canApprove) {
      return { success: false, message: gate.reasons.join(' ') }
    }

    const { error: approvalError } = await supabase!.from('scorecard_approvals').insert({
      organization_id: parsed.data.organizationId,
      scorecard_version_id: version.id,
      approver_id: user.id,
      approver_name: user.email ?? user.id,
      decision: 'approved',
      reason: parsed.data.reason ?? null,
    })
    if (approvalError) return { success: false, message: 'Could not record the approval.' }

    await supabase!
      .from('scorecard_versions')
      .update({ status: 'superseded' })
      .eq('scorecard_id', version.scorecard_id)
      .eq('status', 'active')

    await supabase!
      .from('scorecard_versions')
      .update({ status: 'active', approved_by: user.id, approved_at: new Date().toISOString() })
      .eq('id', version.id)

    await supabase!
      .from('scorecards')
      .update({ status: 'approved', current_version_id: version.id })
      .eq('id', version.scorecard_id)

    await logAuditEvent(
      {
        organizationId: parsed.data.organizationId,
        actorId: user.id,
        action: 'scorecard.approved',
        entityType: 'scorecard_versions',
        entityId: version.id,
      },
      supabase,
    )
    await logProjectActivity(
      {
        organizationId: parsed.data.organizationId,
        recruitmentProjectId: parsed.data.projectId,
        actorId: user.id,
        action: 'scorecard.approved',
        summary: 'Scorecard approved — sourcing may now begin.',
      },
      supabase,
    )

    revalidatePath(`/projects/${parsed.data.projectId}/scorecard`)
    return { success: true, message: 'Scorecard approved.' }
  }

  // rejected / changes_requested: record the decision, return the version
  // to draft so a recruiter can edit and resubmit. Never active, never
  // silently discarded.
  const { error: approvalError } = await supabase!.from('scorecard_approvals').insert({
    organization_id: parsed.data.organizationId,
    scorecard_version_id: version.id,
    approver_id: user.id,
    approver_name: user.email ?? user.id,
    decision: parsed.data.decision,
    reason: parsed.data.reason ?? null,
  })
  if (approvalError) return { success: false, message: 'Could not record the decision.' }

  await supabase!.from('scorecard_versions').update({ status: 'draft' }).eq('id', version.id)

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action:
        parsed.data.decision === 'rejected' ? 'scorecard.rejected' : 'scorecard.changes_requested',
      entityType: 'scorecard_versions',
      entityId: version.id,
      metadata: { reason: parsed.data.reason ?? null },
    },
    supabase,
  )
  await logProjectActivity(
    {
      organizationId: parsed.data.organizationId,
      recruitmentProjectId: parsed.data.projectId,
      actorId: user.id,
      action:
        parsed.data.decision === 'rejected' ? 'scorecard.rejected' : 'scorecard.changes_requested',
      summary:
        parsed.data.decision === 'rejected'
          ? 'Scorecard rejected.'
          : 'Changes requested on the scorecard.',
    },
    supabase,
  )

  revalidatePath(`/projects/${parsed.data.projectId}/scorecard`)
  return {
    success: true,
    message:
      parsed.data.decision === 'rejected'
        ? 'Scorecard rejected.'
        : 'Changes requested — returned to draft.',
  }
}

const SetClientApprovalPermissionSchema = z.object({
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  enabled: z.coerce.boolean(),
})

/**
 * Toggles the per-project client-approval opt-in (Build Phase 4 brief
 * §PERMISSIONS: "Client reviewers may approve only if explicitly
 * permitted"). Agency Admin only — never settable by a client, and never by
 * a recruiter (draft/edit rights don't extend to changing who else may
 * approve).
 */
export async function setClientApprovalPermissionAction(formData: FormData): Promise<ActionResult> {
  const parsed = SetClientApprovalPermissionSchema.safeParse({
    organizationId: formData.get('organizationId'),
    projectId: formData.get('projectId'),
    enabled: formData.get('enabled') ?? 'false',
  })
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured) {
    return { success: false, message: 'This environment is not connected to a live database yet.' }
  }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  const membership = await requireOrgMembership(user.id, parsed.data.organizationId)
  if (membership.role !== 'agency_admin' && membership.role !== 'platform_admin') {
    throw new InsufficientRoleError()
  }

  const { error } = await supabase!
    .from('recruitment_projects')
    .update({ client_can_approve_scorecards: parsed.data.enabled })
    .eq('id', parsed.data.projectId)
    .eq('organization_id', parsed.data.organizationId)

  if (error) return { success: false, message: 'Could not update this setting.' }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'scorecard.client_approval_permission_changed',
      entityType: 'recruitment_projects',
      entityId: parsed.data.projectId,
      after: { clientCanApproveScorecards: parsed.data.enabled },
    },
    supabase,
  )

  revalidatePath(`/projects/${parsed.data.projectId}/scorecard`)
  return {
    success: true,
    message: parsed.data.enabled
      ? 'Client reviewers may now approve this scorecard.'
      : 'Client approval permission removed.',
  }
}
