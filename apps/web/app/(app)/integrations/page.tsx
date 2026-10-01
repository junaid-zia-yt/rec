import { Card, CardBody, EmptyState, PageHeader, SectionHeader } from '@rqi/ui'
import { Plug } from 'lucide-react'
import { supabaseConfigured } from '@/lib/env'
import { requireAuth, resolveActiveOrg } from '@/lib/auth/session'
import { loadIntegrationConnections, loadIntegrationSyncJobSummary } from '@/lib/integrations/load'
import { IntegrationsPanel } from '@/components/domain/integrations/integrations-panel'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export const metadata = { title: 'Integrations' }

/**
 * Integrations — Build Phase 12, Wave 5 (Task D). REWIRE, not a redesign:
 * this route was previously a Build Phase 1 static service-status list
 * (Supabase/Claude/Resend/Sentry env-flag checks) with no connection to
 * this phase's real `integration_connections` table. That page's own
 * purpose — an honest "is this configured" status view — is preserved
 * (the `!supabaseConfigured` demo-fallback empty state below), but its
 * content is now the real, DB-backed per-provider connection state this
 * phase's brief describes (TA Tracker/Apollo/Google Calendar/Microsoft
 * Calendar/SMS: connection status, account owner, last sync, sync error,
 * disconnect), matching the brief's "one card per provider" requirement —
 * the reserved `/integrations` nav slot (`lib/nav.ts`) already pointed
 * here, so no nav change was needed.
 */
export default async function IntegrationsPage() {
  if (!supabaseConfigured) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Integrations"
          description="Connection status for TA Tracker, Apollo, calendars, and SMS. Requires a live database connection."
        />
        <EmptyState
          icon={Plug}
          title="Not connected to a live database"
          description="Integration connections will appear here once this environment has a configured Supabase project."
        />
      </div>
    )
  }

  const user = await requireAuth('/integrations')
  const membership = await resolveActiveOrg(user.id)
  const supabase = await createServerSupabaseClient()

  const [{ visible, connections }, jobSummary] = await Promise.all([
    loadIntegrationConnections(membership.organizationId, membership.role, supabase!),
    membership.role === 'agency_admin' || membership.role === 'platform_admin'
      ? loadIntegrationSyncJobSummary(membership.organizationId, supabase!)
      : Promise.resolve(null),
  ])

  const canManage = membership.role === 'agency_admin'

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Integrations"
        description="Connection status, account ownership, and sync history for every external service this platform can connect to."
      />

      {jobSummary && (jobSummary.failed > 0 || jobSummary.deadLettered > 0) && (
        <Card>
          <CardBody className="text-tertiary text-xs">
            {jobSummary.failed + jobSummary.deadLettered} sync job(s) have failed recently. See{' '}
            <a href="/settings/jobs" className="text-secondary font-medium underline">
              Job status
            </a>{' '}
            for details.
          </CardBody>
        </Card>
      )}

      <section aria-labelledby="integrations-heading" className="flex flex-col gap-3">
        <SectionHeader title="Providers" />
        <IntegrationsPanel
          organizationId={membership.organizationId}
          connections={connections}
          visible={visible}
          canManage={canManage}
        />
      </section>
    </div>
  )
}
