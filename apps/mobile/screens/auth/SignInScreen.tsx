import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Button, Card, FormField, Input, ScreenContainer } from '@/components/ui'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth/AuthProvider'
import { colors, spacing, typeScale } from '@/theme/tokens'

/**
 * Mirrors the web app's sign-in method exactly (apps/web/components/domain/
 * auth/sign-in-form.tsx → apps/web/lib/auth/actions.ts's `signInAction`):
 * email + password via Supabase Auth's `signInWithPassword`. Web calls this
 * through a Next.js server action (so it can set an httpOnly cookie
 * session); mobile calls `supabase.auth.signInWithPassword` directly on the
 * client, since mobile's session lives in SecureStore, not a cookie — same
 * credentials, same underlying Supabase Auth call, different session
 * transport, so a user's password works identically on both apps.
 *
 * This screen is only ever reached when `supabaseConfigured` is true (the
 * root navigator renders NotConfiguredScreen otherwise), so `getSupabase
 * Client()` is guaranteed non-null here — the `!supabase` branch is
 * defensive, not a real path in this build environment.
 */
export function SignInScreen() {
  const { sessionExpired, clearSessionExpired } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    setError(null)
    clearSessionExpired()
    const supabase = getSupabaseClient()
    if (!supabase) {
      setError('Sign-in is not available: app is not configured.')
      return
    }

    setPending(true)
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    setPending(false)

    if (signInError) {
      setError(signInError.message || 'Something went wrong. Try again.')
    }
    // On success, AuthProvider's onAuthStateChange listener updates
    // `session` and the root navigator swaps to the Main tab navigator —
    // no explicit navigation call needed here.
  }

  return (
    <ScreenContainer style={styles.center}>
      <Card style={styles.card}>
        <View style={styles.header}>
          <Text style={styles.title}>Sign in</Text>
          <Text style={styles.subtitle}>Sign in to your recruitment workspace.</Text>
        </View>

        {sessionExpired && !error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            Your session expired, please sign in again.
          </Text>
        ) : null}

        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}

        <FormField label="Email">
          <Input
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            invalid={Boolean(error)}
          />
        </FormField>

        <FormField label="Password">
          <Input
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
            invalid={Boolean(error)}
          />
        </FormField>

        <Button onPress={handleSubmit} loading={pending} disabled={!email || !password}>
          Sign in
        </Button>
      </Card>
    </ScreenContainer>
  )
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
  },
  card: {
    gap: spacing.lg16,
  },
  header: {
    gap: spacing.xs4,
  },
  title: {
    ...typeScale.headlineMd,
    color: colors.tertiary,
  },
  subtitle: {
    ...typeScale.bodySm,
    color: colors.textMuted,
  },
  error: {
    ...typeScale.bodySm,
    color: colors.errorText,
    backgroundColor: colors.errorBg,
    borderRadius: 6,
    paddingHorizontal: spacing.md12,
    paddingVertical: spacing.sm8,
  },
})
