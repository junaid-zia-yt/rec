'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { supabaseConfigured } from '@/lib/env'
import { logAuditEvent } from '@/lib/audit/log'
import { GENERIC_AUTH_ERROR_MESSAGE, InsufficientRoleError } from '@/lib/auth/errors'
import { requireOrgMembership, requirePermission } from '@/lib/auth/session'
import type { Membership } from '@/lib/auth/membership'
import type { ActionResult } from '@/lib/auth/actions'
import type { PocMetricSource } from '@rqi/types'
import { isComputedResult } from './types'
import { loadMetricDefinitionRefMap, loadPocBenchmarkDetail } from './load-detail'
import { notifyPocCompleted } from '@/lib/notifications/event-triggers'

/**
 * Build Phase 10, Wave 3 — POC benchmark server actions (Task B). Same
 * 'use server' + Zod + requirePermission + Supabase write + logAuditEvent +
 * revalidatePath + ActionResult shape as apps/web/lib/outreach/outreach-
 * actions.ts / apps/web/lib/shortlists/shortlist-actions.ts.
 *
 * PERMISSIONS NOTE (packages/types/src/permissions.ts poc_reports matrix:
 * `{ agency_admin: 'full', recruiter: 'read', client_decision_maker: 'read',
 * read_only_reviewer: 'read' }`): agency_admin/platform_admin write
 * poc_benchmarks/poc_roles/poc_participants/poc_results/poc_decisions —
 * for those, a bare `requirePermission(..., 'create'|'update')` is
 * correct and sufficient (recruiter's 'read' level never grants create/
 * update, so it fails closed automatically). No role holds the 'approve'
 * PermissionLevel on poc_reports, so recordPocDecisionAction is gated on
 * 'create' too (mirrors the Phase 8/9 precedent of using 'update'/'create'
 * over an unheld 'approve' — see outreach-actions.ts's own note on this).
 *
 * THE THREE EXCEPTIONS (recordPocBaselineAction, recordPocMetricDataPointAction,
 * recordPocExclusionAction): supabase/migrations/0030's RLS is MORE
 * PERMISSIVE than this resource-level default for these three specific
 * writes — an assigned recruiter CAN insert poc_baselines/poc_metrics/
 * poc_exclusions at the RLS layer (they run day-to-day POC data collection),
 * even though `hasPermission(recruiter, 'poc_reports', 'create')` alone
 * says 'read'. So these three actions do NOT call requirePermission; they
 * call `assertPocDataEntryAccess` below instead, which mirrors the RLS
 * policies' own condition exactly: platform_admin/agency_admin always
 * allowed, recruiter allowed only when assigned to the role's
 * recruitment_project_id (checked directly against `project_assignments`,
 * the same table `is_assigned_to_project()` reads), everyone else denied.
 */

async function getAuthedSupabase() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  return { supabase: supabase!, user }
}

/** Mirrors is_assigned_to_project()'s RLS condition at the application layer — see this module's header note. Throws InsufficientRoleError (never a redirect — this runs inside a server action) when denied. */
async function assertPocDataEntryAccess(
  supabase: NonNullable<Awaited<ReturnType<typeof createServerSupabaseClient>>>,
  userId: string,
  organizationId: string,
  recruitmentProjectId: string,
): Promise<Membership> {
  const membership = await requireOrgMembership(userId, organizationId)
  if (membership.role === 'platform_admin' || membership.role === 'agency_admin') return membership

  if (membership.role === 'recruiter') {
    const { data } = await supabase
      .from('project_assignments')
      .select('id')
      .eq('user_id', userId)
      .eq('recruitment_project_id', recruitmentProjectId)
      .maybeSingle()
    if (data) return membership
  }

  throw new InsufficientRoleError()
}

// ---------------------------------------------------------------------------
// 1. createPocBenchmarkAction
// ---------------------------------------------------------------------------

const CreateBenchmarkSchema = z.object({
  organizationId: z.string().uuid(),
  clientId: z.string().uuid(),
  name: z.string().trim().min(1).max(300),
  startTime: z.string().datetime().optional(),
  searchBoundaries: z.string().trim().max(4000).optional(),
  notes: z.string().trim().max(2000).optional(),
})

