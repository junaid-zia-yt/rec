'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { supabaseConfigured } from '@/lib/env'
import { logAuditEvent, type AuditAction } from '@/lib/audit/log'
import { GENERIC_AUTH_ERROR_MESSAGE } from '@/lib/auth/errors'
import { requirePermission } from '@/lib/auth/session'
import type { ActionResult } from '@/lib/auth/actions'

/**
 * Employment history / education / certifications / skills — Build Phase 5
 * brief §"Candidate profile". Every row in these tables is human-entered in
 * this build phase (source='manual' or 'csv_import') — never AI-extracted,
 * per the brief: "Do not implement AI CV parsing ... yet."
 *
 * Deliberately create + delete only (no in-place edit) for this first
 * vertical slice — correcting a line item is delete-and-re-add, which keeps
 * this module small and every write auditable as a distinct created/deleted
 * event, at the cost of losing the "was edited" moment itself. Noted as a
 * known simplification in docs/build-phase-5-report.md, not an oversight.
 */

async function authorize(organizationId: string) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { error: GENERIC_AUTH_ERROR_MESSAGE as string, supabase: null, userId: null }

  await requirePermission(user.id, organizationId, 'candidate_records', 'update')
  return { error: null, supabase: supabase!, userId: user.id }
}

async function deleteDetailRow(
  table: string,
  action: AuditAction,
  formData: FormData,
): Promise<ActionResult> {
  const Schema = z.object({
    organizationId: z.string().uuid(),
    candidateId: z.string().uuid(),
    rowId: z.string().uuid(),
  })
  const parsed = Schema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured) {
    return { success: false, message: 'This environment is not connected to a live database yet.' }
  }

  const { error: authError, supabase, userId } = await authorize(parsed.data.organizationId)
  if (authError || !supabase || !userId)
    return { success: false, message: authError ?? GENERIC_AUTH_ERROR_MESSAGE }

  const { error } = await supabase
    .from(table)
    .delete()
    .eq('id', parsed.data.rowId)
    .eq('candidate_id', parsed.data.candidateId)
    .eq('organization_id', parsed.data.organizationId)

  if (error) return { success: false, message: 'Could not remove this entry.' }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: userId,
      action,
      entityType: table,
      entityId: parsed.data.rowId,
    },
    supabase,
  )

  revalidatePath(`/candidates/${parsed.data.candidateId}`)
  return { success: true, message: 'Removed.' }
}

// ---------------------------------------------------------------------------
// Experience
// ---------------------------------------------------------------------------

const ExperienceSchema = z.object({
  organizationId: z.string().uuid(),
  candidateId: z.string().uuid(),
  company: z.string().trim().min(1, 'Company is required.').max(200),
  title: z.string().trim().min(1, 'Title is required.').max(200),
  location: z.string().trim().max(200).optional(),
  startDate: z.string().trim().optional(),
  endDate: z.string().trim().optional(),
  isCurrent: z.coerce.boolean().optional().default(false),
  description: z.string().trim().max(2000).optional(),
})

export async function addCandidateExperienceAction(formData: FormData): Promise<ActionResult> {
  const parsed = ExperienceSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? 'Check the details.' }
  }
  if (!supabaseConfigured) {
    return { success: false, message: 'This environment is not connected to a live database yet.' }
  }

  const { error: authError, supabase, userId } = await authorize(parsed.data.organizationId)
  if (authError || !supabase || !userId)
    return { success: false, message: authError ?? GENERIC_AUTH_ERROR_MESSAGE }

  const { error } = await supabase.from('candidate_experiences').insert({
    organization_id: parsed.data.organizationId,
    candidate_id: parsed.data.candidateId,
    company: parsed.data.company,
    title: parsed.data.title,
    location: parsed.data.location || null,
    start_date: parsed.data.startDate || null,
    end_date: parsed.data.isCurrent ? null : parsed.data.endDate || null,
    is_current: parsed.data.isCurrent,
    description: parsed.data.description || null,
    created_by: userId,
  })

  if (error) return { success: false, message: 'Could not add this role.' }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: userId,
      action: 'candidate.experience_added',
      entityType: 'candidate_experiences',
      entityId: parsed.data.candidateId,
      after: { company: parsed.data.company, title: parsed.data.title },
    },
    supabase,
  )

  revalidatePath(`/candidates/${parsed.data.candidateId}`)
  return { success: true, message: 'Work history added.' }
}

export async function deleteCandidateExperienceAction(formData: FormData): Promise<ActionResult> {
  return deleteDetailRow('candidate_experiences', 'candidate.experience_deleted', formData)
}

// ---------------------------------------------------------------------------
// Education
// ---------------------------------------------------------------------------

const EducationSchema = z.object({
  organizationId: z.string().uuid(),
  candidateId: z.string().uuid(),
  institution: z.string().trim().min(1, 'Institution is required.').max(200),
  degree: z.string().trim().max(200).optional(),
  fieldOfStudy: z.string().trim().max(200).optional(),
  startDate: z.string().trim().optional(),
  endDate: z.string().trim().optional(),
})

