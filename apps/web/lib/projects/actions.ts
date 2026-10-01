'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { supabaseConfigured } from '@/lib/env'
import { logAuditEvent } from '@/lib/audit/log'
import { logProjectActivity } from '@/lib/audit/activity'
import { GENERIC_AUTH_ERROR_MESSAGE } from '@/lib/auth/errors'
import { requirePermission } from '@/lib/auth/session'
import { requireProjectAccess } from '@/lib/auth/project-access'
import type { ActionResult } from '@/lib/auth/actions'

/** Recruitment-project server actions (Build Phase 3 brief §"Recruitment projects"). */

const ProjectFieldsSchema = z.object({
  organizationId: z.string().uuid(),
  clientId: z.string().uuid(),
  roleTitle: z.string().trim().min(1, 'Role title is required.').max(200),
  vertical: z.string().trim().max(100).optional().default(''),
  isPoc: z.coerce.boolean().optional().default(false),
  targetShortlistSize: z.coerce.number().int().min(1).max(3).optional().default(3),
  matchThreshold: z.coerce.number().min(0).max(100).optional().default(70),
  saveAsDraft: z.coerce.boolean().optional().default(false),
})

export async function createProjectAction(formData: FormData): Promise<ActionResult> {
  const parsed = ProjectFieldsSchema.safeParse({
    organizationId: formData.get('organizationId'),
    clientId: formData.get('clientId'),
    roleTitle: formData.get('roleTitle'),
    vertical: formData.get('vertical') ?? undefined,
    isPoc: formData.get('isPoc') ?? undefined,
    targetShortlistSize: formData.get('targetShortlistSize') ?? undefined,
    matchThreshold: formData.get('matchThreshold') ?? undefined,
    saveAsDraft: formData.get('saveAsDraft') ?? undefined,
  })
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? 'Check the form and try again.',
    }
  }
  if (!supabaseConfigured) {
    return { success: false, message: 'This environment is not connected to a live database yet.' }
  }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'recruitment_projects', 'create')

  const { data: project, error } = await supabase!
    .from('recruitment_projects')
    .insert({
      organization_id: parsed.data.organizationId,
      client_id: parsed.data.clientId,
      role_title: parsed.data.roleTitle,
      vertical: parsed.data.vertical || '',
      is_poc: parsed.data.isPoc,
      target_shortlist_size: parsed.data.targetShortlistSize,
      match_threshold: parsed.data.matchThreshold,
      is_draft: parsed.data.saveAsDraft,
      status: 'intake',
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error || !project) {
    return { success: false, message: 'Could not create the project.' }
  }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'project.created',
      entityType: 'recruitment_projects',
      entityId: project.id,
      after: { roleTitle: parsed.data.roleTitle, draft: parsed.data.saveAsDraft },
    },
    supabase,
  )
  await logProjectActivity(
    {
      organizationId: parsed.data.organizationId,
      recruitmentProjectId: project.id,
      actorId: user.id,
      action: 'project.created',
      summary: parsed.data.saveAsDraft
        ? `Saved "${parsed.data.roleTitle}" as a draft.`
        : `Created project "${parsed.data.roleTitle}".`,
    },
    supabase,
  )

  revalidatePath('/projects')
  return { success: true, message: parsed.data.saveAsDraft ? 'Draft saved.' : 'Project created.' }
}

const UpdateProjectSchema = ProjectFieldsSchema.extend({
  projectId: z.string().uuid(),
  status: z.enum(['intake', 'sourcing', 'shortlisting', 'client_review', 'closed']).optional(),
})

export async function updateProjectAction(formData: FormData): Promise<ActionResult> {
  const parsed = UpdateProjectSchema.safeParse({
    organizationId: formData.get('organizationId'),
    projectId: formData.get('projectId'),
    clientId: formData.get('clientId'),
    roleTitle: formData.get('roleTitle'),
    vertical: formData.get('vertical') ?? undefined,
    isPoc: formData.get('isPoc') ?? undefined,
    targetShortlistSize: formData.get('targetShortlistSize') ?? undefined,
    matchThreshold: formData.get('matchThreshold') ?? undefined,
    saveAsDraft: formData.get('saveAsDraft') ?? undefined,
    status: formData.get('status') ?? undefined,
  })
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? 'Check the form and try again.',
    }
  }
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
    'recruitment_projects',
    'update',
  )
  await requireProjectAccess(user.id, membership, {
    id: parsed.data.projectId,
    clientId: parsed.data.clientId,
  })

  const { data: before } = await supabase!
    .from('recruitment_projects')
    .select('role_title, status, target_shortlist_size, match_threshold')
    .eq('id', parsed.data.projectId)
    .eq('organization_id', parsed.data.organizationId)
    .single()

  const { error } = await supabase!
    .from('recruitment_projects')
    .update({
      client_id: parsed.data.clientId,
      role_title: parsed.data.roleTitle,
      vertical: parsed.data.vertical || '',
      is_poc: parsed.data.isPoc,
      target_shortlist_size: parsed.data.targetShortlistSize,
      match_threshold: parsed.data.matchThreshold,
      is_draft: parsed.data.saveAsDraft,
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
    })
    .eq('id', parsed.data.projectId)
    .eq('organization_id', parsed.data.organizationId)

  if (error) return { success: false, message: 'Could not update the project.' }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'project.updated',
      entityType: 'recruitment_projects',
      entityId: parsed.data.projectId,
      before,
      after: { roleTitle: parsed.data.roleTitle, status: parsed.data.status },
    },
    supabase,
  )
  await logProjectActivity(
    {
      organizationId: parsed.data.organizationId,
      recruitmentProjectId: parsed.data.projectId,
      actorId: user.id,
      action: 'project.updated',
      summary: `Updated project details.`,
    },
    supabase,
  )

  revalidatePath('/projects')
  revalidatePath(`/projects/${parsed.data.projectId}`)
  return { success: true, message: 'Project updated.' }
}

