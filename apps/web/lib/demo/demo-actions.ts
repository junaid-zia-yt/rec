'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { supabaseConfigured } from '@/lib/env'
import type { ProjectStatus } from '@rqi/types'
import type { ActionResult } from '@/lib/auth/actions'
import {
  runDemoEvaluation,
  markDemoCandidateReviewed,
  shortlistDemoCandidate,
  removeDemoShortlistCandidate,
  submitDemoShortlist,
  addDemoCandidate,
  importDemoCandidatesCsv,
  createDemoOutreachDraft,
  decideDemoOutreachDraft,
  transitionDemoProjectStatus,
  resetDemoState,
  type DemoOutreachChannel,
} from './engine'

/**
 * Build Phase 18 — server actions that drive the private-demo engine
 * (apps/web/lib/demo/engine.ts). Every action here is ONLY ever reachable
 * from a page's `!supabaseConfigured` branch; each still re-checks the
 * flag itself so a future refactor can't accidentally wire a demo action
 * into a live-database page. None of these ever construct a Supabase
 * client, never call an outreach provider, and never claim a live AI
 * result — see engine.ts's header for the full rationale.
 */

const DEMO_ACTOR_NAME = 'Dana Reyes (demo)'

function demoGuard(): ActionResult | null {
  if (supabaseConfigured) {
    return { success: false, message: 'This action is only available in the private demo.' }
  }
  return null
}

const RunEvaluationSchema = z.object({
  projectId: z.string().min(1),
  candidateId: z.string().min(1),
})

export async function runDemoEvaluationAction(formData: FormData): Promise<ActionResult> {
  const guard = demoGuard()
  if (guard) return guard
  const parsed = RunEvaluationSchema.safeParse({
    projectId: formData.get('projectId'),
    candidateId: formData.get('candidateId'),
  })
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }

  const result = await runDemoEvaluation(parsed.data.projectId, parsed.data.candidateId, DEMO_ACTOR_NAME)
  revalidatePath(`/candidates/${parsed.data.candidateId}`)
  revalidatePath(`/projects/${parsed.data.projectId}`)
  revalidatePath(`/shortlists`)
  return result
}

const CandidateProjectSchema = z.object({
  projectId: z.string().min(1),
  candidateId: z.string().min(1),
})

export async function markDemoCandidateReviewedAction(formData: FormData): Promise<ActionResult> {
  const guard = demoGuard()
  if (guard) return guard
  const parsed = CandidateProjectSchema.safeParse({
    projectId: formData.get('projectId'),
    candidateId: formData.get('candidateId'),
  })
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  const result = markDemoCandidateReviewed(parsed.data.projectId, parsed.data.candidateId, DEMO_ACTOR_NAME)
  revalidatePath(`/candidates/${parsed.data.candidateId}`)
  revalidatePath(`/shortlists`)
  return result
}

export async function shortlistDemoCandidateAction(formData: FormData): Promise<ActionResult> {
  const guard = demoGuard()
  if (guard) return guard
  const parsed = CandidateProjectSchema.safeParse({
    projectId: formData.get('projectId'),
    candidateId: formData.get('candidateId'),
  })
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  const result = shortlistDemoCandidate(parsed.data.projectId, parsed.data.candidateId, DEMO_ACTOR_NAME)
  revalidatePath(`/shortlists`)
  revalidatePath(`/shortlists/${parsed.data.projectId}`)
  revalidatePath(`/projects/${parsed.data.projectId}`)
  return result
}

export async function removeDemoShortlistCandidateAction(formData: FormData): Promise<ActionResult> {
  const guard = demoGuard()
  if (guard) return guard
  const parsed = CandidateProjectSchema.safeParse({
    projectId: formData.get('projectId'),
    candidateId: formData.get('candidateId'),
  })
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  const result = removeDemoShortlistCandidate(parsed.data.projectId, parsed.data.candidateId, DEMO_ACTOR_NAME)
  revalidatePath(`/shortlists`)
  revalidatePath(`/shortlists/${parsed.data.projectId}`)
  return result
}

const ProjectOnlySchema = z.object({ projectId: z.string().min(1) })

export async function submitDemoShortlistAction(formData: FormData): Promise<ActionResult> {
  const guard = demoGuard()
  if (guard) return guard
  const parsed = ProjectOnlySchema.safeParse({ projectId: formData.get('projectId') })
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  const result = submitDemoShortlist(parsed.data.projectId, DEMO_ACTOR_NAME)
  revalidatePath(`/shortlists`)
  revalidatePath(`/projects/${parsed.data.projectId}`)
  return result
}