export async function addCandidateEducationAction(formData: FormData): Promise<ActionResult> {
  const parsed = EducationSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? 'Check the details.' }
  }
  if (!supabaseConfigured) {
    return { success: false, message: 'This environment is not connected to a live database yet.' }
  }

  const { error: authError, supabase, userId } = await authorize(parsed.data.organizationId)
  if (authError || !supabase || !userId)
    return { success: false, message: authError ?? GENERIC_AUTH_ERROR_MESSAGE }

  const { error } = await supabase.from('candidate_education').insert({
    organization_id: parsed.data.organizationId,
    candidate_id: parsed.data.candidateId,
    institution: parsed.data.institution,
    degree: parsed.data.degree || null,
    field_of_study: parsed.data.fieldOfStudy || null,
    start_date: parsed.data.startDate || null,
    end_date: parsed.data.endDate || null,
    created_by: userId,
  })

  if (error) return { success: false, message: 'Could not add this education entry.' }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: userId,
      action: 'candidate.education_added',
      entityType: 'candidate_education',
      entityId: parsed.data.candidateId,
      after: { institution: parsed.data.institution },
    },
    supabase,
  )

  revalidatePath(`/candidates/${parsed.data.candidateId}`)
  return { success: true, message: 'Education added.' }
}

export async function deleteCandidateEducationAction(formData: FormData): Promise<ActionResult> {
  return deleteDetailRow('candidate_education', 'candidate.education_deleted', formData)
}

// ---------------------------------------------------------------------------
// Certifications
// ---------------------------------------------------------------------------

const CertificationSchema = z.object({
  organizationId: z.string().uuid(),
  candidateId: z.string().uuid(),
  name: z.string().trim().min(1, 'Name is required.').max(200),
  issuingBody: z.string().trim().max(200).optional(),
  issuedDate: z.string().trim().optional(),
  expiresDate: z.string().trim().optional(),
})

export async function addCandidateCertificationAction(formData: FormData): Promise<ActionResult> {
  const parsed = CertificationSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? 'Check the details.' }
  }
  if (!supabaseConfigured) {
    return { success: false, message: 'This environment is not connected to a live database yet.' }
  }

  const { error: authError, supabase, userId } = await authorize(parsed.data.organizationId)
  if (authError || !supabase || !userId)
    return { success: false, message: authError ?? GENERIC_AUTH_ERROR_MESSAGE }

  const { error } = await supabase.from('candidate_certifications').insert({
    organization_id: parsed.data.organizationId,
    candidate_id: parsed.data.candidateId,
    name: parsed.data.name,
    issuing_body: parsed.data.issuingBody || null,
    issued_date: parsed.data.issuedDate || null,
    expires_date: parsed.data.expiresDate || null,
    created_by: userId,
  })

  if (error) return { success: false, message: 'Could not add this certification.' }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: userId,
      action: 'candidate.certification_added',
      entityType: 'candidate_certifications',
      entityId: parsed.data.candidateId,
      after: { name: parsed.data.name },
    },
    supabase,
  )

  revalidatePath(`/candidates/${parsed.data.candidateId}`)
  return { success: true, message: 'Certification added.' }
}

export async function deleteCandidateCertificationAction(
  formData: FormData,
): Promise<ActionResult> {
  return deleteDetailRow('candidate_certifications', 'candidate.certification_deleted', formData)
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

const SkillSchema = z.object({
  organizationId: z.string().uuid(),
  candidateId: z.string().uuid(),
  skillName: z.string().trim().min(1, 'Skill name is required.').max(100),
  proficiency: z.enum(['beginner', 'intermediate', 'advanced', 'expert']).optional(),
  yearsExperience: z.coerce.number().min(0).optional(),
})

export async function addCandidateSkillAction(formData: FormData): Promise<ActionResult> {
  const parsed = SkillSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? 'Check the details.' }
  }
  if (!supabaseConfigured) {
    return { success: false, message: 'This environment is not connected to a live database yet.' }
  }

  const { error: authError, supabase, userId } = await authorize(parsed.data.organizationId)
  if (authError || !supabase || !userId)
    return { success: false, message: authError ?? GENERIC_AUTH_ERROR_MESSAGE }

  const { error } = await supabase.from('candidate_skills').insert({
    organization_id: parsed.data.organizationId,
    candidate_id: parsed.data.candidateId,
    skill_name: parsed.data.skillName,
    proficiency: parsed.data.proficiency ?? null,
    years_experience: parsed.data.yearsExperience ?? null,
    created_by: userId,
  })

  if (error) {
    return {
      success: false,
      message:
        error.code === '23505' ? 'This skill has already been added.' : 'Could not add this skill.',
    }
  }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: userId,
      action: 'candidate.skill_added',
      entityType: 'candidate_skills',
      entityId: parsed.data.candidateId,
      after: { skillName: parsed.data.skillName },
    },
    supabase,
  )

  revalidatePath(`/candidates/${parsed.data.candidateId}`)
  return { success: true, message: 'Skill added.' }
}

export async function deleteCandidateSkillAction(formData: FormData): Promise<ActionResult> {
  return deleteDetailRow('candidate_skills', 'candidate.skill_deleted', formData)
}
