import Link from 'next/link'
import { Card, CardBody, PageHeader } from '@rqi/ui'
import { DEMO_CLIENTS } from '@/lib/mock-data'
import { ProjectForm } from '@/components/domain/projects/project-form'
import { supabaseConfigured } from '@/lib/env'
import { requireAuth, resolveActiveOrg } from '@/lib/auth/session'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { Client } from '@rqi/types'

export const metadata = { title: 'New recruitment project' }

async function loadContext(): Promise<{ organizationId: string | null; clients: Client[] }> {
  if (!supabaseConfigured) return { organizationId: null, clients: DEMO_CLIENTS }

  const user = await requireAuth('/projects/new')
  const membership = await resolveActiveOrg(user.id)
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase!
    .from('clients')
    .select(
      'id, organization_id, name, vertical, primary_contact_name, primary_contact_email, primary_contact_phone, status, created_at',
    )
    .eq('organization_id', membership.organizationId)
    .eq('status', 'active')
    .order('name', { ascending: true })

  const clients: Client[] = (data ?? []).map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    vertical: row.vertical ?? '',
    primaryContactName: row.primary_contact_name,
    primaryContactEmail: row.primary_contact_email,
    primaryContactPhone: row.primary_contact_phone,
    status: row.status,
    createdAt: row.created_at,
  }))

  return { organizationId: membership.organizationId, clients }
}

export default async function NewProjectPage() {
  const { organizationId, clients } = await loadContext()

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="New recruitment project"
        description="Start a project for one open role. You'll add the job and its description on the next step."
      />

      {supabaseConfigured && organizationId ? (
        <Card className="max-w-2xl">
          <CardBody>
            <ProjectForm organizationId={organizationId} clients={clients} />
          </CardBody>
        </Card>
      ) : (
        <Card className="max-w-2xl">
          <CardBody className="text-muted text-sm">
            Creating projects requires a configured Supabase project. See{' '}
            <Link href="/integrations" className="text-secondary font-medium hover:underline">
              Integrations
            </Link>{' '}
            for connection status.
          </CardBody>
        </Card>
      )}
    </div>
  )
}
