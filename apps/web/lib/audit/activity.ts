import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase/server'

/**
 * Writes one project_activity row — the user-facing "what happened on this
 * project" feed shown on the Project Activity screen. Distinct from
 * audit_events (apps/web/lib/audit/log.ts), which is the compliance-grade
 * log; a state-changing project action logs to both, never one instead of
 * the other.
 *
 * Never throws, for the same availability reason as logAuditEvent — a
 * failed activity-feed write must not block the action it is describing.
 */
export async function logProjectActivity(
  input: {
    organizationId: string
    recruitmentProjectId: string
    actorId: string
    action: string
    summary: string
    metadata?: Record<string, unknown>
  },
  client?: SupabaseClient | null,
): Promise<void> {
  const supabase = client ?? (await createServerSupabaseClient())
  if (!supabase) return

  const { error } = await supabase.from('project_activity').insert({
    organization_id: input.organizationId,
    recruitment_project_id: input.recruitmentProjectId,
    actor_id: input.actorId,
    action: input.action,
    summary: input.summary,
    metadata: input.metadata ?? {},
  })

  if (error) {
    console.error(`[project_activity] failed to log ${input.action}:`, error.message)
  }
}
