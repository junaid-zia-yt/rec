import { createNativeStackNavigator } from '@react-navigation/native-stack'
import type { PipelineStackParamList } from '../types'
import { CandidatePipelineScreen } from '@/screens/pipeline/CandidatePipelineScreen'
import { CandidateEvaluationScreen } from '@/screens/pipeline/CandidateEvaluationScreen'
import { headerOptions } from './header-options'

const Stack = createNativeStackNavigator<PipelineStackParamList>()

export function PipelineStack() {
  return (
    <Stack.Navigator screenOptions={headerOptions}>
      <Stack.Screen
        name="CandidatePipeline"
        component={CandidatePipelineScreen}
        options={{ title: 'Pipeline' }}
      />
      <Stack.Screen
        name="CandidateEvaluation"
        component={CandidateEvaluationScreen}
        options={{ title: 'Evaluation' }}
      />
    </Stack.Navigator>
  )
}
