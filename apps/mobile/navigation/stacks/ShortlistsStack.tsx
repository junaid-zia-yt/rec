import { createNativeStackNavigator } from '@react-navigation/native-stack'
import type { ShortlistsStackParamList } from '../types'
import { FinalShortlistScreen } from '@/screens/shortlists/FinalShortlistScreen'
import { CandidateComparisonScreen } from '@/screens/shortlists/CandidateComparisonScreen'
import { ClientDecisionScreen } from '@/screens/shortlists/ClientDecisionScreen'
import { PocComparisonScreen } from '@/screens/shortlists/PocComparisonScreen'
import { headerOptions } from './header-options'

const Stack = createNativeStackNavigator<ShortlistsStackParamList>()

export function ShortlistsStack() {
  return (
    <Stack.Navigator screenOptions={headerOptions}>
      <Stack.Screen
        name="FinalShortlist"
        component={FinalShortlistScreen}
        options={{ title: 'Shortlists' }}
      />
      <Stack.Screen
        name="CandidateComparison"
        component={CandidateComparisonScreen}
        options={{ title: 'Compare' }}
      />
      <Stack.Screen
        name="ClientDecision"
        component={ClientDecisionScreen}
        options={{ title: 'Client decision' }}
      />
      <Stack.Screen
        name="PocComparison"
        component={PocComparisonScreen}
        options={{ title: 'POC comparison' }}
      />
    </Stack.Navigator>
  )
}
