import { SignInForm } from '@/components/domain/auth/sign-in-form'
import { AuthNotConfigured } from '@/components/domain/auth/auth-not-configured'
import { sanitizeRedirectPath } from '@/lib/auth/routing'
import { supabaseConfigured } from '@/lib/env'

export const metadata = { title: 'Sign in' }

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string }>
}) {
  const { next, reason } = await searchParams

  if (!supabaseConfigured) return <AuthNotConfigured />

  return (
    <div className="flex flex-col gap-3">
      {reason === 'invitation_accepted' && (
        <p className="rounded-card bg-primary-container text-primary px-3 py-2 text-sm font-medium">
          Your account is ready. Sign in to continue.
        </p>
      )}
      <SignInForm next={next ? sanitizeRedirectPath(next) : undefined} />
    </div>
  )
}
