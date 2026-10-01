import { StyleSheet, Text } from 'react-native'
import { ScreenContainer } from '@/components/ui/ScreenContainer'
import { colors, spacing, typeScale } from '@/theme/tokens'

/**
 * Shared "coming soon" placeholder body for every stub screen. Each
 * per-screen file (screens/stubs/*) is still its own component/file (so
 * later waves replace one file at a time without touching navigation
 * wiring), but they all render through this so the placeholder look is
 * consistent and centrally themed.
 */
export function StubScreen({ name, note }: { name: string; note?: string }) {
  return (
    <ScreenContainer style={styles.center}>
      <Text style={styles.title}>{name}</Text>
      <Text style={styles.subtitle}>Coming soon</Text>
      {note ? <Text style={styles.note}>{note}</Text> : null}
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
    textAlign: 'center',
  },
  subtitle: {
    ...typeScale.bodyMd,
    color: colors.textMuted,
  },
  note: {
    ...typeScale.bodySm,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm8,
    paddingHorizontal: spacing.lg16,
  },
})
