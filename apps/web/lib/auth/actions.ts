'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { supabaseConfigured, supabaseAdminConfigured, env } from '@/lib/env'
import { logAuditEvent } from '@/lib/audit/log'
import { captureMonitoringMessage } from '@/lib/monitoring/capture'
import { GENERIC_AUTH_ERROR_MESSAGE, GENERIC_RESET_REQUESTED_MESSAGE } from './errors'
import { requirePermission } from './session'
import { sanitizeRedirectPath } from './routing'

export interface ActionResult {
  success: boolean
  message?: string
  fieldErrors?: Record<string, string>
}

const SignInSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
  next: z.string().optional(),
})

/** Sign in with email/password. Always returns the same generic error message on any failure — wrong password, unknown email, or unconfirmed email are indistinguishable to the caller. */
export async function signInAction(formData: FormData): Promise<ActionResult> {
  const parsed = SignInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    next: formData.get('next') ?? undefined,
  })

  if (!parsed.success) {
    return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }
  }

  if (!supabaseConfigured) {
    return {
      success: false,
      message: 'Authentication is not configured yet for this environment.',
    }
  }

  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase!.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  })

  if (error || !data.user) {
    // No actor_id is available for a failed attempt against an unknown
    // email (there is no authenticated session to satisfy the audit_events
    // insert policy), so only a genuinely failed *authenticated* attempt
    // (right email, wrong password, on an existing session-adjacent flow)
    // would ever reach an audit row in practice — logged best-effort only.
    //
    // Build Phase 15 Wave 3 addition: this IS observable regardless of
    // whether an audit row can be written, via a low-severity monitoring
    // event — the email itself is never included (it is user-supplied,
    // unverified input at this point, not an established identity), so no
    // PII is sent. This is observability only, NOT brute-force/rate-limit
    // detection — docs/security-review.md (Phase 14) already tracks the
    // absence of failed-login rate limiting as a separate, still-open gap.
    captureMonitoringMessage('Sign-in failed', 'info', { category: 'auth' })
    return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }
  }

  await logAuditEvent(
    {
      organizationId: null,
      actorId: data.user.id,
      action: 'auth.sign_in',
      entityType: 'user_profiles',
      entityId: data.user.id,
    },
    supabase,
  )

  redirect(sanitizeRedirectPath(parsed.data.next))
}

/** Signs the current session out. Idempotent — calling it with no active session succeeds silently rather than erroring, since "already signed out" is not a failure. */
export async function signOutAction(): Promise<void> {
  if (!supabaseConfigured) {
    redirect('/sign-in')
  }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()

  const { error } = await supabase!.auth.signOut()

  if (!error && user) {
    await logAuditEvent(
      {
        organizationId: null,
        actorId: user.id,
        action: 'auth.sign_out',
        entityType: 'user_profiles',
        entityId: user.id,
      },
      supabase,
    )
  }

  redirect('/sign-in')
}

const RequestResetSchema = z.object({ email: z.string().trim().email() })

