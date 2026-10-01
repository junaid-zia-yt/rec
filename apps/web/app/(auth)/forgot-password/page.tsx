import { ForgotPasswordForm } from '@/components/domain/auth/forgot-password-form'
import { AuthNotConfigured } from '@/components/domain/auth/auth-not-configured'
import { supabaseConfigured } from '@/lib/env'

export const metadata = { title: 'Forgot password' }

export default function ForgotPasswordPage() {
  if (!supabaseConfigured) return <AuthNotConfigured />
  return <ForgotPasswordForm />
}
