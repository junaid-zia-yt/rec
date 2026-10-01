import { createNativeStackNavigator } from '@react-navigation/native-stack'
import type { MoreStackParamList } from '../types'
import { MoreMenuScreen } from '@/screens/more/MoreMenuScreen'
import { NotificationPreferencesScreen } from '@/screens/more/NotificationPreferencesScreen'
import { headerOptions } from './header-options'

const Stack = createNativeStackNavigator<MoreStackParamList>()

export function MoreStack() {
  return (
    <Stack.Navigator screenOptions={headerOptions}>
      <Stack.Screen name="MoreMenu" component={MoreMenuScreen} options={{ title: 'More' }} />
      <Stack.Screen
        name="NotificationPreferences"
        component={NotificationPreferencesScreen}
        options={{ title: 'Notification preferences' }}
      />
    </Stack.Navigator>
  )
}
