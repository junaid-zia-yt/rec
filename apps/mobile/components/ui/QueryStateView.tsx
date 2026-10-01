import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { Button } from './Button'
import { colors, spacing, typeScale } from '@/theme/tokens'

/**
 * Centered loading/error/empty body, shared by every screen driven by
 * `useSupabaseQuery` so the four states (per Build Phase 13 Wave 3 brief's
 * "loading, empty, error, and permission-denied states for every screen")
 * look and behave the same everywhere instead of being reinvented per
 * screen. A screen renders this in place of its list/content when status
 * isn't `success`.
 */
export function QueryStateView({
  kind,
  title,
  description,
  onRetry,
}: {
  kind: 'loading' | 'error' | 'empty' | 'not_configured' | 'offline'
  title: string
  description?: string
  onRetry?: () => void
}) {
  return (
    <View style={styles.center}>
      {kind === 'loading' ? (
        <ActivityIndicator testID="query-state-loading" color={colors.secondary} />
      ) : (
        <>
          <Text style={styles.title}>{title}</Text>
          {description ? <Text style={styles.description}>{description}</Text> : null}
          {(kind === 'error' || kind === 'offline') && onRetry ? (
            <Button variant="secondary" onPress={onRetry}>
              Try again
            </Button>
          ) : null}
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm8,
    paddingHorizontal: spacing.lg16,
    paddingVertical: spacing.xl24,
  },
  title: {
    ...typeScale.headlineSm,
    color: colors.tertiary,
    textAlign: 'center',
  },
  description: {
    ...typeScale.bodySm,
    color: colors.textMuted,
    textAlign: 'center',
  },
})
