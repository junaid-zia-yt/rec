import { notFound } from 'next/navigation'
import { Breadcrumbs, Card, CardBody, PageHeader } from '@rqi/ui'
import { JobIntakeForm } from '@/components/domain/projects/job-intake-form'
import { getDemoProject } from '@/lib/demo/engine'
import { supabaseConfigured } from '@/lib/env'
import { requireAuth, resolveActiveOrg } from '@/lib/auth/session'
import { requireProjectAccess } from '@/lib/auth/project-access'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export const metadata = { title: 'New job' }
// Build Phase 18 repair: force dynamic rendering — reads the private
// demo's mutable in-memory engine. See docs/demo-limitations.md §8.
export const dynamic = 'force-dynamic'

export default async function NewJobPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params

  if (!supabaseConfigured) {
    const project = getDemoProject(projectId)
    if (!project) notFound()
    return (
      <div className="flex flex-col gap-6">
        <Breadcrumbs
          items={[
            { label: 'Projects', href: '/projects' },
            { label: project.roleTitle, href: `/projects/${project.id}` },
            { label: 'New job' },
          ]}
        />
        <PageHeader title="New job" description={`For ${project.clientName}`} />
        <Card className="max-w-2xl">
          <CardBody className="text-muted text-sm">
            Job intake requires a configured Supabase project.
          </CardBody>
        </Card>
      </div>
    )
  }

  const user = await requireAuth(`/projects/${projectId}/jobs/new`)
  const membership = await resolveActiveOrg(user.id)
  const supabase = await createServerSupabaseClient()

  const { data: project } = await supabase!
    .from('recruitment_projects')
    .select('id, role_title, client_id, clients(name)')
    .eq('id', projectId)
    .eq('organization_id', membership.organizationId)
    .maybeSingle()

  if (!project) notFound()
  await requireProjectAccess(user.id, membership, { id: project.id, clientId: project.client_id })

  const clientName =
    (project.clients as unknown as { name: string } | null)?.name ?? 'Unknown client'

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: 'Projects', href: '/projects' },
          { label: project.role_title, href: `/projects/${project.id}` },
          { label: 'New job' },
        ]}
      />
      <PageHeader title="New job" description={`For ${clientName}`} />
      <Card className="max-w-3xl">
        <CardBody>
          <JobIntakeForm
            organizationId={membership.organizationId}
            projectId={project.id}
            projectClientId={project.client_id}
          />
        </CardBody>
      </Card>
    </div>
  )
}
