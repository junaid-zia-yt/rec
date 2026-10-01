import { StyleSheet, Text } from 'react-native'
import { ScreenContainer } from '@/components/ui/ScreenContainer'
import { colors, spacing, typeScale } from '@/theme/tokens'

/**
 * Mirrors apps/web's AuthNotConfigured component
 * (apps/web/components/domain/auth/auth-not-configured.tsx): shown instead
 * of the sign-in form when `supabaseConfigured` is false, rather than
 * crashing or silently rendering a broken form. Always true in this build
 * environment (no live Supabase project connected).
 */
export function NotConfiguredScreen() {
  return (
    <ScreenContainer style={styles.center}>
      <Text style={styles.title}>App not configured</Text>
      <Text style={styles.body}>
        This app is not yet connected to a Supabase project. Set EXPO_PUBLIC_SUPABASE_URL and
        EXPO_PUBLIC_SUPABASE_ANON_KEY to enable sign-in.
      </Text>
    </ScreenContainer>
  )
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm8,
  },
  title: {
    ...typeScale.headlineMd,
    color: colors.tertiary,
  },
  body: {
    ...typeScale.bodyMd,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: spacing.lg16,
  },
})