const AddCandidateSchema = z.object({
  projectId: z.string().min(1),
  fullName: z.string().trim().min(1, 'Full name is required.').max(200),
  primaryEmail: z.string().trim().email('Not a valid email.').or(z.literal('')).optional(),
  primaryPhone: z.string().trim().max(40).optional(),
  currentTitle: z.string().trim().max(200).optional(),
  currentCompany: z.string().trim().max(200).optional(),
  location: z.string().trim().max(200).optional(),
  sourceChannel: z
    .enum(['linkedin', 'referral', 'apollo', 'manual', 'csv_import', 'job_board', 'other'])
    .optional(),
})

export async function addDemoCandidateAction(formData: FormData): Promise<ActionResult> {
  const guard = demoGuard()
  if (guard) return guard
  const parsed = AddCandidateSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? 'Check the candidate details.' }
  }
  const { projectId, ...input } = parsed.data
  const result = addDemoCandidate(projectId, input, DEMO_ACTOR_NAME)
  revalidatePath('/candidates')
  revalidatePath(`/projects/${projectId}`)
  return result
}

const CsvRowSchema = z.object({
  fullName: z.string().trim().min(1),
  primaryEmail: z.string().trim().optional(),
  primaryPhone: z.string().trim().optional(),
  currentTitle: z.string().trim().optional(),
  currentCompany: z.string().trim().optional(),
})

const ImportCsvSchema = z.object({
  projectId: z.string().min(1),
  rows: z.array(CsvRowSchema).min(1),
})

export async function importDemoCandidatesCsvAction(input: {
  projectId: string
  rows: z.infer<typeof CsvRowSchema>[]
}): Promise<ActionResult> {
  const guard = demoGuard()
  if (guard) return guard
  const parsed = ImportCsvSchema.safeParse(input)
  if (!parsed.success) return { success: false, message: 'Check the CSV file and try again.' }
  const result = importDemoCandidatesCsv(parsed.data.projectId, parsed.data.rows, DEMO_ACTOR_NAME)
  revalidatePath('/candidates')
  revalidatePath(`/projects/${parsed.data.projectId}`)
  return result
}

const CreateOutreachSchema = z.object({
  projectId: z.string().min(1),
  candidateId: z.string().min(1),
  templateId: z.string().min(1),
})

export async function createDemoOutreachDraftAction(formData: FormData): Promise<ActionResult> {
  const guard = demoGuard()
  if (guard) return guard
  const parsed = CreateOutreachSchema.safeParse({
    projectId: formData.get('projectId'),
    candidateId: formData.get('candidateId'),
    templateId: formData.get('templateId'),
  })
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  const result = createDemoOutreachDraft(
    parsed.data.projectId,
    parsed.data.candidateId,
    parsed.data.templateId,
    DEMO_ACTOR_NAME,
  )
  revalidatePath('/outreach')
  return result
}

const DecideOutreachSchema = z.object({
  draftId: z.string().min(1),
  decision: z.enum(['approve', 'reject']),
  reason: z.string().trim().max(1000).optional(),
})

export async function decideDemoOutreachDraftAction(formData: FormData): Promise<ActionResult> {
  const guard = demoGuard()
  if (guard) return guard
  const parsed = DecideOutreachSchema.safeParse({
    draftId: formData.get('draftId'),
    decision: formData.get('decision'),
    reason: formData.get('reason') || undefined,
  })
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  const result = decideDemoOutreachDraft(parsed.data.draftId, parsed.data.decision, DEMO_ACTOR_NAME, parsed.data.reason)
  revalidatePath('/outreach')
  return result
}

const TransitionSchema = z.object({
  projectId: z.string().min(1),
  status: z.enum(['intake', 'sourcing', 'shortlisting', 'client_review', 'closed']),
})

export async function transitionDemoProjectStatusAction(formData: FormData): Promise<ActionResult> {
  const guard = demoGuard()
  if (guard) return guard
  const parsed = TransitionSchema.safeParse({
    projectId: formData.get('projectId'),
    status: formData.get('status'),
  })
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  const result = transitionDemoProjectStatus(parsed.data.projectId, parsed.data.status as ProjectStatus, DEMO_ACTOR_NAME)
  revalidatePath(`/projects/${parsed.data.projectId}`)
  revalidatePath('/projects')
  return result
}

export async function resetDemoDataAction(): Promise<ActionResult> {
  const guard = demoGuard()
  if (guard) return guard
  resetDemoState()
  revalidatePath('/', 'layout')
  return { success: true, message: 'Demo data has been reset to the original scenario.' }
}

export type { DemoOutreachChannel }
