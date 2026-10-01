import type { PropsWithChildren } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { colors, elevation, radius, spacing } from '@/theme/tokens'

/**
 * §4.7/§4.11 base card surface: white, 1px hairline border, 8px radius, L1
 * elevation. The Candidate Dossier Card and other domain cards (later
 * waves) compose on top of this rather than redefining the surface.
 */
export function Card({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return <View style={[styles.card, style]}>{children}</View>
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceBase,
    borderRadius: radius.card,
    padding: spacing.lg16,
    ...elevation.l1,
  },
})
