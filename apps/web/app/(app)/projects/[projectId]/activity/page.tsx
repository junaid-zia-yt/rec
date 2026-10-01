import { notFound } from 'next/navigation'
import { Breadcrumbs, Card, EmptyState, PageHeader } from '@rqi/ui'
import { supabaseConfigured } from '@/lib/env'
import { requireAuth, resolveActiveOrg } from '@/lib/auth/session'
import { requireProjectAccess } from '@/lib/auth/project-access'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getDemoProject, getDemoActivity } from '@/lib/demo/engine'
import type { ProjectActivity } from '@rqi/types'

export const metadata = { title: 'Project activity' }
// Build Phase 18 repair: force dynamic rendering — reads the private
// demo's mutable in-memory engine. See docs/demo-limitations.md §8.
export const dynamic = 'force-dynamic'

function ActivityFeed({ title, items }: { title: string; items: ProjectActivity[] }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Activity — ${title}`}
        description="Everything that's happened on this project."
      />
      {items.length === 0 ? (
        <EmptyState
          title="No activity yet"
          description="Actions on this project will appear here."
        />
      ) : (
        <Card>
          <ul className="divide-outline-cell divide-y">
            {items.map((item) => (
              <li key={item.id} className="flex flex-col gap-0.5 p-4">
                <p className="text-tertiary text-sm font-medium">{item.summary}</p>
                <p className="text-muted text-xs">
                  {item.actorName} · {new Date(item.createdAt).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

export default async function ProjectActivityPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params

  if (!supabaseConfigured) {
    // Build Phase 18: every entry below is the demo engine's real activity
    // log (lib/demo/engine.ts's recordActivity), written by every demo
    // action — evaluation, review, shortlisting, outreach, status changes —
    // not a static fixture. See project instructions: "Every important
    // action must visibly update the relevant screen, project stage and
    // audit/activity history."
    const project = getDemoProject(projectId)
    if (!project) notFound()
    const items: ProjectActivity[] = getDemoActivity(projectId).map((a) => ({
      id: a.id,
      recruitmentProjectId: projectId,
      actorName: a.actorName,
      action: a.action,
      summary: a.summary,
      createdAt: a.createdAt,
    }))
    return (
      <div className="flex flex-col gap-6">
        <Breadcrumbs
          items={[
            { label: 'Projects', href: '/projects' },
            { label: project.roleTitle, href: `/projects/${project.id}` },
            { label: 'Activity' },
          ]}
        />
        <ActivityFeed title={project.roleTitle} items={items} />
      </div>
    )
  }

  const user = await requireAuth(`/projects/${projectId}/activity`)
  const membership = await resolveActiveOrg(user.id)
  const supabase = await createServerSupabaseClient()

  const { data: project } = await supabase!
    .from('recruitment_projects')
    .select('id, role_title, client_id')
    .eq('id', projectId)
    .eq('organization_id', membership.organizationId)
    .maybeSingle()

  if (!project) notFound()
  await requireProjectAccess(user.id, membership, { id: project.id, clientId: project.client_id })

  const { data: rows } = await supabase!
    .from('project_activity')
    .select('id, action, summary, created_at, actor_id, user_profiles(full_name)')
    .eq('recruitment_project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(100)

  const items: ProjectActivity[] = (rows ?? []).map((row) => ({
    id: row.id,
    recruitmentProjectId: projectId,
    actorName:
      (row.user_profiles as unknown as { full_name: string } | null)?.full_name ?? 'System',
    action: row.action,
    summary: row.summary,
    createdAt: row.created_at,
  }))

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: 'Projects', href: '/projects' },
          { label: project.role_title, href: `/projects/${project.id}` },
          { label: 'Activity' },
        ]}
      />
      <ActivityFeed title={project.role_title} items={items} />
    </div>
  )
}