const ArchiveProjectSchema = z.object({
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  clientId: z.string().uuid(),
})

export async function archiveProjectAction(formData: FormData): Promise<ActionResult> {
  const parsed = ArchiveProjectSchema.safeParse({
    organizationId: formData.get('organizationId'),
    projectId: formData.get('projectId'),
    clientId: formData.get('clientId'),
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
    'recruitment_projects',
    'delete',
  )
  await requireProjectAccess(user.id, membership, {
    id: parsed.data.projectId,
    clientId: parsed.data.clientId,
  })

  const { error } = await supabase!
    .from('recruitment_projects')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', parsed.data.projectId)
    .eq('organization_id', parsed.data.organizationId)

  if (error) return { success: false, message: 'Could not archive the project.' }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'project.archived',
      entityType: 'recruitment_projects',
      entityId: parsed.data.projectId,
    },
    supabase,
  )
  await logProjectActivity(
    {
      organizationId: parsed.data.organizationId,
      recruitmentProjectId: parsed.data.projectId,
      actorId: user.id,
      action: 'project.archived',
      summary: 'Project archived.',
    },
    supabase,
  )

  revalidatePath('/projects')
  return { success: true, message: 'Project archived.' }
}

const AssignRecruiterSchema = z.object({
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  clientId: z.string().uuid(),
  userId: z.string().uuid(),
  assignmentRole: z.enum(['lead_recruiter', 'recruiter']).optional().default('recruiter'),
})

/** Assigns a recruiter to a project — the row that gives them access at all, per docs/06 §PERMISSIONS "Recruiters can access assigned projects" and the RLS in 0012_project_assignments.sql. agency_admin only. */
export async function assignRecruiterAction(formData: FormData): Promise<ActionResult> {
  const parsed = AssignRecruiterSchema.safeParse({
    organizationId: formData.get('organizationId'),
    projectId: formData.get('projectId'),
    clientId: formData.get('clientId'),
    userId: formData.get('userId'),
    assignmentRole: formData.get('assignmentRole') ?? undefined,
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

  // Assignment itself is an agency_admin-only action, regardless of the
  // caller's own project access — agency_admin has org-wide project access
  // per canAccessProject, so requirePermission alone (resource: recruitment_projects,
  // action: update) already gates this correctly.
  await requirePermission(user.id, parsed.data.organizationId, 'recruitment_projects', 'update')

  const { error } = await supabase!.from('project_assignments').upsert(
    {
      organization_id: parsed.data.organizationId,
      recruitment_project_id: parsed.data.projectId,
      user_id: parsed.data.userId,
      assignment_role: parsed.data.assignmentRole,
      assigned_by: user.id,
    },
    { onConflict: 'recruitment_project_id,user_id' },
  )

  if (error) return { success: false, message: 'Could not assign this recruiter.' }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'project.assignment_changed',
      entityType: 'project_assignments',
      entityId: parsed.data.projectId,
      after: { userId: parsed.data.userId, assignmentRole: parsed.data.assignmentRole },
    },
    supabase,
  )
  await logProjectActivity(
    {
      organizationId: parsed.data.organizationId,
      recruitmentProjectId: parsed.data.projectId,
      actorId: user.id,
      action: 'project.assignment_changed',
      summary: 'Recruiter assigned to project.',
    },
    supabase,
  )

  revalidatePath(`/projects/${parsed.data.projectId}`)
  return { success: true, message: 'Recruiter assigned.' }
}

const UnassignRecruiterSchema = z.object({
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  userId: z.string().uuid(),
})

export async function unassignRecruiterAction(formData: FormData): Promise<ActionResult> {
  const parsed = UnassignRecruiterSchema.safeParse({
    organizationId: formData.get('organizationId'),
    projectId: formData.get('projectId'),
    userId: formData.get('userId'),
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

  await requirePermission(user.id, parsed.data.organizationId, 'recruitment_projects', 'update')

  const { error } = await supabase!
    .from('project_assignments')
    .delete()
    .eq('organization_id', parsed.data.organizationId)
    .eq('recruitment_project_id', parsed.data.projectId)
    .eq('user_id', parsed.data.userId)

  if (error) return { success: false, message: 'Could not remove this recruiter.' }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'project.assignment_changed',
      entityType: 'project_assignments',
      entityId: parsed.data.projectId,
      after: { userId: parsed.data.userId, removed: true },
    },
    supabase,
  )

  revalidatePath(`/projects/${parsed.data.projectId}`)
  return { success: true, message: 'Recruiter removed from project.' }
}