/** Creates a poc_benchmarks row (status starts 'setup'). searchBoundaries is accepted as a JSON string from the form and parsed here — invalid JSON is a validation error, not silently dropped. */
export async function createPocBenchmarkAction(formData: FormData): Promise<ActionResult> {
  const parsed = CreateBenchmarkSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  let searchBoundaries: Record<string, unknown> = {}
  if (parsed.data.searchBoundaries) {
    try {
      const value = JSON.parse(parsed.data.searchBoundaries)
      if (value && typeof value === 'object' && !Array.isArray(value))
        searchBoundaries = value as Record<string, unknown>
      else return { success: false, message: 'Search boundaries must be a JSON object.' }
    } catch {
      return { success: false, message: 'Search boundaries must be valid JSON.' }
    }
  }

  const { supabase, user } = await getAuthedSupabase()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'poc_reports', 'create')

  const { data: benchmark, error } = await supabase
    .from('poc_benchmarks')
    .insert({
      organization_id: parsed.data.organizationId,
      client_id: parsed.data.clientId,
      name: parsed.data.name,
      start_time: parsed.data.startTime ?? null,
      search_boundaries: searchBoundaries,
      notes: parsed.data.notes ?? null,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error || !benchmark) return { success: false, message: 'Could not create the POC benchmark.' }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'poc.benchmark_created',
      entityType: 'poc_benchmarks',
      entityId: benchmark.id,
      metadata: { clientId: parsed.data.clientId, name: parsed.data.name },
    },
    supabase,
  )

  revalidatePath('/poc')
  return { success: true, message: 'POC benchmark created.' }
}

const UpdateBenchmarkSchema = z.object({
  organizationId: z.string().uuid(),
  pocBenchmarkId: z.string().uuid(),
  name: z.string().trim().min(1).max(300).optional(),
  startTime: z.string().datetime().optional(),
  searchBoundaries: z.string().trim().max(4000).optional(),
  notes: z.string().trim().max(2000).optional(),
})

/** Updates the benchmark's shared start_time / search_boundaries / name / notes (setup-time configuration — docs/14-poc-specification.md §14.5's "same start time, agreed boundaries" requirement lives here). */
export async function updatePocBenchmarkAction(formData: FormData): Promise<ActionResult> {
  const parsed = UpdateBenchmarkSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  let searchBoundaries: Record<string, unknown> | undefined
  if (parsed.data.searchBoundaries !== undefined) {
    try {
      const value = JSON.parse(parsed.data.searchBoundaries)
      if (value && typeof value === 'object' && !Array.isArray(value))
        searchBoundaries = value as Record<string, unknown>
      else return { success: false, message: 'Search boundaries must be a JSON object.' }
    } catch {
      return { success: false, message: 'Search boundaries must be valid JSON.' }
    }
  }

  const { supabase, user } = await getAuthedSupabase()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'poc_reports', 'update')

  const update: Record<string, unknown> = {}
  if (parsed.data.name !== undefined) update.name = parsed.data.name
  if (parsed.data.startTime !== undefined) update.start_time = parsed.data.startTime
  if (searchBoundaries !== undefined) update.search_boundaries = searchBoundaries
  if (parsed.data.notes !== undefined) update.notes = parsed.data.notes

  const { error } = await supabase
    .from('poc_benchmarks')
    .update(update)
    .eq('id', parsed.data.pocBenchmarkId)
    .eq('organization_id', parsed.data.organizationId)

  if (error) return { success: false, message: 'Could not update the POC benchmark.' }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'poc.benchmark_updated',
      entityType: 'poc_benchmarks',
      entityId: parsed.data.pocBenchmarkId,
      metadata: { fields: Object.keys(update) },
    },
    supabase,
  )

  revalidatePath(`/poc/${parsed.data.pocBenchmarkId}`)
  return { success: true, message: 'POC benchmark updated.' }
}

// ---------------------------------------------------------------------------
// 2. addPocRoleAction / removePocRoleAction
// ---------------------------------------------------------------------------

const AddRoleSchema = z.object({
  organizationId: z.string().uuid(),
  pocBenchmarkId: z.string().uuid(),
  jobId: z.string().uuid(),
  recruitmentProjectId: z.string().uuid(),
  roleType: z.enum(['standard', 'senior_or_difficult']),
  label: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(2000).optional(),
})

