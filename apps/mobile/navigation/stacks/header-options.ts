import type { NativeStackNavigationOptions } from '@react-navigation/native-stack'
import { colors, fontFamily } from '@/theme/tokens'

/** Shared native-stack header theming (§4.15 tertiary/structural navy for
 * chrome, Space Grotesk for headline text) applied consistently across
 * every tab's nested stack. */
export const headerOptions: NativeStackNavigationOptions = {
  headerStyle: { backgroundColor: colors.surfaceBase },
  headerTintColor: colors.tertiary,
  headerTitleStyle: { fontFamily: fontFamily.headlineSemibold, fontSize: 17 },
  headerShadowVisible: false,
}
