import Link from 'next/link'
import { Button, PageHeader } from '@rqi/ui'
import { ProjectsList } from '@/components/domain/projects/projects-list'
import { supabaseConfigured } from '@/lib/env'
import { requireAuth, resolveActiveOrg } from '@/lib/auth/session'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { listDemoProjects } from '@/lib/demo/engine'
import type { RecruitmentProject } from '@rqi/types'

export const metadata = { title: 'Recruitment Projects' }
// Build Phase 18 repair: force dynamic rendering — reads the private
// demo's mutable in-memory engine. See docs/demo-limitations.md §8.
export const dynamic = 'force-dynamic'

async function loadProjects(): Promise<RecruitmentProject[]> {
  if (!supabaseConfigured) {
    // Build Phase 18: sourced from the demo engine so this list's project
    // ids match every other demo-mode screen's links (project detail,
    // scorecard, shortlists) — see
    // docs/client-feedback-reproduction-report.md §4.
    return listDemoProjects().map((p) => ({
      id: p.id,
      organizationId: 'demo',
      clientId: p.id,
      clientName: p.clientName,
      roleTitle: p.roleTitle,
      vertical: p.clientVertical,
      status: p.status,
      isPoc: true,
      targetShortlistSize: 3,
      matchThreshold: 70,
      archivedAt: null,
      clientCanApproveScorecards: false,
      createdAt: new Date().toISOString(),
    }))
  }

  const user = await requireAuth('/projects')
  const membership = await resolveActiveOrg(user.id)
  const supabase = await createServerSupabaseClient()

  // RLS already scopes this to what the caller's role permits (org-wide for
  // agency_admin/read_only_reviewer, assigned-only for recruiter, own-client
  // only for client_decision_maker) — no extra application-layer filtering
  // is needed for a list query like this one.
  const { data, error } = await supabase!
    .from('recruitment_projects')
    .select(
      'id, organization_id, client_id, role_title, vertical, status, is_poc, target_shortlist_size, match_threshold, archived_at, client_can_approve_scorecards, created_at, clients(name)',
    )
    .eq('organization_id', membership.organizationId)
    .order('created_at', { ascending: false })

  if (error || !data) return []

  return data.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    clientId: row.client_id,
    clientName: (row.clients as unknown as { name: string } | null)?.name ?? 'Unknown client',
    roleTitle: row.role_title,
    vertical: row.vertical ?? '',
    status: row.status,
    isPoc: row.is_poc,
    targetShortlistSize: row.target_shortlist_size,
    matchThreshold: Number(row.match_threshold),
    archivedAt: row.archived_at,
    clientCanApproveScorecards: row.client_can_approve_scorecards,
    createdAt: row.created_at,
  }))
}

export default async function ProjectsPage() {
  const projects = await loadProjects()

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Recruitment Projects"
        description="Every open role your organization is currently working, across all clients."
        actions={
          <div className="flex gap-2">
            <Button asChild variant="secondary">
              <Link href="/clients">Clients</Link>
            </Button>
            <Button asChild>
              <Link href="/projects/new">New project</Link>
            </Button>
          </div>
        }
      />
      <ProjectsList projects={projects} />
    </div>
  )
}