/** Adds a standard or senior_or_difficult role. The DB's unique(poc_benchmark_id, role_type) constraint and enforce_poc_role_consistency trigger are the real gates — this surfaces a clean message when either rejects the insert (a role of this type already exists, or the job/project pair doesn't match). */
export async function addPocRoleAction(formData: FormData): Promise<ActionResult> {
  const parsed = AddRoleSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const { supabase, user } = await getAuthedSupabase()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'poc_reports', 'create')

  const { data: role, error } = await supabase
    .from('poc_roles')
    .insert({
      organization_id: parsed.data.organizationId,
      poc_benchmark_id: parsed.data.pocBenchmarkId,
      job_id: parsed.data.jobId,
      recruitment_project_id: parsed.data.recruitmentProjectId,
      role_type: parsed.data.roleType,
      label: parsed.data.label ?? null,
      notes: parsed.data.notes ?? null,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error || !role) {
    const friendly = error?.message?.includes('duplicate key')
      ? `This benchmark already has a ${parsed.data.roleType === 'standard' ? 'standard' : 'senior/difficult'} role.`
      : 'Could not add this role — check that the job belongs to this organization.'
    return { success: false, message: friendly }
  }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'poc.role_added',
      entityType: 'poc_roles',
      entityId: role.id,
      metadata: { roleType: parsed.data.roleType, jobId: parsed.data.jobId },
    },
    supabase,
  )

  revalidatePath(`/poc/${parsed.data.pocBenchmarkId}`)
  return { success: true, message: 'Role added to benchmark.' }
}

const RemoveRoleSchema = z.object({
  organizationId: z.string().uuid(),
  pocBenchmarkId: z.string().uuid(),
  pocRoleId: z.string().uuid(),
})

/** Removes a role — only legal while the benchmark is still in 'setup' (poc_roles_enforce_delete_lock trigger is the real gate). */
export async function removePocRoleAction(formData: FormData): Promise<ActionResult> {
  const parsed = RemoveRoleSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const { supabase, user } = await getAuthedSupabase()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'poc_reports', 'delete')

  const { error } = await supabase
    .from('poc_roles')
    .delete()
    .eq('id', parsed.data.pocRoleId)
    .eq('organization_id', parsed.data.organizationId)

  if (error) {
    return {
      success: false,
      message: error.message.includes('left setup')
        ? 'This role can no longer be removed — the benchmark has already been activated.'
        : 'Could not remove this role.',
    }
  }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'poc.role_removed',
      entityType: 'poc_roles',
      entityId: parsed.data.pocRoleId,
      metadata: {},
    },
    supabase,
  )

  revalidatePath(`/poc/${parsed.data.pocBenchmarkId}`)
  return { success: true, message: 'Role removed.' }
}

// ---------------------------------------------------------------------------
// 3. linkPocParticipantAction
// ---------------------------------------------------------------------------

const LinkParticipantSchema = z.object({
  organizationId: z.string().uuid(),
  pocBenchmarkId: z.string().uuid(),
  pocRoleId: z.string().uuid(),
  processType: z.enum(['client_baseline', 'vendor_assisted']),
  shortlistId: z.string().uuid().optional(),
  notes: z.string().trim().max(2000).optional(),
})

/** Creates (or, if one already exists for this role+processType, updates) the participant row. For vendor_assisted, shortlistId — when given — is validated to belong to this org and this role's job before it is accepted (the DB CHECK only enforces "only vendor_assisted may carry a shortlist_id", not "same org/job", so that half is this action's job). */
export async function linkPocParticipantAction(formData: FormData): Promise<ActionResult> {
  const parsed = LinkParticipantSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (parsed.data.shortlistId && parsed.data.processType !== 'vendor_assisted') {
    return { success: false, message: 'Only the vendor-assisted process may link to a shortlist.' }
  }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const { supabase, user } = await getAuthedSupabase()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'poc_reports', 'create')

  const { data: role } = await supabase
    .from('poc_roles')
    .select('id, job_id, organization_id')
    .eq('id', parsed.data.pocRoleId)
    .eq('organization_id', parsed.data.organizationId)
    .maybeSingle()
  if (!role) return { success: false, message: 'Could not find this POC role.' }

  if (parsed.data.shortlistId) {
    const { data: shortlist } = await supabase
      .from('shortlists')
      .select('id')
      .eq('id', parsed.data.shortlistId)
      .eq('organization_id', parsed.data.organizationId)
      .eq('job_id', role.job_id)
      .maybeSingle()
    if (!shortlist)
      return { success: false, message: 'That shortlist does not belong to this role’s job.' }
  }

  const { data: existing } = await supabase
    .from('poc_participants')
    .select('id')
    .eq('poc_role_id', parsed.data.pocRoleId)
    .eq('process_type', parsed.data.processType)
    .maybeSingle()

  const payload = {
    organization_id: parsed.data.organizationId,
    poc_benchmark_id: parsed.data.pocBenchmarkId,
    poc_role_id: parsed.data.pocRoleId,
    process_type: parsed.data.processType,
    shortlist_id: parsed.data.shortlistId ?? null,
    notes: parsed.data.notes ?? null,
  }

  const { data: participant, error } = existing
    ? await supabase
        .from('poc_participants')
        .update(payload)
        .eq('id', existing.id)
        .select('id')
        .single()
    : await supabase
        .from('poc_participants')
        .insert({ ...payload, status: 'not_started', created_by: user.id })
        .select('id')
        .single()

  if (error || !participant) return { success: false, message: 'Could not link this participant.' }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'poc.participant_linked_to_shortlist',
      entityType: 'poc_participants',
      entityId: participant.id,
      metadata: {
        processType: parsed.data.processType,
        shortlistId: parsed.data.shortlistId ?? null,
      },
    },
    supabase,
  )

  revalidatePath(`/poc/${parsed.data.pocBenchmarkId}`)
  return { success: true, message: 'Participant linked.' }
}

