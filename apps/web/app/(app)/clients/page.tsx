import Link from 'next/link'
import { Button, PageHeader } from '@rqi/ui'
import { DEMO_CLIENTS } from '@/lib/mock-data'
import { ClientsList } from '@/components/domain/clients/clients-list'
import { supabaseConfigured } from '@/lib/env'
import { requireAuth, resolveActiveOrg } from '@/lib/auth/session'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { Client } from '@rqi/types'

export const metadata = { title: 'Clients' }

async function loadClients(): Promise<{ clients: Client[]; live: boolean }> {
  if (!supabaseConfigured) return { clients: DEMO_CLIENTS, live: false }

  const user = await requireAuth('/clients')
  const membership = await resolveActiveOrg(user.id)
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase!
    .from('clients')
    .select(
      'id, organization_id, name, vertical, primary_contact_name, primary_contact_email, primary_contact_phone, status, created_at',
    )
    .eq('organization_id', membership.organizationId)
    .order('name', { ascending: true })

  if (error || !data) return { clients: [], live: true }

  return {
    live: true,
    clients: data.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      vertical: row.vertical ?? '',
      primaryContactName: row.primary_contact_name,
      primaryContactEmail: row.primary_contact_email,
      primaryContactPhone: row.primary_contact_phone,
      status: row.status,
      createdAt: row.created_at,
    })),
  }
}

/** Client management — Build Phase 3 brief §"Client management". Renders real, org-scoped data once Supabase is configured; falls back to demo fixtures otherwise, same convention as every other screen in this app (docs/build-phase-2-report.md). */
export default async function ClientsPage() {
  const { clients } = await loadClients()

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Clients"
        description="The end-client companies your organization recruits for."
        actions={
          <Button asChild>
            <Link href="/clients/new">New client</Link>
          </Button>
        }
      />
      <ClientsList clients={clients} />
    </div>
  )
}
