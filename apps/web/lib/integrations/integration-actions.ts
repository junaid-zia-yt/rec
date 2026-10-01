'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import {
  supabaseConfigured,
  apolloConfigured,
  googleCalendarConfigured,
  microsoftCalendarConfigured,
} from '@/lib/env'
import { logAuditEvent } from '@/lib/audit/log'
import { GENERIC_AUTH_ERROR_MESSAGE, InsufficientRoleError } from '@/lib/auth/errors'
import { requireOrgMembership } from '@/lib/auth/session'
import { enqueueJob } from '@/lib/jobs/enqueue'
import type { ActionResult } from '@/lib/auth/actions'
import type { IntegrationProvider } from '@rqi/types'

/**
 * Build Phase 12, Wave 5 (Task B) — `integration_connections` write
 * actions.
 *
 * PERMISSION GATE — direct `agency_admin`-only role check, never
 * `requirePermission(..., 'integrations', ...)`: mirrors
 * `lib/jobs/manual-retry.ts`'s own documented precedent for this exact
 * situation. 0032's RLS (`integration_connections_write_agency_admin`)
 * grants write ONLY to `agency_admin` — the application matrix's
 * `integrations: { platform_admin: 'full', agency_admin: 'full',
 * recruiter: 'read', ... }` is wider than that at the `platform_admin`
 * row (also see `lib/integrations/load.ts`'s header note on the READ
 * side of this same discrepancy). Trusting `requirePermission` here would
 * let a `platform_admin` pass the application check and then fail at the
 * database with an opaque RLS rejection — this file checks the real,
 * narrower gate directly instead, exactly like `manuallyRetryJob`.
 */

const WRITE_ALLOWED_ROLES = ['agency_admin'] as const

async function requireAgencyAdmin(userId: string, organizationId: string) {
  const membership = await requireOrgMembership(userId, organizationId)
  if (!WRITE_ALLOWED_ROLES.includes(membership.role as (typeof WRITE_ALLOWED_ROLES)[number])) {
    throw new InsufficientRoleError()
  }
  return membership
}

const TaTrackerMode = z.enum(['api', 'csv_import_export', 'secure_manual_exchange'])

const ConnectIntegrationSchema = z.object({
  organizationId: z.string().uuid(),
  provider: z.enum(['ta_tracker', 'apollo', 'google_calendar', 'microsoft_calendar', 'sms']),
  mode: TaTrackerMode.optional(),
  accountOwnerLabel: z.string().trim().max(200).optional(),
})

/**
 * Connects (or reconnects) one provider for the org. TA Tracker's `mode =
 * 'api'` is refused here with a clean, honest error BEFORE any DB write —
 * never left to surface as the 0032 CHECK constraint's opaque insert
 * failure — per "Do not invent a TA Tracker API" / docs/11-integration-
 * plan.md §11.2 (no API, no documentation, no credentials exist for TA
 * Tracker in this environment, permanently). CSV import/export and secure
 * manual exchange modes need no vendor-specific knowledge and can
 * genuinely connect. Apollo/Google Calendar/Microsoft Calendar only
 * connect when their real credentials are actually configured
 * (`lib/env.ts`'s `*Configured` flags) — never a fabricated "connected"
 * row, per the project's "never claim an integration works until it has
 * been configured and tested" rule. SMS has no provider chosen at all
 * (docs/18-blocking-questions.md Q-P1-03) and can never connect.
 */
