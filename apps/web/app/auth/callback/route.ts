import { NextResponse, type NextRequest } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { supabaseConfigured } from '@/lib/env'
import { sanitizeRedirectPath } from '@/lib/auth/routing'

/**
 * Email verification / magic-link / password-recovery callback. Supabase
 * Auth sends the user here with a `code` query param; exchanging it for a
 * session is what actually completes sign-up confirmation, a magic-link
 * sign-in, or a password-reset link (the reset-password page then runs
 * against the session this establishes).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get('code')
  const next = sanitizeRedirectPath(searchParams.get('next'))

  if (!supabaseConfigured || !code) {
    return NextResponse.redirect(`${origin}/sign-in`)
  }

  const supabase = await createServerSupabaseClient()
  const { error } = await supabase!.auth.exchangeCodeForSession(code)

  if (error) {
    return NextResponse.redirect(`${origin}/sign-in?reason=link_expired`)
  }

  return NextResponse.redirect(`${origin}${next}`)
}