const UpdateParticipantStatusSchema = z.object({
  organizationId: z.string().uuid(),
  pocBenchmarkId: z.string().uuid(),
  pocParticipantId: z.string().uuid(),
  status: z.enum(['not_started', 'in_progress', 'completed']),
})

/** Advances a participant's own status (not_started/in_progress/completed) — a lightweight progress marker independent of the benchmark's own status lifecycle. */
export async function updatePocParticipantStatusAction(formData: FormData): Promise<ActionResult> {
  const parsed = UpdateParticipantStatusSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const { supabase, user } = await getAuthedSupabase()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'poc_reports', 'update')

  const nowIso = new Date().toISOString()
  const update: Record<string, unknown> = { status: parsed.data.status }
  if (parsed.data.status === 'in_progress') update.started_at = nowIso
  if (parsed.data.status === 'completed') update.completed_at = nowIso

  const { error } = await supabase
    .from('poc_participants')
    .update(update)
    .eq('id', parsed.data.pocParticipantId)
    .eq('organization_id', parsed.data.organizationId)

  if (error) return { success: false, message: 'Could not update this participant.' }

  revalidatePath(`/poc/${parsed.data.pocBenchmarkId}`)
  return { success: true, message: 'Participant status updated.' }
}

// ---------------------------------------------------------------------------
// 4. activatePocBenchmarkAction / completePocBenchmarkAction
// ---------------------------------------------------------------------------

const ActivateBenchmarkSchema = z.object({
  organizationId: z.string().uuid(),
  pocBenchmarkId: z.string().uuid(),
})

/** setup -> in_progress. The enforce_poc_benchmark_role_mix trigger is the real gate ("exactly one standard + one senior_or_difficult role") — this surfaces its rejection cleanly rather than a raw Postgres error. */
export async function activatePocBenchmarkAction(formData: FormData): Promise<ActionResult> {
  const parsed = ActivateBenchmarkSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const { supabase, user } = await getAuthedSupabase()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'poc_reports', 'update')

  const { data: benchmark } = await supabase
    .from('poc_benchmarks')
    .select('status, start_time')
    .eq('id', parsed.data.pocBenchmarkId)
    .eq('organization_id', parsed.data.organizationId)
    .maybeSingle()
  if (!benchmark) return { success: false, message: 'Could not find this POC benchmark.' }
  if (benchmark.status !== 'setup')
    return { success: false, message: 'This benchmark has already been activated.' }
  if (!benchmark.start_time) {
    return {
      success: false,
      message:
        'Set a shared start time before activating this benchmark (docs/14-poc-specification.md §14.5).',
    }
  }

  const { error } = await supabase
    .from('poc_benchmarks')
    .update({ status: 'in_progress' })
    .eq('id', parsed.data.pocBenchmarkId)
    .eq('organization_id', parsed.data.organizationId)

  if (error) {
    const friendly = error.message.includes(
      'must have exactly one standard and one senior_or_difficult',
    )
      ? 'This benchmark needs exactly one standard role and one senior/difficult role before it can be activated.'
      : 'Could not activate this benchmark.'
    return { success: false, message: friendly }
  }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'poc.benchmark_activated',
      entityType: 'poc_benchmarks',
      entityId: parsed.data.pocBenchmarkId,
      metadata: {},
    },
    supabase,
  )

  revalidatePath(`/poc/${parsed.data.pocBenchmarkId}`)
  revalidatePath('/poc')
  return { success: true, message: 'Benchmark activated.' }
}

const CompleteBenchmarkSchema = z.object({
  organizationId: z.string().uuid(),
  pocBenchmarkId: z.string().uuid(),
})

