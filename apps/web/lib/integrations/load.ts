import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  IntegrationConnectionMode,
  IntegrationConnectionStatus,
  IntegrationProvider,
  IntegrationSyncStatus,
} from '@rqi/types'
import type { Membership } from '@/lib/auth/membership'

/**
 * Build Phase 12, Wave 5 (Task C) — `integration_connections` read loader
 * for the Integrations settings screen.
 *
 * PERMISSIONS-VS-RLS RESOLUTION (this wave's required judgment call — see
 * 0032's own `integration_connections_select_admin_or_oversight` policy
 * comment, which explicitly flags this as an open question for "the UI
 * wave" to resolve): `packages/types/src/permissions.ts`'s `integrations`
 * row grants `recruiter`/`read_only_reviewer` an app-layer `'read'`, but
 * the table's RLS grants NO role but `agency_admin` (full) and
 * `platform_admin` (read-only oversight) any DB-layer access at all —
 * `client_decision_maker` gets neither.
 *
 * DECISION: rather than widen RLS or run this query through a service-role
 * (elevated-trust) client on a recruiter's behalf — either of which would
 * make integration_connections a wider-than-stated-elsewhere exposure —
 * this loader returns a NARROWER-THAN-'full' summary for every role but
 * `agency_admin`/`platform_admin`: a flat, honest "connection status is
 * visible to agency admins only" list (every provider still listed, so the
 * UI's per-provider cards render consistently for every role), with no
 * query attempted at all for those roles (an attempted query would simply
 * return zero rows under RLS, which the UI could misread as "nothing is
 * connected" rather than "you can't see this"). `agency_admin`/
 * `platform_admin` get the real, DB-backed status below. This mirrors this
 * wave's identical resolution for the write side (`integration-actions.ts`
 * gates every write on a direct `agency_admin`-only role check, never the
 * wider app-layer matrix, so a `platform_admin` — 'full' in the matrix —
 * never attempts a write RLS would reject anyway).
 */

export const INTEGRATION_PROVIDERS: readonly { provider: IntegrationProvider; label: string }[] = [
  { provider: 'ta_tracker', label: 'TA Tracker' },
  { provider: 'apollo', label: 'Apollo' },
  { provider: 'google_calendar', label: 'Google Calendar' },
  { provider: 'microsoft_calendar', label: 'Microsoft Calendar' },
  { provider: 'sms', label: 'SMS' },
]

export interface IntegrationConnectionSummary {
  provider: IntegrationProvider
  label: string
  mode: IntegrationConnectionMode | null
  status: IntegrationConnectionStatus
  accountOwnerLabel: string | null
  lastSyncAt: string | null
  lastSyncStatus: IntegrationSyncStatus | null
  lastSyncError: string | null
  connectionId: string | null
}

export interface IntegrationConnectionsView {
  /** False for every role but agency_admin/platform_admin — see this module's header note. The UI renders an honest "ask an agency admin" affordance rather than the real per-provider detail when this is false. */
  visible: boolean
  connections: IntegrationConnectionSummary[]
}

function notConnectedRow(
  provider: IntegrationProvider,
  label: string,
): IntegrationConnectionSummary {
  return {
    provider,
    label,
    mode: null,
    status: 'not_connected',
    accountOwnerLabel: null,
    lastSyncAt: null,
    lastSyncStatus: null,
    lastSyncError: null,
    connectionId: null,
  }
}

const VISIBLE_ROLES: ReadonlyArray<Membership['role']> = ['agency_admin', 'platform_admin']

export async function loadIntegrationConnections(
  organizationId: string,
  role: Membership['role'],
  supabase: SupabaseClient,
): Promise<IntegrationConnectionsView> {
  if (!VISIBLE_ROLES.includes(role)) {
    return {
      visible: false,
      connections: INTEGRATION_PROVIDERS.map((p) => notConnectedRow(p.provider, p.label)),
    }
  }

  const { data, error } = await supabase
    .from('integration_connections')
    .select(
      'id, provider, mode, status, account_owner_label, last_sync_at, last_sync_status, last_sync_error',
    )
    .eq('organization_id', organizationId)

  if (error) {
    throw new Error(`loadIntegrationConnections: could not load connections: ${error.message}`)
  }

  const byProvider = new Map((data ?? []).map((row) => [row.provider as IntegrationProvider, row]))

  const connections = INTEGRATION_PROVIDERS.map(({ provider, label }) => {
    const row = byProvider.get(provider)
    if (!row) return notConnectedRow(provider, label)
    return {
      provider,
      label,
      mode: (row.mode as IntegrationConnectionMode | null) ?? null,
      status: row.status as IntegrationConnectionStatus,
      accountOwnerLabel: (row.account_owner_label as string | null) ?? null,
      lastSyncAt: (row.last_sync_at as string | null) ?? null,
      lastSyncStatus: (row.last_sync_status as IntegrationSyncStatus | null) ?? null,
      lastSyncError: (row.last_sync_error as string | null) ?? null,
      connectionId: row.id as string,
    }
  })

  return { visible: true, connections }
}

export interface IntegrationSyncJobSummary {
  queued: number
  running: number
  failed: number
  deadLettered: number
}

/** A small `integration_sync`-job-type count-by-status summary (Task C: "job status summary" for the Integrations screen) — deliberately not the full job list (that is `lib/jobs/load.ts`'s job, linked from here). */
export async function loadIntegrationSyncJobSummary(
  organizationId: string,
  supabase: SupabaseClient,
): Promise<IntegrationSyncJobSummary> {
  const { data, error } = await supabase
    .from('background_jobs')
    .select('status')
    .eq('organization_id', organizationId)
    .eq('job_type', 'integration_sync')
    .in('status', ['queued', 'running', 'failed', 'dead_lettered'])

  if (error) {
    throw new Error(`loadIntegrationSyncJobSummary: could not load job summary: ${error.message}`)
  }

  const summary: IntegrationSyncJobSummary = { queued: 0, running: 0, failed: 0, deadLettered: 0 }
  for (const row of data ?? []) {
    const status = row.status as string
    if (status === 'queued') summary.queued += 1
    else if (status === 'running') summary.running += 1
    else if (status === 'failed') summary.failed += 1
    else if (status === 'dead_lettered') summary.deadLettered += 1
  }
  return summary
}
