'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { supabaseConfigured } from '@/lib/env'
import { GENERIC_AUTH_ERROR_MESSAGE } from '@/lib/auth/errors'
import { manuallyRetryJob } from './manual-retry'
import type { ActionResult } from '@/lib/auth/actions'

/**
 * Build Phase 12, Wave 5 (Task B) — thin server-action wrapper over Wave
 * 2's `manuallyRetryJob`. The permission check happens INSIDE
 * `manuallyRetryJob` itself (its own documented direct-role-check, not
 * `requirePermission` — see that module's header note), so this wrapper's
 * only job is turning `ManuallyRetryJobResult`'s union into the standard
 * `ActionResult` shape and revalidating the job-status page.
 */

const ManuallyRetryJobSchema = z.object({
  jobId: z.string().uuid(),
})

export async function manuallyRetryJobAction(formData: FormData): Promise<ActionResult> {
  const parsed = ManuallyRetryJobSchema.safeParse({ jobId: formData.get('jobId') })
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  const result = await manuallyRetryJob({
    jobId: parsed.data.jobId,
    userId: user.id,
    supabase: supabase!,
  })

  revalidatePath('/settings/jobs')

  switch (result.status) {
    case 'retried':
      return { success: true, message: 'Job requeued.' }
    case 'not_found':
      return { success: false, message: 'This job could not be found.' }
    case 'forbidden':
      return { success: false, message: 'Only an agency or platform admin may retry a job.' }
    case 'not_retryable':
      return {
        success: false,
        message: `This job cannot be retried from its current state (${result.currentStatus}).`,
      }
  }
}