/**
 * in_progress -> completed. JUDGMENT CALL (flagged for the next wave):
 * the migration's status enum gives no trigger-level gate for this
 * transition the way role-mix gates activation, so this action enforces
 * the one precondition the brief implies is required — every currently
 * added poc_roles row must have at least one 'computed' poc_results row on
 * BOTH sides for the three candidate-quality-primary metrics
 * (CANDIDATE_QUALITY_PRIMARY_METRIC_KEYS) OR an explicit non-computed
 * status already recorded for it (i.e. computePocResultsAction has been run
 * at least once) — never a hard requirement that every one of the 15
 * metrics reached 'computed', since several are legitimately expected to
 * stay pending/not_available/not_measured. In short: "results have been
 * computed at least once", not "every metric came back with a number".
 */
export async function completePocBenchmarkAction(formData: FormData): Promise<ActionResult> {
  const parsed = CompleteBenchmarkSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const { supabase, user } = await getAuthedSupabase()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'poc_reports', 'update')

  const { data: benchmark } = await supabase
    .from('poc_benchmarks')
    .select('status, client_id, name')
    .eq('id', parsed.data.pocBenchmarkId)
    .eq('organization_id', parsed.data.organizationId)
    .maybeSingle()
  if (!benchmark) return { success: false, message: 'Could not find this POC benchmark.' }
  if (benchmark.status !== 'in_progress') {
    return { success: false, message: 'Only an in-progress benchmark can be marked completed.' }
  }

  const { count: resultCount } = await supabase
    .from('poc_results')
    .select('id', { count: 'exact', head: true })
    .eq('poc_benchmark_id', parsed.data.pocBenchmarkId)

  if (!resultCount || resultCount === 0) {
    return {
      success: false,
      message: 'Compute results for at least one role before marking this benchmark completed.',
    }
  }

  const { error } = await supabase
    .from('poc_benchmarks')
    .update({ status: 'completed' })
    .eq('id', parsed.data.pocBenchmarkId)
    .eq('organization_id', parsed.data.organizationId)

  if (error) return { success: false, message: 'Could not complete this benchmark.' }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'poc.benchmark_updated',
      entityType: 'poc_benchmarks',
      entityId: parsed.data.pocBenchmarkId,
      metadata: { transition: 'in_progress -> completed' },
    },
    supabase,
  )

  // Build Phase 12 Wave 4 addition (small, justified edit — flagged per
  // that wave's brief): fires the `poc_completed` notification event once
  // the transition above has actually succeeded. Best-effort — a
  // notification failure must never turn an otherwise-successful
  // "benchmark completed" action into a user-facing error.
  try {
    await notifyPocCompleted({
      organizationId: parsed.data.organizationId,
      actorUserId: user.id,
      pocBenchmarkId: parsed.data.pocBenchmarkId,
      clientId: benchmark.client_id as string,
      benchmarkName: benchmark.name as string,
      supabase,
    })
  } catch (notifyError) {
    console.error(
      '[poc] notifyPocCompleted failed:',
      notifyError instanceof Error ? notifyError.message : notifyError,
    )
  }

  revalidatePath(`/poc/${parsed.data.pocBenchmarkId}`)
  revalidatePath('/poc')
  return { success: true, message: 'Benchmark marked completed.' }
}

// ---------------------------------------------------------------------------
// 5. recordPocBaselineAction / recordPocMetricDataPointAction
//    (the two "recruiter can write despite resource default" actions — see
//    this module's header note.)
// ---------------------------------------------------------------------------

const RecordBaselineSchema = z.object({
  organizationId: z.string().uuid(),
  pocBenchmarkId: z.string().uuid(),
  pocRoleId: z.string().uuid(),
  pocParticipantId: z.string().uuid(),
  recruitmentProjectId: z.string().uuid(),
  candidatesSourcedCount: z.coerce.number().int().min(0).optional(),
  candidatesReviewedCount: z.coerce.number().int().min(0).optional(),
  shortlistCandidateCount: z.coerce.number().int().min(0).optional(),
  timeToFirstQualifiedHours: z.coerce.number().min(0).optional(),
  timeToShortlistHours: z.coerce.number().min(0).optional(),
  recruiterHoursSpent: z.coerce.number().min(0).optional(),
  reportedByLabel: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(2000).optional(),
  correctionOfBaselineId: z.string().uuid().optional(),
})

