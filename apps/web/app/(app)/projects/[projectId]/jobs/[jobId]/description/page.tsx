import { notFound } from 'next/navigation'
import { Breadcrumbs, Card, CardBody, PageHeader } from '@rqi/ui'
import { JobDescriptionForm } from '@/components/domain/projects/job-description-form'
import { getDemoProject, getDemoJob } from '@/lib/demo/engine'
import { supabaseConfigured } from '@/lib/env'
import { requireAuth, resolveActiveOrg } from '@/lib/auth/session'
import { requireProjectAccess } from '@/lib/auth/project-access'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export const metadata = { title: 'Job description' }
// Build Phase 18 repair: force dynamic rendering — reads the private
// demo's mutable in-memory engine. See docs/demo-limitations.md §8.
export const dynamic = 'force-dynamic'

export default async function JobDescriptionPage({
  params,
}: {
  params: Promise<{ projectId: string; jobId: string }>
}) {
  const { projectId, jobId } = await params

  if (!supabaseConfigured) {
    const project = getDemoProject(projectId)
    const job = getDemoJob(projectId)
    if (!project || !job || job.id !== jobId) notFound()
    return (
      <div className="flex flex-col gap-6">
        <Breadcrumbs
          items={[
            { label: 'Projects', href: '/projects' },
            { label: project.roleTitle, href: `/projects/${project.id}` },
            { label: 'Job description' },
          ]}
        />
        <PageHeader title={`Job description — ${job.title}`} />
        <Card className="max-w-3xl">
          <CardBody className="text-muted text-sm">
            {job.jobDescriptionText}
          </CardBody>
        </Card>
      </div>
    )
  }

  const user = await requireAuth(`/projects/${projectId}/jobs/${jobId}/description`)
  const membership = await resolveActiveOrg(user.id)
  const supabase = await createServerSupabaseClient()

  const { data: job } = await supabase!
    .from('jobs')
    .select('id, title, recruitment_project_id, recruitment_projects(id, role_title, client_id)')
    .eq('id', jobId)
    .eq('organization_id', membership.organizationId)
    .maybeSingle()

  if (!job) notFound()
  const project = job.recruitment_projects as unknown as {
    id: string
    role_title: string
    client_id: string
  } | null
  if (!project) notFound()
  await requireProjectAccess(user.id, membership, { id: project.id, clientId: project.client_id })

  const { data: versions } = await supabase!
    .from('job_descriptions')
    .select('id, source, version_no, status, file_name, superseded_at, created_at')
    .eq('job_id', jobId)
    .order('version_no', { ascending: false })

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: 'Projects', href: '/projects' },
          { label: project.role_title, href: `/projects/${project.id}` },
          { label: 'Job description' },
        ]}
      />
      <PageHeader
        title={`Job description — ${job.title}`}
        description="Paste text or upload a PDF/Word file. Uploading a new version supersedes the previous one; earlier versions are kept, never deleted."
      />

      <div className="flex flex-col gap-6 lg:flex-row">
        <Card className="max-w-2xl flex-1">
          <CardBody>
            <JobDescriptionForm
              organizationId={membership.organizationId}
              projectId={project.id}
              projectClientId={project.client_id}
              jobId={job.id}
            />
          </CardBody>
        </Card>

        <div className="w-full lg:w-72 lg:shrink-0">
          <h2 className="text-tertiary mb-3 text-sm font-semibold">Versions</h2>
          {!versions || versions.length === 0 ? (
            <p className="text-muted text-sm">No job description yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {versions.map((v) => (
                <li key={v.id} className="border-outline-cell rounded-card border p-3 text-sm">
                  <p className="text-tertiary font-medium">
                    v{v.version_no} — {v.source.replace('_', ' ')}
                  </p>
                  <p className="text-muted text-xs">
                    {v.status}
                    {v.superseded_at ? ' · superseded' : ''}
                  </p>
                  {v.file_name && <p className="text-muted truncate text-xs">{v.file_name}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
