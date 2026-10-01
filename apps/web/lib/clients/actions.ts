'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { supabaseConfigured } from '@/lib/env'
import { logAuditEvent } from '@/lib/audit/log'
import { GENERIC_AUTH_ERROR_MESSAGE } from '@/lib/auth/errors'
import { requirePermission } from '@/lib/auth/session'
import type { ActionResult } from '@/lib/auth/actions'

/**
 * Client management server actions (Build Phase 3 brief §"Client
 * management"). Every write goes through requirePermission — never a
 * bespoke role check — and every write pairs its business change with an
 * audit_events row, per docs/07-data-model.md §7.7.
 */

const CreateClientSchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().trim().min(1, 'Client name is required.').max(200),
  vertical: z.string().trim().max(100).optional().default(''),
  primaryContactName: z.string().trim().max(200).optional(),
  primaryContactEmail: z.string().trim().email().optional().or(z.literal('')),
  primaryContactPhone: z.string().trim().max(50).optional(),
})

export async function createClientAction(formData: FormData): Promise<ActionResult> {
  const parsed = CreateClientSchema.safeParse({
    organizationId: formData.get('organizationId'),
    name: formData.get('name'),
    vertical: formData.get('vertical') ?? undefined,
    primaryContactName: formData.get('primaryContactName') ?? undefined,
    primaryContactEmail: formData.get('primaryContactEmail') ?? undefined,
    primaryContactPhone: formData.get('primaryContactPhone') ?? undefined,
  })
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? 'Check the form and try again.',
    }
  }
  if (!supabaseConfigured) {
    return { success: false, message: 'This environment is not connected to a live database yet.' }
  }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'clients', 'create')

  const { data: client, error } = await supabase!
    .from('clients')
    .insert({
      organization_id: parsed.data.organizationId,
      name: parsed.data.name,
      vertical: parsed.data.vertical || '',
      primary_contact_name: parsed.data.primaryContactName || null,
      primary_contact_email: parsed.data.primaryContactEmail || null,
      primary_contact_phone: parsed.data.primaryContactPhone || null,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error || !client) {
    return { success: false, message: 'Could not create the client.' }
  }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'client.created',
      entityType: 'clients',
      entityId: client.id,
      after: { name: parsed.data.name },
    },
    supabase,
  )

  revalidatePath('/clients')
  return { success: true, message: 'Client created.' }
}

const UpdateClientSchema = z.object({
  organizationId: z.string().uuid(),
  clientId: z.string().uuid(),
  name: z.string().trim().min(1, 'Client name is required.').max(200),
  vertical: z.string().trim().max(100).optional().default(''),
  primaryContactName: z.string().trim().max(200).optional(),
  primaryContactEmail: z.string().trim().email().optional().or(z.literal('')),
  primaryContactPhone: z.string().trim().max(50).optional(),
})

export async function updateClientAction(formData: FormData): Promise<ActionResult> {
  const parsed = UpdateClientSchema.safeParse({
    organizationId: formData.get('organizationId'),
    clientId: formData.get('clientId'),
    name: formData.get('name'),
    vertical: formData.get('vertical') ?? undefined,
    primaryContactName: formData.get('primaryContactName') ?? undefined,
    primaryContactEmail: formData.get('primaryContactEmail') ?? undefined,
    primaryContactPhone: formData.get('primaryContactPhone') ?? undefined,
  })
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? 'Check the form and try again.',
    }
  }
  if (!supabaseConfigured) {
    return { success: false, message: 'This environment is not connected to a live database yet.' }
  }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'clients', 'update')

  const { data: before } = await supabase!
    .from('clients')
    .select('name, vertical, primary_contact_name, primary_contact_email, primary_contact_phone')
    .eq('id', parsed.data.clientId)
    .eq('organization_id', parsed.data.organizationId)
    .single()

  const { error } = await supabase!
    .from('clients')
    .update({
      name: parsed.data.name,
      vertical: parsed.data.vertical || '',
      primary_contact_name: parsed.data.primaryContactName || null,
      primary_contact_email: parsed.data.primaryContactEmail || null,
      primary_contact_phone: parsed.data.primaryContactPhone || null,
    })
    .eq('id', parsed.data.clientId)
    .eq('organization_id', parsed.data.organizationId)

  if (error) return { success: false, message: 'Could not update the client.' }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'client.updated',
      entityType: 'clients',
      entityId: parsed.data.clientId,
      before,
      after: { name: parsed.data.name },
    },
    supabase,
  )

  revalidatePath('/clients')
  revalidatePath(`/clients/${parsed.data.clientId}`)
  return { success: true, message: 'Client updated.' }
}