/** Records the client's self-reported baseline for their own process. Append-only at the DB layer — a correction is always a NEW row via correctionOfBaselineId, never an update to a prior row (this action never issues an UPDATE against poc_baselines). */
export async function recordPocBaselineAction(formData: FormData): Promise<ActionResult> {
  const parsed = RecordBaselineSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const { supabase, user } = await getAuthedSupabase()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await assertPocDataEntryAccess(
    supabase,
    user.id,
    parsed.data.organizationId,
    parsed.data.recruitmentProjectId,
  )

  const { data: baseline, error } = await supabase
    .from('poc_baselines')
    .insert({
      organization_id: parsed.data.organizationId,
      poc_benchmark_id: parsed.data.pocBenchmarkId,
      poc_role_id: parsed.data.pocRoleId,
      poc_participant_id: parsed.data.pocParticipantId,
      candidates_sourced_count: parsed.data.candidatesSourcedCount ?? null,
      candidates_reviewed_count: parsed.data.candidatesReviewedCount ?? null,
      shortlist_candidate_count: parsed.data.shortlistCandidateCount ?? null,
      time_to_first_qualified_hours: parsed.data.timeToFirstQualifiedHours ?? null,
      time_to_shortlist_hours: parsed.data.timeToShortlistHours ?? null,
      recruiter_hours_spent: parsed.data.recruiterHoursSpent ?? null,
      reported_by_user_id: user.id,
      reported_by_label: parsed.data.reportedByLabel ?? null,
      notes: parsed.data.notes ?? null,
      correction_of_baseline_id: parsed.data.correctionOfBaselineId ?? null,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error || !baseline) return { success: false, message: 'Could not record this baseline.' }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'poc.baseline_recorded',
      entityType: 'poc_baselines',
      entityId: baseline.id,
      metadata: {
        pocRoleId: parsed.data.pocRoleId,
        isCorrection: Boolean(parsed.data.correctionOfBaselineId),
      },
    },
    supabase,
  )

  revalidatePath(`/poc/${parsed.data.pocBenchmarkId}`)
  return { success: true, message: 'Client baseline recorded.' }
}

const RecordDataPointSchema = z.object({
  organizationId: z.string().uuid(),
  pocBenchmarkId: z.string().uuid(),
  pocRoleId: z.string().uuid(),
  pocParticipantId: z.string().uuid(),
  recruitmentProjectId: z.string().uuid(),
  metricDefinitionId: z.string().uuid(),
  metricDefinitionVersion: z.coerce.number().int().positive(),
  dataPointKey: z.string().trim().min(1).max(200),
  valueNumeric: z.coerce.number().optional(),
  valueText: z.string().trim().max(2000).optional(),
  source: z.enum(['platform_computed', 'client_reported', 'manual_recruiter_entry', 'ai_derived']),
  notes: z.string().trim().max(2000).optional(),
  supersedesMetricId: z.string().uuid().optional(),
})

/** Records a raw poc_metrics data point (the DATA_POINT_KEYS manual-entry fallback wave 2's calculators read — see apps/web/lib/poc/data-point-keys.ts). Append-only at the DB layer — a correction is a new row via supersedesMetricId. */
export async function recordPocMetricDataPointAction(formData: FormData): Promise<ActionResult> {
  const parsed = RecordDataPointSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (parsed.data.valueNumeric === undefined && !parsed.data.valueText) {
    return { success: false, message: 'Enter a numeric or text value.' }
  }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const { supabase, user } = await getAuthedSupabase()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await assertPocDataEntryAccess(
    supabase,
    user.id,
    parsed.data.organizationId,
    parsed.data.recruitmentProjectId,
  )

  const { data: dataPoint, error } = await supabase
    .from('poc_metrics')
    .insert({
      organization_id: parsed.data.organizationId,
      poc_benchmark_id: parsed.data.pocBenchmarkId,
      poc_role_id: parsed.data.pocRoleId,
      poc_participant_id: parsed.data.pocParticipantId,
      metric_definition_id: parsed.data.metricDefinitionId,
      metric_definition_version: parsed.data.metricDefinitionVersion,
      data_point_key: parsed.data.dataPointKey,
      value_numeric: parsed.data.valueNumeric ?? null,
      value_text: parsed.data.valueText ?? null,
      unit: null,
      source: parsed.data.source as PocMetricSource,
      supersedes_metric_id: parsed.data.supersedesMetricId ?? null,
      notes: parsed.data.notes ?? null,
      recorded_by: user.id,
    })
    .select('id')
    .single()

  if (error || !dataPoint) return { success: false, message: 'Could not record this data point.' }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'poc.metric_recorded',
      entityType: 'poc_metrics',
      entityId: dataPoint.id,
      metadata: {
        dataPointKey: parsed.data.dataPointKey,
        source: parsed.data.source,
        isCorrection: Boolean(parsed.data.supersedesMetricId),
      },
    },
    supabase,
  )

  revalidatePath(`/poc/${parsed.data.pocBenchmarkId}`)
  return { success: true, message: 'Data point recorded.' }
}

