import { ResetPasswordForm } from '@/components/domain/auth/reset-password-form'
import { AuthNotConfigured } from '@/components/domain/auth/auth-not-configured'
import { supabaseConfigured } from '@/lib/env'

export const metadata = { title: 'Reset password' }

export default function ResetPasswordPage() {
  if (!supabaseConfigured) return <AuthNotConfigured />
  return <ResetPasswordForm />
}
