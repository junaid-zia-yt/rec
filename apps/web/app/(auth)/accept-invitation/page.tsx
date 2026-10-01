import { AcceptInvitationForm } from '@/components/domain/auth/accept-invitation-form'
import { AuthNotConfigured } from '@/components/domain/auth/auth-not-configured'
import { Alert } from '@rqi/ui'
import { supabaseAdminConfigured } from '@/lib/env'

export const metadata = { title: 'Accept invitation' }

export default async function AcceptInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  if (!supabaseAdminConfigured) return <AuthNotConfigured />

  const { token } = await searchParams
  if (!token) {
    return (
      <Alert tone="danger" title="Missing invitation link">
        This link is missing its invitation token. Use the link from your invitation email.
      </Alert>
    )
  }

  return <AcceptInvitationForm token={token} />
}