/** Requests a password-reset email. Always returns the same message whether or not the email is registered — this is the one place "does an account exist" is most tempting to leak, so it is the one place tested most explicitly. */
export async function requestPasswordResetAction(formData: FormData): Promise<ActionResult> {
  const parsed = RequestResetSchema.safeParse({ email: formData.get('email') })
  if (!parsed.success) {
    // Even a malformed email returns the generic "sent if it exists"
    // message rather than a validation error, for the same reason.
    return { success: true, message: GENERIC_RESET_REQUESTED_MESSAGE }
  }

  if (!supabaseConfigured) {
    return {
      success: false,
      message: 'Authentication is not configured yet for this environment.',
    }
  }

  const supabase = await createServerSupabaseClient()
  await supabase!.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${env.NEXT_PUBLIC_APP_URL}/reset-password`,
  })
  // Deliberately not branching on the result: Supabase itself does not
  // reveal whether the email existed, and neither does this action.

  return { success: true, message: GENERIC_RESET_REQUESTED_MESSAGE }
}

const UpdatePasswordSchema = z
  .object({
    password: z.string().min(12, 'Password must be at least 12 characters.'),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  })

/** Updates the password for the currently-recovering session (reached via the emailed reset link, which Supabase exchanges for a temporary "recovery" session before this runs). */
export async function updatePasswordAction(formData: FormData): Promise<ActionResult> {
  const parsed = UpdatePasswordSchema.safeParse({
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  })

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      fieldErrors[String(issue.path[0])] = issue.message
    }
    return { success: false, fieldErrors }
  }

  if (!supabaseConfigured) {
    return {
      success: false,
      message: 'Authentication is not configured yet for this environment.',
    }
  }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()

  if (!user) {
    return { success: false, message: 'Your password reset link has expired. Request a new one.' }
  }

  const { error } = await supabase!.auth.updateUser({ password: parsed.data.password })
  if (error) {
    return { success: false, message: 'Could not update your password. Try again.' }
  }

  await logAuditEvent(
    {
      organizationId: null,
      actorId: user.id,
      action: 'auth.password_updated',
      entityType: 'user_profiles',
      entityId: user.id,
    },
    supabase,
  )

  redirect('/dashboard')
}

const CreateInvitationSchema = z.object({
  organizationId: z.string().uuid(),
  email: z.string().trim().email(),
  role: z.enum(['agency_admin', 'recruiter', 'client_decision_maker', 'read_only_reviewer']),
})

/** Creates a pending invitation. Restricted to agency_admin (or platform_admin) in the target org — enforced through the same centralized `requirePermission` helper every other write uses, never a role check inlined here. */
export async function createInvitationAction(formData: FormData): Promise<ActionResult> {
  const parsed = CreateInvitationSchema.safeParse({
    organizationId: formData.get('organizationId'),
    email: formData.get('email'),
    role: formData.get('role'),
  })
  if (!parsed.success) {
    return { success: false, message: 'Check the invitation details and try again.' }
  }
  if (!supabaseConfigured) {
    return { success: false, message: 'Authentication is not configured yet for this environment.' }
  }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  const membership = await requirePermission(user.id, parsed.data.organizationId, 'users', 'create')

  const { data: invitation, error } = await supabase!
    .from('invitations')
    .insert({
      organization_id: parsed.data.organizationId,
      email: parsed.data.email,
      role: parsed.data.role,
      invited_by: user.id,
    })
    .select('id')
    .single()

  if (error || !invitation) {
    return { success: false, message: 'Could not create the invitation. It may already exist.' }
  }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'invitation.created',
      entityType: 'invitations',
      entityId: invitation.id,
      after: { email: parsed.data.email, role: parsed.data.role },
    },
    supabase,
  )

  // Email delivery (Resend) is not configured in this environment — see
  // docs/build-phase-2-report.md. The invitation row and its link exist
  // regardless; without Resend, sharing the link is a manual step.
  void membership

  return { success: true, message: 'Invitation created.' }
}

const AcceptInvitationSchema = z.object({
  token: z.string().uuid(),
  fullName: z.string().trim().min(1),
  password: z.string().min(12, 'Password must be at least 12 characters.'),
})

/**
 * Accepts an invitation: creates the auth user, an active membership, and
 * marks the invitation accepted. Uses the service-role admin client because
 * the invitee has no session yet at this point — Supabase RLS has no
 * concept of "prove you hold this bearer token" on its own, so that check
 * (token validity, not expired, still pending) is performed explicitly in
 * this function before any write, and only this function is trusted with
 * the admin client for it.
 */
export async function acceptInvitationAction(formData: FormData): Promise<ActionResult> {
  const parsed = AcceptInvitationSchema.safeParse({
    token: formData.get('token'),
    fullName: formData.get('fullName'),
    password: formData.get('password'),
  })
  if (!parsed.success) {
    return { success: false, message: 'Check the form and try again.' }
  }
  if (!supabaseAdminConfigured) {
    return { success: false, message: 'Authentication is not configured yet for this environment.' }
  }

  const admin = createAdminClient()

  const { data: invitation, error: lookupError } = await admin
    .from('invitations')
    .select('id, organization_id, email, role, status, expires_at')
    .eq('token', parsed.data.token)
    .maybeSingle()

  if (lookupError || !invitation || invitation.status !== 'pending') {
    return { success: false, message: 'This invitation link is invalid or has already been used.' }
  }
  if (new Date(invitation.expires_at) < new Date()) {
    return {
      success: false,
      message: 'This invitation link has expired. Ask your admin to resend it.',
    }
  }

  const { data: created, error: userError } = await admin.auth.admin.createUser({
    email: invitation.email,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: { full_name: parsed.data.fullName },
  })
  if (userError || !created.user) {
    return { success: false, message: 'Could not create your account. Contact your admin.' }
  }

  const { error: membershipError } = await admin.from('organization_memberships').insert({
    organization_id: invitation.organization_id,
    user_id: created.user.id,
    role: invitation.role,
    status: 'active',
    is_default: true,
  })
  if (membershipError) {
    return {
      success: false,
      message: 'Could not finish setting up your account. Contact your admin.',
    }
  }

  await admin
    .from('invitations')
    .update({
      status: 'accepted',
      accepted_at: new Date().toISOString(),
      accepted_by: created.user.id,
    })
    .eq('id', invitation.id)

  await logAuditEvent(
    {
      organizationId: invitation.organization_id,
      actorId: created.user.id,
      action: 'invitation.accepted',
      entityType: 'invitations',
      entityId: invitation.id,
    },
    admin,
  )

  redirect('/sign-in?reason=invitation_accepted')
}

const ChangeMembershipRoleSchema = z.object({
  organizationId: z.string().uuid(),
  membershipId: z.string().uuid(),
  newRole: z.enum(['agency_admin', 'recruiter', 'client_decision_maker', 'read_only_reviewer']),
})

/** Changes a member's role within an org. agency_admin/platform_admin only, via requirePermission — never a bespoke role check. */
export async function changeMembershipRoleAction(formData: FormData): Promise<ActionResult> {
  const parsed = ChangeMembershipRoleSchema.safeParse({
    organizationId: formData.get('organizationId'),
    membershipId: formData.get('membershipId'),
    newRole: formData.get('newRole'),
  })
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured) {
    return { success: false, message: 'Authentication is not configured yet for this environment.' }
  }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'users', 'update')

  const { data: before } = await supabase!
    .from('organization_memberships')
    .select('role')
    .eq('id', parsed.data.membershipId)
    .single()

  const { error } = await supabase!
    .from('organization_memberships')
    .update({ role: parsed.data.newRole })
    .eq('id', parsed.data.membershipId)
    .eq('organization_id', parsed.data.organizationId)

  if (error) return { success: false, message: 'Could not update the role.' }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'membership.role_changed',
      entityType: 'organization_memberships',
      entityId: parsed.data.membershipId,
      before: before ? { role: before.role } : null,
      after: { role: parsed.data.newRole },
    },
    supabase,
  )

  return { success: true, message: 'Role updated.' }
}

const DisableMembershipSchema = z.object({
  organizationId: z.string().uuid(),
  membershipId: z.string().uuid(),
})

/** Revokes a member's access to an org (soft — sets status, never deletes the row, preserving audit/history integrity per docs/07-data-model.md §7.6). agency_admin/platform_admin only. */
export async function disableMembershipAction(formData: FormData): Promise<ActionResult> {
  const parsed = DisableMembershipSchema.safeParse({
    organizationId: formData.get('organizationId'),
    membershipId: formData.get('membershipId'),
  })
  if (!parsed.success) return { success: false, message: 'Check the form and try again.' }
  if (!supabaseConfigured) {
    return { success: false, message: 'Authentication is not configured yet for this environment.' }
  }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase!.auth.getUser()
  if (!user) return { success: false, message: GENERIC_AUTH_ERROR_MESSAGE }

  await requirePermission(user.id, parsed.data.organizationId, 'users', 'delete')

  const { error } = await supabase!
    .from('organization_memberships')
    .update({ status: 'revoked' })
    .eq('id', parsed.data.membershipId)
    .eq('organization_id', parsed.data.organizationId)

  if (error) return { success: false, message: 'Could not disable this member.' }

  await logAuditEvent(
    {
      organizationId: parsed.data.organizationId,
      actorId: user.id,
      action: 'membership.disabled',
      entityType: 'organization_memberships',
      entityId: parsed.data.membershipId,
    },
    supabase,
  )

  return { success: true, message: 'Member access disabled.' }
}
