import { createNativeStackNavigator } from '@react-navigation/native-stack'
import type { HomeStackParamList } from '../types'
import { HomeDashboardScreen } from '@/screens/home/HomeDashboardScreen'
import { NotificationsScreen } from '@/screens/home/NotificationsScreen'
import { CopilotConversationListScreen } from '@/screens/home/CopilotConversationListScreen'
import { CopilotConversationWorkspaceScreen } from '@/screens/home/CopilotConversationWorkspaceScreen'
import { headerOptions } from './header-options'

const Stack = createNativeStackNavigator<HomeStackParamList>()

export function HomeStack() {
  return (
    <Stack.Navigator screenOptions={headerOptions}>
      <Stack.Screen
        name="HomeDashboard"
        component={HomeDashboardScreen}
        options={{ title: 'Home' }}
      />
      <Stack.Screen name="Notifications" component={NotificationsScreen} />
      <Stack.Screen
        name="CopilotConversationList"
        component={CopilotConversationListScreen}
        options={{ title: 'Copilot' }}
      />
      <Stack.Screen
        name="CopilotConversationWorkspace"
        component={CopilotConversationWorkspaceScreen}
        options={{ title: 'Copilot' }}
      />
    </Stack.Navigator>
  )
}
