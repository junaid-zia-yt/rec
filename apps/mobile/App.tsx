import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { ActivityIndicator, View } from 'react-native'
import { AuthProvider } from '@/lib/auth/AuthProvider'
import { RootNavigator } from '@/navigation/RootNavigator'
import { useAppFonts } from '@/theme/fonts'
import { colors } from '@/theme/tokens'

export default function App() {
  const [fontsLoaded] = useAppFonts()

  if (!fontsLoaded) {
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

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <RootNavigator />
        </AuthProvider>
        <StatusBar style="dark" />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
