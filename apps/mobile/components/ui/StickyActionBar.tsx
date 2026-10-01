import type { PropsWithChildren } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, elevation, spacing } from '@/theme/tokens'

/**
 * Pins decision actions (Approve/Reject/etc.) to the bottom of a screen
 * rather than requiring a scroll to reach them — the "sticky decision
 * actions" mobile UX requirement referenced throughout docs/04-design-
 * system.md (§4.1/§4.11/§4.7's L3 elevation spec, the same treatment
 * BottomSheet uses for its own sticky sheet). Every decision screen this
 * wave (Candidate evaluation, Outreach approval, Final shortlist, Client
 * decision) renders its action button(s) inside this instead of inline in
 * scrolling content.
 */
export function StickyActionBar({ children }: PropsWithChildren) {
  const insets = useSafeAreaInsets()
  return (
    <View
      style={[styles.bar, elevation.l3, { paddingBottom: Math.max(insets.bottom, spacing.lg16) }]}
    >
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    gap: spacing.md12,
    backgroundColor: colors.surfaceBase,
    paddingHorizontal: spacing.lg16,
    paddingTop: spacing.md12,
  },
})