const ArchiveClientSchema = z.object({
  organizationId: z.string().uuid(),
  clientId: z.string().uuid(),
})

/** Archives (soft) a client — never deletes, per docs/07-data-model.md §7.6. A client with open (non-closed) projects cannot be archived, so archiving a client never silently orphans active work. */
export async function archiveClientAction(formData: FormData): Promise<ActionResult> {
  const parsed = ArchiveClientSchema.safeParse({
    organizationId: formData.get('organizationId'),
    clientId: formData.get('clientId'),
  })
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured) {
    return { success: false, message: 'This environment is not connected to a live database yet.' }
  }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'clients', 'delete')

  const { count } = await supabase!
    .from('recruitment_projects')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', parsed.data.clientId)
    .is('archived_at', null)
    .not('status', 'eq', 'closed')

  if (count && count > 0) {
    return {
      success: false,
      message: 'This client has open recruitment projects. Close or archive those first.',
    }
  }

  const { error } = await supabase!
    .from('clients')
    .update({ status: 'inactive', archived_at: new Date().toISOString() })
    .eq('id', parsed.data.clientId)
    .eq('organization_id', parsed.data.organizationId)

  if (error) return { success: false, message: 'Could not archive the client.' }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'client.archived',
      entityType: 'clients',
      entityId: parsed.data.clientId,
    },
    supabase,
  )

  revalidatePath('/clients')
  return { success: true, message: 'Client archived.' }
}

const AssignClientReviewerSchema = z.object({
  organizationId: z.string().uuid(),
  membershipId: z.string().uuid(),
  clientId: z.string().uuid(),
})

/** Links a client_decision_maker membership to the one client they represent (docs/06-roles-permissions.md §6.3 — this is what makes their access narrow rather than org-wide). agency_admin only, via the `users` resource (this mutates a membership row, not a client). */
export async function assignClientReviewerAction(formData: FormData): Promise<ActionResult> {
  const parsed = AssignClientReviewerSchema.safeParse({
    organizationId: formData.get('organizationId'),
    membershipId: formData.get('membershipId'),
    clientId: formData.get('clientId'),
  })
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured) {
    return { success: false, message: 'This environment is not connected to a live database yet.' }
  }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'users', 'update')

  const { data: membershipRow, error: lookupError } = await supabase!
    .from('organization_memberships')
    .select('role')
    .eq('id', parsed.data.membershipId)
    .eq('organization_id', parsed.data.organizationId)
    .single()

  if (lookupError || !membershipRow || membershipRow.role !== 'client_decision_maker') {
    return {
      success: false,
      message: 'Only a Client Decision-Maker membership can be linked to a client.',
    }
  }

  const { error } = await supabase!
    .from('organization_memberships')
    .update({ client_id: parsed.data.clientId })
    .eq('id', parsed.data.membershipId)
    .eq('organization_id', parsed.data.organizationId)

  if (error) return { success: false, message: 'Could not link this reviewer to the client.' }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'membership.role_changed',
      entityType: 'organization_memberships',
      entityId: parsed.data.membershipId,
      after: { clientId: parsed.data.clientId },
    },
    supabase,
  )

  revalidatePath('/clients')
  return { success: true, message: 'Reviewer linked to client.' }
}
