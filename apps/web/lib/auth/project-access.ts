import 'server-only'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import {
  canAccessProject as canAccessProjectPure,
  requireProjectAccess as requireProjectAccessPure,
} from './project-scope'
import type { Membership } from './membership'

/** Fetches which recruitment_project ids the caller has an assignment row for. Never trusted from the client — always re-read. */
async function fetchAssignedProjectIds(userId: string, organizationId: string): Promise<string[]> {
  const supabase = await createServerSupabaseClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from('project_assignments')
    .select('recruitment_project_id')
    .eq('user_id', userId)
    .eq('organization_id', organizationId)

  if (error || !data) return []
  return data.map((row) => row.recruitment_project_id as string)
}

/**
 * Throws CrossTenantAccessError unless `membership` may access `projectId`
 * (org-wide roles always may; a recruiter only if assigned; a client
 * decision maker only if the project belongs to their own client). Combines
 * the pure row-level check (./project-scope.ts) with the one piece of I/O it
 * needs — the caller's assignment rows.
 */
export async function requireProjectAccess(
  userId: string,
  membership: Membership,
  project: { id: string; clientId: string },
): Promise<void> {
  const assignedProjectIds =
    membership.role === 'recruiter'
      ? await fetchAssignedProjectIds(userId, membership.organizationId)
      : []

  requireProjectAccessPure(membership, project, assignedProjectIds, project.id)
}

/** Non-throwing variant, for filtering a list (e.g. the projects index) rather than gating a single-resource page. */
export async function filterAccessibleProjects<T extends { id: string; clientId: string }>(
  userId: string,
  membership: Membership,
  projects: T[],
): Promise<T[]> {
  const assignedProjectIds =
    membership.role === 'recruiter'
      ? await fetchAssignedProjectIds(userId, membership.organizationId)
      : []

  return projects.filter((p) => canAccessProjectPure(membership, p, assignedProjectIds, p.id))
}
