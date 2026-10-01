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

/** Job-intake server actions (Build Phase 3 brief §"Job intake"). A job belongs to a recruitment project; access is gated by the same project-level scoping as the project itself. */

const JobFieldsSchema = z.object({
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  projectClientId: z.string().uuid(),
  title: z.string().trim().min(1, 'Role title is required.').max(200),
  department: z.string().trim().max(150).optional(),
  industry: z.string().trim().max(150).optional(),
  employmentType: z.enum(['full_time', 'part_time', 'contract', 'temporary', 'seasonal']),
  workplaceArrangement: z.enum(['on_site', 'hybrid', 'remote']),
  location: z.string().trim().max(200).optional().default(''),
  commutingRadiusMiles: z.coerce.number().int().min(0).optional(),
  salaryMin: z.coerce.number().min(0).optional(),
  salaryMax: z.coerce.number().min(0).optional(),
  currency: z.string().trim().length(3).optional().default('USD'),
  workAuthorizationRequired: z.string().trim().max(200).optional(),
  sponsorshipAvailable: z.coerce.boolean().optional().default(false),
  targetStartDate: z.string().trim().optional(),
  hiringManagerNotes: z.string().trim().max(5000).optional(),
  maxShortlistSize: z.coerce.number().int().min(1).max(3).optional().default(3),
  minMatchThreshold: z.coerce.number().min(0).max(100).optional().default(70),
})

function fieldsToRow(data: z.infer<typeof JobFieldsSchema>) {
  return {
    title: data.title,
    department: data.department || null,
    industry: data.industry || null,
    employment_type: data.employmentType,
    workplace_arrangement: data.workplaceArrangement,
    location: data.location || '',
    commuting_radius_miles: data.commutingRadiusMiles ?? null,
    salary_min: data.salaryMin ?? null,
    salary_max: data.salaryMax ?? null,
    currency: data.currency || 'USD',
    work_authorization_required: data.workAuthorizationRequired || null,
    sponsorship_available: data.sponsorshipAvailable,
    target_start_date: data.targetStartDate || null,
    hiring_manager_notes: data.hiringManagerNotes || null,
    max_shortlist_size: data.maxShortlistSize,
    min_match_threshold: data.minMatchThreshold,
  }
}

export async function createJobAction(formData: FormData): Promise<ActionResult> {
  const parsed = JobFieldsSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? 'Check the job details and try again.',
    }
  }
  if (
    parsed.data.salaryMin != null &&
    parsed.data.salaryMax != null &&
    parsed.data.salaryMin > parsed.data.salaryMax
  ) {
    return { success: false, message: 'Minimum salary cannot be greater than maximum salary.' }
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
    'job_descriptions',
    'create',
  )
  await requireProjectAccess(user.id, membership, {
    id: parsed.data.projectId,
    clientId: parsed.data.projectClientId,
  })

  const { data: job, error } = await supabase!
    .from('jobs')
    .insert({
      organization_id: parsed.data.organizationId,
      recruitment_project_id: parsed.data.projectId,
      ...fieldsToRow(parsed.data),
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error || !job) {
    return { success: false, message: 'Could not create the job.' }
  }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'job.created',
      entityType: 'jobs',
      entityId: job.id,
      after: { title: parsed.data.title },
    },
    supabase,
  )
  await logProjectActivity(
    {
      organizationId: parsed.data.organizationId,
      recruitmentProjectId: parsed.data.projectId,
      actorId: user.id,
      action: 'job.created',
      summary: `Added job "${parsed.data.title}".`,
    },
    supabase,
  )

  revalidatePath(`/projects/${parsed.data.projectId}`)
  return { success: true, message: 'Job created.' }
}

const UpdateJobSchema = JobFieldsSchema.extend({ jobId: z.string().uuid() })

export async function updateJobAction(formData: FormData): Promise<ActionResult> {
  const parsed = UpdateJobSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? 'Check the job details and try again.',
    }
  }
  if (
    parsed.data.salaryMin != null &&
    parsed.data.salaryMax != null &&
    parsed.data.salaryMin > parsed.data.salaryMax
  ) {
    return { success: false, message: 'Minimum salary cannot be greater than maximum salary.' }
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
    'job_descriptions',
    'update',
  )
  await requireProjectAccess(user.id, membership, {
    id: parsed.data.projectId,
    clientId: parsed.data.projectClientId,
  })

  const { error } = await supabase!
    .from('jobs')
    .update(fieldsToRow(parsed.data))
    .eq('id', parsed.data.jobId)
    .eq('organization_id', parsed.data.organizationId)

  if (error) return { success: false, message: 'Could not update the job.' }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'job.updated',
      entityType: 'jobs',
      entityId: parsed.data.jobId,
      after: { title: parsed.data.title },
    },
    supabase,
  )
  await logProjectActivity(
    {
      organizationId: parsed.data.organizationId,
      recruitmentProjectId: parsed.data.projectId,
      actorId: user.id,
      action: 'job.updated',
      summary: `Updated job "${parsed.data.title}".`,
    },
    supabase,
  )

  revalidatePath(`/projects/${parsed.data.projectId}`)
  return { success: true, message: 'Job updated.' }
}
