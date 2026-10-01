/**
 * Reusable inbound-webhook processing logic (Build Phase 12 Wave 3). This
 * is deliberately a plain function, NOT a Next.js route handler — this
 * wave's judgment call is that the actual `app/api/webhooks/<provider>/
 * route.ts` file (parsing the raw request, reading provider-specific
 * headers, constructing the service-role Supabase client, and calling this
 * function) belongs to whichever later wave owns the UI/route surface,
 * since none of it is testable without a real HTTP request and it does
 * nothing this wave needs done to build correct adapters. This function is
 * the part that IS testable in isolation (a fake Supabase client is
 * enough), so it lives here, ready for that future route file to call.
 *
 * `supabase/migrations/0032_integrations_jobs_notifications.sql` gives
 * `webhook_events` NO client-writable RLS grant for `authenticated`/`anon`
 * at all (`revoke insert, update, delete on public.webhook_events from
 * authenticated, anon`) — the caller MUST pass a Supabase client
 * constructed with the SERVICE ROLE key (there is no `auth.uid()` for an
 * inbound webhook to satisfy any RLS policy against). This function does
 * not construct that client itself (it has no way to know it's being
 * called from a real route vs. a test) — the caller is responsible for
 * passing the right one, exactly as this file's own JSDoc states.
 *
 * DEDUP: this function does NOT try to out-guess the database's own
 * dedup guarantee by pre-checking for an existing row — it relies on
 * `webhook_events_provider_external_event_id_idx`'s UNIQUE constraint
 * (0032, `(provider, external_event_id)`, nulls excluded) to reject a
 * genuine duplicate insert, and catches that specific error (Postgres
 * `23505`, unique_violation) to report `duplicate_ignored`. This mirrors
 * the wave 1 note in this task's brief: "your code should rely on the DB
 * constraint catching a real duplicate, not try to out-guess it in
 * application logic first."
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { captureMonitoringMessage } from '@/lib/monitoring/capture'

export interface ProcessInboundWebhookInput {
  /** Free-text provider identifier as it will be stored (e.g. 'apollo', 'google_calendar', 'microsoft_calendar') — not constrained to `IntegrationProvider` here, since a webhook's provider string arrives from the URL/route, not a trusted enum lookup, until this function validates nothing more than "is this a non-empty string". */
  provider: string
  /** The exact raw request body bytes/text, BEFORE any JSON.parse — required so a caller's signature verification (which must run over the exact bytes received, not a re-serialized version) and this function's own parsing both see the same content. */
  rawBody: string
  signatureHeader: string | null
  /** Result of the caller's own provider-specific signature check (see `signature-verification.ts`) — this function does not pick a verification scheme itself, since that varies per provider (see that file's header note); it only records the boolean and gates on it. */
  signatureValid: boolean
  /** The provider's own event id, used for the `(provider, external_event_id)` dedup constraint — null when a provider's payload has no clear event id (dedup is then not possible for that event, which is a provider-shape limitation, not a bug here). */
  externalEventId: string | null
  organizationId: string | null
  relatedJobId: string | null
  /** MUST be a service-role client — see this file's header note. */
  supabase: SupabaseClient
}

export type ProcessInboundWebhookResult =
  | { status: 'rejected_invalid_signature' }
  | { status: 'duplicate_ignored' }
  | { status: 'received'; webhookEventId: string }
  | { status: 'error'; errorMessage: string }

const POSTGRES_UNIQUE_VIOLATION = '23505'

/**
 * Parses `rawBody` as JSON for storage in `webhook_events.raw_payload`
 * (`jsonb`), never throwing — an unparseable body is stored as an inert
 * wrapper object rather than failing the whole write, since recording that
 * SOMETHING arrived (even malformed) is more useful than losing it.
 * `raw_payload` is UNTRUSTED, provider/candidate-originated data (0032's
 * own column comment) — this function only ever treats it as inert JSON to
 * store, never as instructions to execute or fields to trust.
 */
function toJsonPayload(rawBody: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(rawBody)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return { value: parsed }
  } catch {
    return { _unparsed_raw_body: rawBody }
  }
}

export async function processInboundWebhook(
  input: ProcessInboundWebhookInput,
): Promise<ProcessInboundWebhookResult> {
  const processingStatus = input.signatureValid ? 'received' : 'rejected_invalid_signature'

  const { data, error } = await input.supabase
    .from('webhook_events')
    .insert({
      organization_id: input.organizationId,
      provider: input.provider,
      external_event_id: input.externalEventId,
      signature_valid: input.signatureValid,
      raw_payload: toJsonPayload(input.rawBody),
      processing_status: processingStatus,
      related_job_id: input.relatedJobId,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === POSTGRES_UNIQUE_VIOLATION) {
      return { status: 'duplicate_ignored' }
    }
    captureMonitoringMessage(`Inbound webhook processing failed: ${input.provider}`, 'error', {
      category: 'integration',
      organizationId: input.organizationId,
      extra: { provider: input.provider, dbErrorMessage: error.message },
    })
    return { status: 'error', errorMessage: error.message }
  }
  if (!data) {
    captureMonitoringMessage(`Inbound webhook insert returned no row: ${input.provider}`, 'error', {
      category: 'integration',
      organizationId: input.organizationId,
      extra: { provider: input.provider },
    })
    return { status: 'error', errorMessage: 'Insert reported no error but returned no row.' }
  }

  if (!input.signatureValid) {
    captureMonitoringMessage(
      `Inbound webhook rejected: invalid signature (${input.provider})`,
      'warning',
      {
        category: 'integration',
        organizationId: input.organizationId,
        extra: { provider: input.provider, webhookEventId: data.id as string },
      },
    )
    return { status: 'rejected_invalid_signature' }
  }
  return { status: 'received', webhookEventId: data.id as string }
}
