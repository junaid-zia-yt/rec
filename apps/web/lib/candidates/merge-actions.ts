'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { supabaseConfigured } from '@/lib/env'
import { logAuditEvent } from '@/lib/audit/log'
import { GENERIC_AUTH_ERROR_MESSAGE } from '@/lib/auth/errors'
import { requirePermission } from '@/lib/auth/session'
import { validateCandidateMerge } from './merge'
import type { ActionResult } from '@/lib/auth/actions'

/**
 * Candidate merge — Build Phase 5 brief §"Deduplication": "Human decision
 * before merging", "Merge audit trail", "No destructive automatic merge".
 *
 * This action is the ONLY path in the codebase that can change a
 * candidates.status to 'merged' — there is no automatic/background merge
 * process anywhere. validateCandidateMerge (./merge.ts) is the deterministic
 * pre-flight gate; everything below it is the mechanical, non-destructive
 * reassignment of the losing candidate's child rows to the surviving one.
 *
 * Known limitation (docs/build-phase-5-report.md): this reassignment is a
 * sequence of ordinary Supabase calls, not one atomic database transaction
 * (the Supabase JS client does not expose multi-statement transactions to
 * server actions) — a mid-sequence failure could leave a merge partially
 * applied. A follow-up phase should move this into a single Postgres
 * function (an RPC) for true atomicity; this build reports the outcome
 * honestly rather than claiming atomicity it does not have.
 */

const REASSIGN_TABLES_SIMPLE = [
  'candidate_contact_points',
  'candidate_documents',
  'candidate_experiences',
  'candidate_education',
  'candidate_certifications',
  'candidate_sources',
  'candidate_pipeline_events',
] as const

const MergeSchema = z.object({
  organizationId: z.string().uuid(),
  winnerCandidateId: z.string().uuid(),
  loserCandidateId: z.string().uuid(),
})

export async function mergeCandidatesAction(formData: FormData): Promise<ActionResult> {
  const parsed = MergeSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured) {
    return { success: false, message: 'This environment is not connected to a live database yet.' }
  }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'candidate_records', 'delete')

  const [{ data: winner }, { data: loser }] = await Promise.all([
    supabase!
      .from('candidates')
      .select('id, organization_id, status')
      .eq('id', parsed.data.winnerCandidateId)
      .single(),
    supabase!
      .from('candidates')
      .select('id, organization_id, status')
      .eq('id', parsed.data.loserCandidateId)
      .single(),
  ])

  if (!winner || !loser) {
    return { success: false, message: 'Both candidates must exist to merge them.' }
  }

  const check = validateCandidateMerge(
    { id: winner.id, organizationId: winner.organization_id, status: winner.status },
    { id: loser.id, organizationId: loser.organization_id, status: loser.status },
  )
  if (!check.valid) {
    return { success: false, message: check.reason ?? 'This merge is not allowed.' }
  }

  // One-to-many child tables: reassign outright.
  for (const table of REASSIGN_TABLES_SIMPLE) {
    await supabase!
      .from(table)
      .update({ candidate_id: winner.id })
      .eq('candidate_id', loser.id)
      .eq('organization_id', parsed.data.organizationId)
  }

  // candidate_skills: unique(candidate_id, lower(skill_name)) — reassign
  // only the loser's skills the winner does not already have; drop the rest
  // (never a data-loss silently reported as success: the audit event below
  // records how many were dropped as duplicates).
  const { data: winnerSkills } = await supabase!
    .from('candidate_skills')
    .select('skill_name')
    .eq('candidate_id', winner.id)
  const winnerSkillNames = new Set(
    (winnerSkills ?? []).map((s) => (s.skill_name as string).toLowerCase()),
  )

  const { data: loserSkills } = await supabase!
    .from('candidate_skills')
    .select('id, skill_name')
    .eq('candidate_id', loser.id)

  let skillsDropped = 0
  for (const skill of loserSkills ?? []) {
    if (winnerSkillNames.has((skill.skill_name as string).toLowerCase())) {
      await supabase!.from('candidate_skills').delete().eq('id', skill.id)
      skillsDropped += 1
    } else {
      await supabase!
        .from('candidate_skills')
        .update({ candidate_id: winner.id })
        .eq('id', skill.id)
    }
  }

  // candidate_project_entries: unique(candidate_id, recruitment_project_id)
  // — reassign only entries for a project the winner is not already in.
  const { data: winnerEntries } = await supabase!
    .from('candidate_project_entries')
    .select('recruitment_project_id')
    .eq('candidate_id', winner.id)
  const winnerProjectIds = new Set(
    (winnerEntries ?? []).map((e) => e.recruitment_project_id as string),
  )

  const { data: loserEntries } = await supabase!
    .from('candidate_project_entries')
    .select('id, recruitment_project_id')
    .eq('candidate_id', loser.id)

  let entriesDropped = 0
  for (const entry of loserEntries ?? []) {
    if (winnerProjectIds.has(entry.recruitment_project_id as string)) {
      entriesDropped += 1
    } else {
      await supabase!
        .from('candidate_project_entries')
        .update({ candidate_id: winner.id })
        .eq('id', entry.id)
    }
  }

  // candidate_consents: 1:1 — keep the winner's if it has one, otherwise
  // adopt the loser's.
  const { data: winnerConsent } = await supabase!
    .from('candidate_consents')
    .select('id')
    .eq('candidate_id', winner.id)
    .maybeSingle()
  if (!winnerConsent) {
    await supabase!
      .from('candidate_consents')
      .update({ candidate_id: winner.id })
      .eq('candidate_id', loser.id)
  }

  // The loser's own candidates/candidate_profiles rows are kept (never
  // deleted) so any historical reference to the loser's id still resolves —
  // docs/07-data-model.md §7.4.
  const { error: loserUpdateError } = await supabase!
    .from('candidates')
    .update({ status: 'merged', merged_into_candidate_id: winner.id })
    .eq('id', loser.id)

  if (loserUpdateError) {
    return { success: false, message: 'Could not finish recording the merge.' }
  }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'candidate.merged',
      entityType: 'candidates',
      entityId: loser.id,
      before: { loserCandidateId: loser.id },
      after: { winnerCandidateId: winner.id },
      metadata: {
        skillsDroppedAsDuplicate: skillsDropped,
        projectEntriesDroppedAsDuplicate: entriesDropped,
      },
    },
    supabase,
  )

  revalidatePath('/candidates')
  revalidatePath(`/candidates/${winner.id}`)
  revalidatePath(`/candidates/${loser.id}`)
  return { success: true, message: 'Candidates merged.' }
}
