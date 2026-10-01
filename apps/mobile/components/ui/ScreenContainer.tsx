import type { PropsWithChildren } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors, layout } from '@/theme/tokens'

/**
 * Safe-area + consistent-padding wrapper every screen renders through, so
 * the 16px outer margin (docs/04-design-system.md §4.5) and canvas
 * background color are applied once, not per-screen.
 */
export function ScreenContainer({
  children,
  style,
  scroll: _scroll,
}: PropsWithChildren<{ style?: StyleProp<ViewStyle>; scroll?: boolean }>) {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={[styles.container, style]}>{children}</View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.surfaceCanvas,
  },
  container: {
    flex: 1,
    paddingHorizontal: layout.outerMargin,
  },
})
