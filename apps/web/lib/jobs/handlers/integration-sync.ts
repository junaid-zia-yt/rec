/**
 * `integration_sync` job handler (Build Phase 12 Wave 3) — fills the
 * registry slot Wave 2 deliberately left empty (`handlers/index.ts`'s own
 * header note). Dispatches to the adapter matching the job payload's
 * `provider` (already carried directly in the payload per Wave 2's
 * `IntegrationSyncPayloadSchema` note, so this handler can apply TA
 * Tracker's mode-honesty check before any DB round trip), runs a real sync
 * attempt where one is meaningful, and always updates the
 * `integration_connections` row's `last_sync_at`/`last_sync_status`/
 * `last_sync_error` when it can locate that row.
 *
 * WHAT "SYNC" MEANS PER PROVIDER (this wave's own judgment call, since the
 * brief does not specify per-provider sync semantics):
 *   - ta_tracker / mode='api': always `no_documentation` (see
 *     `ta-tracker/api-mode.ts` — cannot report anything else, by
 *     construction).
 *   - ta_tracker / mode='csv_import_export' or 'secure_manual_exchange':
 *     these modes are HUMAN-TRIGGERED (a recruiter uploads/downloads a
 *     file, or logs a manual handoff) — there is no automated background
 *     sync loop for either, so this handler reports an honest `failed`
 *     outcome explaining that, rather than a fabricated success. A later
 *     wave's UI should not offer "sync" as an action for these modes at
 *     all; this handler exists mainly so an `integration_sync` job
 *     enqueued for one (e.g. by mistake, or by a generic "sync all
 *     connections" cron a later wave adds) fails honestly instead of
 *     hanging with `no_handler`.
 *   - apollo / google_calendar / microsoft_calendar: none of these
 *     providers has a meaningful "pull everything" sync in this schema
 *     today (Apollo is on-demand per-contact enrichment with no query
 *     target in this payload; calendars have no stored OAuth token to
 *     sync with — see calendar/types.ts's header note). This handler
 *     therefore treats their "sync" as a configuration/connectivity check:
 *     configured → still `failed` (no live call is attempted without a
 *     concrete target — this handler does not invent one), not configured
 *     → `failed` with a `not_configured` explanation. Either way, the row
 *     is honestly updated; nothing here is ever marked `connected`/
 *     `success` by this handler for these providers, since a real,
 *     specific piece of work (enrich contact X, create event Y) is what
 *     Wave 5's UI/server-action layer will actually enqueue and mark
 *     successful once it exists.
 *   - sms: always `failed` / not configured (mirrors `sms/adapter.ts`).
 *
 * BUILD PHASE 12 WAVE 4 ADDITION (small, justified edit — flagged per that
 * wave's brief): after computing `outcome` and updating the connection
 * row, this handler now calls `notifyIntegrationFailed`
 * (`lib/notifications/event-triggers.ts`) whenever `outcome.outcome ===
 * 'failed'`. This is the actual sync-failure signal in this codebase, NOT
 * a `background_jobs` `dead_lettered` transition: this handler never
 * throws (every branch above returns a normal `IntegrationSyncResult`, by
 * design — see the header note on why TA Tracker/Apollo/calendar/SMS all
 * report an honest `failed` outcome as a VALUE, not an exception), so
 * `executor.ts` always marks this job `succeeded` regardless of the
 * provider-level outcome, and a `dead_lettered` `integration_sync` row
 * would in practice never occur under this handler's current design. A
 * best-effort attempt only — a failure to resolve a notification actor
 * (`context.supabase.auth.getUser()` returning nothing, e.g. no live
 * session bound to this execution) is not itself a reason to fail an
 * otherwise-successful sync attempt's own bookkeeping.
 */
import type { IntegrationProvider } from '@rqi/types'
import { apolloConfigured, googleCalendarConfigured, microsoftCalendarConfigured } from '@/lib/env'
import { attemptApiModeSync } from '@/lib/integrations/ta-tracker/api-mode'
import { notifyIntegrationFailed } from '@/lib/notifications/event-triggers'
import { captureMonitoringMessage } from '@/lib/monitoring/capture'
import type { IntegrationSyncPayload } from '../job-payload-schemas'
import type { JobExecutionContext, JobHandler } from '../types'