export async function connectIntegrationAction(formData: FormData): Promise<ActionResult> {
  const parsed = ConnectIntegrationSchema.safeParse({
    organizationId: formData.get('organizationId'),
    provider: formData.get('provider'),
    mode: formData.get('mode') || undefined,
    accountOwnerLabel: formData.get('accountOwnerLabel') || undefined,
  })
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requireAgencyAdmin(user.id, parsed.data.organizationId)

  const { provider } = parsed.data

  if (provider === 'ta_tracker') {
    if (!parsed.data.mode) {
      return { success: false, message: 'Choose a TA Tracker connection mode.' }
    }
    if (parsed.data.mode === 'api') {
      // Honesty gate — refused before it ever reaches the DB CHECK.
      return {
        success: false,
        message:
          'TA Tracker has no available API in this environment — no vendor documentation or credentials exist. Connect using CSV import/export or secure manual exchange instead.',
      }
    }
  } else if (parsed.data.mode) {
    return { success: false, message: `${provider} does not have connection modes.` }
  } else if (provider === 'apollo' && !apolloConfigured) {
    return {
      success: false,
      message: 'Apollo is not configured in this environment — no credentials are set.',
    }
  } else if (provider === 'google_calendar' && !googleCalendarConfigured) {
    return {
      success: false,
      message: 'Google Calendar is not configured in this environment — no credentials are set.',
    }
  } else if (provider === 'microsoft_calendar' && !microsoftCalendarConfigured) {
    return {
      success: false,
      message: 'Microsoft Calendar is not configured in this environment — no credentials are set.',
    }
  } else if (provider === 'sms') {
    return {
      success: false,
      message:
        'No SMS provider has been chosen for this platform yet — see docs/18-blocking-questions.md Q-P1-03.',
    }
  }

  const nowIso = new Date().toISOString()
  const { data: existing } = await supabase!
    .from('integration_connections')
    .select('id')
    .eq('organization_id', parsed.data.organizationId)
    .eq('provider', provider)
    .maybeSingle()

  const row = {
    organization_id: parsed.data.organizationId,
    provider,
    mode: provider === 'ta_tracker' ? parsed.data.mode : null,
    status: 'connected' as const,
    account_owner_label: parsed.data.accountOwnerLabel ?? null,
    connected_by: user.id,
    connected_at: nowIso,
    disconnected_at: null,
    disconnected_by: null,
  }

  const writeResult = existing
    ? await supabase!
        .from('integration_connections')
        .update(row)
        .eq('id', existing.id)
        .select('id')
        .single()
    : await supabase!.from('integration_connections').insert(row).select('id').single()

  if (writeResult.error || !writeResult.data) {
    return { success: false, message: 'Could not connect this integration.' }
  }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'integration.connected',
      entityType: 'integration_connections',
      entityId: writeResult.data.id as string,
      after: { provider, mode: row.mode },
    },
    supabase,
  )

  revalidatePath('/integrations')
  return { success: true, message: `${provider} connected.` }
}

const DisconnectIntegrationSchema = z.object({
  organizationId: z.string().uuid(),
  provider: z.enum(['ta_tracker', 'apollo', 'google_calendar', 'microsoft_calendar', 'sms']),
  /** The UI's confirmation dialog result — this action only writes when it is explicitly `true`, never inferred. */
  confirmed: z.coerce.boolean(),
  reason: z.string().trim().max(1000).optional(),
})

/** Disconnects a provider. Requires an explicit `confirmed=true` (the UI's confirmation-dialog affordance is a separate, deliberate concern from this action's own guard against an accidental/unconfirmed submit) and logs the caller's stated reason, if any. */
export async function disconnectIntegrationAction(formData: FormData): Promise<ActionResult> {
  const parsed = DisconnectIntegrationSchema.safeParse({
    organizationId: formData.get('organizationId'),
    provider: formData.get('provider'),
    confirmed: formData.get('confirmed') ?? 'false',
    reason: formData.get('reason') || undefined,
  })
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!parsed.data.confirmed)
    return { success: false, message: 'Confirm disconnecting this integration before continuing.' }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requireAgencyAdmin(user.id, parsed.data.organizationId)

  const { data: connection, error } = await supabase!
    .from('integration_connections')
    .update({
      status: 'disconnected',
      disconnected_by: user.id,
      disconnected_at: new Date().toISOString(),
    })
    .eq('organization_id', parsed.data.organizationId)
    .eq('provider', parsed.data.provider)
    .select('id')
    .maybeSingle()

  if (error) return { success: false, message: 'Could not disconnect this integration.' }
  if (!connection) return { success: false, message: 'This integration is not connected.' }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'integration.disconnected',
      entityType: 'integration_connections',
      entityId: connection.id as string,
      metadata: { reason: parsed.data.reason ?? null },
    },
    supabase,
  )

  revalidatePath('/integrations')
  return { success: true, message: `${parsed.data.provider} disconnected.` }
}

