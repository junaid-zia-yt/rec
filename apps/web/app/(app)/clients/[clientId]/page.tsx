import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  Breadcrumbs,
  Card,
  CardBody,
  EmptyState,
  PageHeader,
  SectionHeader,
  StatusBadge,
} from '@rqi/ui'
import { DEMO_CLIENTS, DEMO_PROJECTS } from '@/lib/mock-data'
import { ClientForm } from '@/components/domain/clients/client-form'
import { ArchiveClientButton } from '@/components/domain/clients/archive-client-button'
import { supabaseConfigured } from '@/lib/env'
import { requireAuth, resolveActiveOrg } from '@/lib/auth/session'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { Client, RecruitmentProject } from '@rqi/types'

export const metadata = { title: 'Client' }

async function loadClient(clientId: string): Promise<{
  client: Client | null
  projects: RecruitmentProject[]
  organizationId: string | null
}> {
  if (!supabaseConfigured) {
    const client = DEMO_CLIENTS.find((c) => c.id === clientId) ?? null
    const projects = DEMO_PROJECTS.filter((p) => p.clientId === clientId)
    return { client, projects, organizationId: null }
  }

  const user = await requireAuth(`/clients/${clientId}`)
  const membership = await resolveActiveOrg(user.id)
  const supabase = await createServerSupabaseClient()

  const [{ data: clientRow }, { data: projectRows }] = await Promise.all([
    supabase!
      .from('clients')
      .select(
        'id, organization_id, name, vertical, primary_contact_name, primary_contact_email, primary_contact_phone, status, created_at',
      )
      .eq('id', clientId)
      .eq('organization_id', membership.organizationId)
      .maybeSingle(),
    supabase!
      .from('recruitment_projects')
      .select(
        'id, organization_id, client_id, role_title, vertical, status, is_poc, target_shortlist_size, match_threshold, archived_at, client_can_approve_scorecards, created_at',
      )
      .eq('client_id', clientId)
      .eq('organization_id', membership.organizationId)
      .order('created_at', { ascending: false }),
  ])

  const client: Client | null = clientRow
    ? {
        id: clientRow.id,
        organizationId: clientRow.organization_id,
        name: clientRow.name,
        vertical: clientRow.vertical ?? '',
        primaryContactName: clientRow.primary_contact_name,
        primaryContactEmail: clientRow.primary_contact_email,
        primaryContactPhone: clientRow.primary_contact_phone,
        status: clientRow.status,
        createdAt: clientRow.created_at,
      }
    : null

  const projects: RecruitmentProject[] = (projectRows ?? []).map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    clientId: row.client_id,
    clientName: client?.name ?? '',
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

  return { client, projects, organizationId: membership.organizationId }
}

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ clientId: string }>
}) {
  const { clientId } = await params
  const { client, projects, organizationId } = await loadClient(clientId)
  if (!client) notFound()

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs items={[{ label: 'Clients', href: '/clients' }, { label: client.name }]} />
      <PageHeader
        title={client.name}
        description={client.vertical || 'No vertical set'}
        actions={
          organizationId && client.status === 'active' ? (
            <ArchiveClientButton organizationId={organizationId} clientId={client.id} />
          ) : undefined
        }
      />

      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="flex flex-1 flex-col gap-6">
          <section aria-labelledby="projects-heading" className="flex flex-col gap-3">
            <SectionHeader title="Recruitment projects" />
            {projects.length === 0 ? (
              <EmptyState
                title="No projects for this client yet"
                description="Create a recruitment project to start sourcing for this client."
                action={
                  <Link
                    href="/projects/new"
                    className="text-secondary text-sm font-medium hover:underline"
                  >
                    New project
                  </Link>
                }
              />
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {projects.map((project) => (
                  <Link key={project.id} href={`/projects/${project.id}`}>
                    <Card className="hover:border-secondary h-full transition-colors">
                      <CardBody className="flex flex-col gap-2">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-tertiary text-sm font-semibold">{project.roleTitle}</p>
                          <StatusBadge status={project.archivedAt ? 'neutral' : 'passed'}>
                            {project.archivedAt ? 'Archived' : project.status.replace('_', ' ')}
                          </StatusBadge>
                        </div>
                        <p className="text-muted text-xs">
                          Shortlist target {project.targetShortlistSize} · Threshold{' '}
                          {project.matchThreshold}%
                        </p>
                      </CardBody>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="w-full lg:w-80 lg:shrink-0">
          <SectionHeader title="Client details" className="mb-3" />
          {organizationId ? (
            <ClientForm organizationId={organizationId} client={client} />
          ) : (
            <Card>
              <CardBody className="text-muted text-sm">
                Editing requires a configured Supabase project.
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