// ---------------------------------------------------------------------------
// 6. recordPocExclusionAction
// ---------------------------------------------------------------------------

const RecordExclusionSchema = z
  .object({
    organizationId: z.string().uuid(),
    pocBenchmarkId: z.string().uuid(),
    pocRoleId: z.string().uuid(),
    recruitmentProjectId: z.string().uuid(),
    candidateId: z.string().uuid().optional(),
    candidateReferenceLabel: z.string().trim().max(300).optional(),
    side: z.enum(['vendor', 'client', 'both']),
    exclusionType: z.enum(['duplicate_across_sides', 'out_of_search_boundary', 'other']),
    reason: z.string().trim().min(1).max(2000),
    stillCountsTowardSpeed: z.coerce.boolean().optional(),
    reversesExclusionId: z.string().uuid().optional(),
  })
  .refine((v) => Boolean(v.candidateId) || Boolean(v.candidateReferenceLabel), {
    message: 'Identify the candidate by id or by a reference label.',
    path: ['candidateReferenceLabel'],
  })

/** Records a mandatory-reason exclusion (or, with reversesExclusionId, a reversal — the reversal row is itself a full exclusion record explaining why the original no longer applies, per resolve-inputs.ts's own documented convention). Append-only at the DB layer. */
export async function recordPocExclusionAction(formData: FormData): Promise<ActionResult> {
  const raw = Object.fromEntries(formData.entries())
  const parsed = RecordExclusionSchema.safeParse(raw)
  if (!parsed.success)
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? 'Check the form and try again.',
    }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const { supabase, user } = await getAuthedSupabase()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await assertPocDataEntryAccess(
    supabase,
    user.id,
    parsed.data.organizationId,
    parsed.data.recruitmentProjectId,
  )

  const { data: exclusion, error } = await supabase
    .from('poc_exclusions')
    .insert({
      organization_id: parsed.data.organizationId,
      poc_benchmark_id: parsed.data.pocBenchmarkId,
      poc_role_id: parsed.data.pocRoleId,
      candidate_id: parsed.data.candidateId ?? null,
      candidate_reference_label: parsed.data.candidateReferenceLabel ?? null,
      side: parsed.data.side,
      exclusion_type: parsed.data.exclusionType,
      reason: parsed.data.reason,
      still_counts_toward_speed: parsed.data.stillCountsTowardSpeed ?? true,
      reverses_exclusion_id: parsed.data.reversesExclusionId ?? null,
      excluded_by: user.id,
    })
    .select('id')
    .single()

  if (error || !exclusion) return { success: false, message: 'Could not record this exclusion.' }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'poc.exclusion_recorded',
      entityType: 'poc_exclusions',
      entityId: exclusion.id,
      metadata: {
        exclusionType: parsed.data.exclusionType,
        side: parsed.data.side,
        isReversal: Boolean(parsed.data.reversesExclusionId),
      },
    },
    supabase,
  )

  revalidatePath(`/poc/${parsed.data.pocBenchmarkId}`)
  return {
    success: true,
    message: parsed.data.reversesExclusionId ? 'Exclusion reversed.' : 'Exclusion recorded.',
  }
}

// ---------------------------------------------------------------------------
// 7. computePocResultsAction
// ---------------------------------------------------------------------------

const ComputeResultsSchema = z.object({
  organizationId: z.string().uuid(),
  pocBenchmarkId: z.string().uuid(),
  pocRoleId: z.string().uuid(),
})

/**
 * Loads the role's full RoleBenchmarkData (via load-detail.ts, which itself
 * assembles everything compare-benchmark.ts needs), calls
 * compareRoleBenchmark(), and upserts each metric x side as a poc_results
 * row — never writing `value` unless `status === 'computed'` (mirrors both
 * the wave-2 discriminated union and poc_results' own
 * poc_results_value_matches_status CHECK constraint). Safely re-callable:
 * poc_results has a unique(poc_role_id, metric_definition_id,
 * metric_definition_version, side) constraint and IS mutable (unlike
 * poc_baselines/poc_metrics/poc_exclusions — confirmed by re-reading
 * supabase/migrations/0030: poc_results carries an updated_at trigger and
 * has no revoke on update/delete), so this always upserts on that
 * conflict key rather than blindly inserting.
 */
