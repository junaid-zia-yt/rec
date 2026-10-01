import Link from 'next/link'
import { Card, CardBody, PageHeader } from '@rqi/ui'
import { ClientForm } from '@/components/domain/clients/client-form'
import { supabaseConfigured } from '@/lib/env'
import { requireAuth, resolveActiveOrg } from '@/lib/auth/session'

export const metadata = { title: 'New client' }

export default async function NewClientPage() {
  const activeOrgId = supabaseConfigured
    ? (await resolveActiveOrg((await requireAuth('/clients/new')).id)).organizationId
    : null

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="New client" description="Add a company your organization recruits for." />
      {supabaseConfigured && activeOrgId ? (
        <div className="max-w-xl">
          <ClientForm organizationId={activeOrgId} />
        </div>
      ) : (
        <Card className="max-w-xl">
          <CardBody className="text-muted text-sm">
            Creating clients requires a configured Supabase project. See{' '}
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
