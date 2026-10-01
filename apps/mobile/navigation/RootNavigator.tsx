import { NavigationContainer } from '@react-navigation/native'
import { ActivityIndicator, View } from 'react-native'
import { AuthNavigator } from './AuthNavigator'
import { MainTabs } from './MainTabs'
import { useAuth } from '@/lib/auth/AuthProvider'
import { NotConfiguredScreen } from '@/screens/auth/NotConfiguredScreen'
import { colors } from '@/theme/tokens'

/**
 * Root of the navigation tree. Three states:
 *  - not configured (no live Supabase project) → NotConfiguredScreen, no nav
 *  - configured but still resolving the initial session → spinner
 *  - configured: Auth stack (no session) or Main tabs (session present)
 */
export function RootNavigator() {
  const { session, loading, supabaseConfigured } = useAuth()

  if (!supabaseConfigured) {
    return <NotConfiguredScreen />
  }

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.surfaceCanvas,
        }}
      >
        <ActivityIndicator color={colors.secondary} />
      </View>
    )
  }

  return <NavigationContainer>{session ? <MainTabs /> : <AuthNavigator />}</NavigationContainer>
}