const TriggerSyncSchema = z.object({
  organizationId: z.string().uuid(),
  provider: z.enum(['ta_tracker', 'apollo', 'google_calendar', 'microsoft_calendar', 'sms']),
})

/** Enqueues an `integration_sync` job for the org's connection row of this provider (Wave 2's `enqueueJob` — never a direct sync attempt from inside this action). Requires the connection to already exist. */
export async function triggerIntegrationSyncAction(formData: FormData): Promise<ActionResult> {
  const parsed = TriggerSyncSchema.safeParse({
    organizationId: formData.get('organizationId'),
    provider: formData.get('provider'),
  })
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requireAgencyAdmin(user.id, parsed.data.organizationId)

  const { data: connection } = await supabase!
    .from('integration_connections')
    .select('id')
    .eq('organization_id', parsed.data.organizationId)
    .eq('provider', parsed.data.provider)
    .maybeSingle()

  if (!connection) return { success: false, message: 'Connect this integration before syncing it.' }

  try {
    await enqueueJob({
      organizationId: parsed.data.organizationId,
      jobType: 'integration_sync',
      payload: {
        integrationConnectionId: connection.id,
        provider: parsed.data.provider as IntegrationProvider,
      },
      // Idempotent per (connection, minute) would be over-engineering for a
      // manual "sync now" button — a real natural key here is simply "one
      // in-flight sync per connection at a time", left to the job engine's
      // own claim semantics rather than a synthetic idempotency key that
      // would block a deliberate second manual sync attempt.
      supabase: supabase!,
      userId: user.id,
    })
  } catch (enqueueError) {
    return {
      success: false,
      message: enqueueError instanceof Error ? enqueueError.message : 'Could not queue this sync.',
    }
  }

  revalidatePath('/integrations')
  return { success: true, message: `${parsed.data.provider} sync queued.` }
}

const RecordAccountOwnerSchema = z.object({
  organizationId: z.string().uuid(),
  provider: z.enum(['ta_tracker', 'apollo', 'google_calendar', 'microsoft_calendar', 'sms']),
  accountOwnerLabel: z.string().trim().max(200).optional(),
})

/** Sets (or clears, if left blank) `account_owner_label` — see 0032's own header note: this is an unresolved [CLIENT CONFIRM] business question (docs/18-blocking-questions.md Q-P1-01), so this action never defaults or guesses a value; it only records what a human explicitly typed. */
export async function recordAccountOwnerAction(formData: FormData): Promise<ActionResult> {
  const parsed = RecordAccountOwnerSchema.safeParse({
    organizationId: formData.get('organizationId'),
    provider: formData.get('provider'),
    accountOwnerLabel: formData.get('accountOwnerLabel') || undefined,
  })
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured)
    return { success: false, message: 'This environment is not connected to a live database yet.' }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requireAgencyAdmin(user.id, parsed.data.organizationId)

  const { data: connection, error } = await supabase!
    .from('integration_connections')
    .update({ account_owner_label: parsed.data.accountOwnerLabel ?? null })
    .eq('organization_id', parsed.data.organizationId)
    .eq('provider', parsed.data.provider)
    .select('id')
    .maybeSingle()

  if (error) return { success: false, message: 'Could not update the account owner.' }
  if (!connection)
    return {
      success: false,
      message: 'Connect this integration before recording its account owner.',
    }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'integration.connected',
      entityType: 'integration_connections',
      entityId: connection.id as string,
      after: { accountOwnerLabel: parsed.data.accountOwnerLabel ?? null },
      metadata: { field: 'account_owner_label' },
    },
    supabase,
  )

  revalidatePath('/integrations')
  return { success: true, message: 'Account owner updated.' }
}