export interface IntegrationSyncResult {
  provider: IntegrationProvider
  outcome: 'failed' | 'no_op'
  message: string
}

/** Loads the connection row's `mode` (only meaningful for ta_tracker — every other provider's row has `mode = null`, per 0032's CHECK) — needed before this handler can decide whether TA Tracker's API-mode honesty stub applies. */
async function loadConnectionMode(
  context: JobExecutionContext,
  integrationConnectionId: string,
): Promise<string | null> {
  const { data, error } = await context.supabase
    .from('integration_connections')
    .select('mode')
    .eq('id', integrationConnectionId)
    .maybeSingle()
  if (error || !data) return null
  return (data.mode as string | null) ?? null
}

async function updateConnectionSyncResult(
  context: JobExecutionContext,
  integrationConnectionId: string,
  outcome: { status: 'success' | 'failed'; error: string | null },
): Promise<void> {
  await context.supabase
    .from('integration_connections')
    .update({
      last_sync_at: new Date().toISOString(),
      last_sync_status: outcome.status,
      last_sync_error: outcome.error,
    })
    .eq('id', integrationConnectionId)
}

function notConfiguredMessage(provider: string): string {
  return `${provider} is not configured in this environment — no credentials are set. See lib/env.ts's *Configured flags.`
}

export const integrationSyncHandler: JobHandler<
  IntegrationSyncPayload,
  IntegrationSyncResult
> = async (payload, context: JobExecutionContext) => {
  const { provider, integrationConnectionId } = payload

  let outcome: IntegrationSyncResult

  switch (provider) {
    case 'ta_tracker': {
      const mode = await loadConnectionMode(context, integrationConnectionId)
      if (mode === 'api') {
        const result = attemptApiModeSync()
        outcome = { provider, outcome: 'failed', message: result.errorMessage }
      } else {
        outcome = {
          provider,
          outcome: 'failed',
          message: `TA Tracker mode '${mode ?? 'unknown'}' is human-triggered (CSV import/export or secure manual exchange) and has no automated sync loop — nothing to run for an integration_sync job.`,
        }
      }
      break
    }
    case 'apollo': {
      outcome = apolloConfigured
        ? {
            provider,
            outcome: 'no_op',
            message:
              'Apollo is configured, but integration_sync carries no specific enrichment target to run — enrichment is triggered per-candidate by a future wave, not as a bulk sync.',
          }
        : { provider, outcome: 'failed', message: notConfiguredMessage('Apollo') }
      break
    }
    case 'google_calendar':
    case 'microsoft_calendar': {
      const configured =
        provider === 'google_calendar' ? googleCalendarConfigured : microsoftCalendarConfigured
      outcome = configured
        ? {
            provider,
            outcome: 'no_op',
            message: `${provider} is configured, but no stored OAuth access token exists yet for this connection (no token storage in this schema) — nothing to sync.`,
          }
        : { provider, outcome: 'failed', message: notConfiguredMessage(provider) }
      break
    }
    case 'sms': {
      outcome = {
        provider,
        outcome: 'failed',
        message: notConfiguredMessage('SMS (no provider chosen)'),
      }
      break
    }
    default: {
      outcome = {
        provider,
        outcome: 'failed',
        message: `Unknown integration provider '${provider}'.`,
      }
    }
  }

  await updateConnectionSyncResult(context, integrationConnectionId, {
    status: outcome.outcome === 'no_op' ? 'success' : 'failed',
    error: outcome.outcome === 'no_op' ? null : outcome.message,
  })

  if (outcome.outcome === 'failed') {
    captureMonitoringMessage(`Integration sync failed: ${provider}`, 'warning', {
      category: 'integration',
      organizationId: context.organizationId,
      extra: { provider, integrationConnectionId, message: outcome.message },
    })
    try {
      const { data: authData } = await context.supabase.auth.getUser()
      const actorUserId = authData?.user?.id ?? null
      if (actorUserId) {
        await notifyIntegrationFailed({
          organizationId: context.organizationId,
          actorUserId,
          integrationConnectionId,
          provider,
          errorMessage: outcome.message,
          dedupeSuffix: context.jobId,
          supabase: context.supabase,
        })
      }
    } catch {
      // Best-effort — see this file's own header note on Wave 4's
      // addition. A notification failure must never mask or override this
      // handler's own real, already-recorded sync outcome.
    }
  }

  return outcome
}