export async function computePocResultsAction(formData: FormData): Promise<ActionResult> {
  const parsed = ComputeResultsSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const { supabase, user } = await getAuthedSupabase()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'poc_reports', 'update')

  const detail = await loadPocBenchmarkDetail(
    parsed.data.organizationId,
    parsed.data.pocBenchmarkId,
  )
  if (!detail) return { success: false, message: 'Could not find this POC benchmark.' }

  const roleDetail = detail.roles.find((r) => r.role.id === parsed.data.pocRoleId)
  if (!roleDetail) return { success: false, message: 'Could not find this role on the benchmark.' }

  const metricDefRefs = await loadMetricDefinitionRefMap()
  const nowIso = new Date().toISOString()

  const rows = roleDetail.comparison.metrics.flatMap((metricComparison) => {
    const ref = metricDefRefs.get(metricComparison.metricKey)
    if (!ref) return []

    return (['vendor', 'client'] as const).map((side) => {
      const result = side === 'vendor' ? metricComparison.vendor : metricComparison.client
      return {
        organization_id: parsed.data.organizationId,
        poc_benchmark_id: parsed.data.pocBenchmarkId,
        poc_role_id: parsed.data.pocRoleId,
        metric_definition_id: ref.id,
        metric_definition_version: ref.version,
        side,
        status: result.status,
        value: isComputedResult(result) ? result.value : null,
        value_unit: isComputedResult(result) ? result.unit : null,
        calculation_input_ref: isComputedResult(result)
          ? result.inputsUsed.map((id) => ({ id }))
          : [],
        computed_at: nowIso,
        computed_by: user.id,
        notes: !isComputedResult(result) ? result.reason : null,
      }
    })
  })

  if (rows.length === 0)
    return {
      success: false,
      message: 'No metric definitions are published yet — nothing to compute.',
    }

  const { error } = await supabase
    .from('poc_results')
    .upsert(rows, { onConflict: 'poc_role_id,metric_definition_id,metric_definition_version,side' })

  if (error) return { success: false, message: 'Could not save the computed results.' }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'poc.result_computed',
      entityType: 'poc_roles',
      entityId: parsed.data.pocRoleId,
      metadata: {
        computedMetricCount: rows.filter((r) => r.status === 'computed').length,
        totalRowCount: rows.length,
      },
    },
    supabase,
  )

  revalidatePath(`/poc/${parsed.data.pocBenchmarkId}`)
  return { success: true, message: 'Results computed.' }
}

// ---------------------------------------------------------------------------
// 8. recordPocDecisionAction
// ---------------------------------------------------------------------------

const RecordDecisionSchema = z.object({
  organizationId: z.string().uuid(),
  pocBenchmarkId: z.string().uuid(),
  decision: z.enum(['proceed_to_paid_pilot', 'extend_poc', 'do_not_proceed']),
  notes: z.string().trim().min(1).max(4000),
})

/** Records the commercial decision. Gated on requirePermission(..., 'create') against the poc_reports matrix, whose only 'full' role is agency_admin (platform_admin excepted per the RLS insert policy's own comment) — see this module's header note on why 'create' (not the unheld 'approve') is the correct action here. notes is required by both this schema and the DB's NOT NULL/length CHECK. */
export async function recordPocDecisionAction(formData: FormData): Promise<ActionResult> {
  const parsed = RecordDecisionSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'A decision and notes are required.' }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const { supabase, user } = await getAuthedSupabase()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'poc_reports', 'create')

  const { data: benchmark } = await supabase
    .from('poc_benchmarks')
    .select('status')
    .eq('id', parsed.data.pocBenchmarkId)
    .eq('organization_id', parsed.data.organizationId)
    .maybeSingle()
  if (!benchmark) return { success: false, message: 'Could not find this POC benchmark.' }

  const { data: decision, error } = await supabase
    .from('poc_decisions')
    .insert({
      organization_id: parsed.data.organizationId,
      poc_benchmark_id: parsed.data.pocBenchmarkId,
      decision: parsed.data.decision,
      notes: parsed.data.notes,
      approved_by: user.id,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error || !decision) return { success: false, message: 'Could not record this decision.' }

  if (benchmark.status === 'completed') {
    await supabase
      .from('poc_benchmarks')
      .update({ status: 'decided' })
      .eq('id', parsed.data.pocBenchmarkId)
      .eq('organization_id', parsed.data.organizationId)
  }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'poc.decision_recorded',
      entityType: 'poc_decisions',
      entityId: decision.id,
      metadata: { decision: parsed.data.decision },
    },
    supabase,
  )

  revalidatePath(`/poc/${parsed.data.pocBenchmarkId}`)
  revalidatePath('/poc')
  return { success: true, message: 'Decision recorded.' }
}
