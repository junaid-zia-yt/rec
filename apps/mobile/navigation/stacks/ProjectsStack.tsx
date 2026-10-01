import { createNativeStackNavigator } from '@react-navigation/native-stack'
import type { ProjectsStackParamList } from '../types'
import { ProjectListScreen } from '@/screens/projects/ProjectListScreen'
import { ProjectDetailsScreen } from '@/screens/projects/ProjectDetailsScreen'
import { JobScorecardScreen } from '@/screens/projects/JobScorecardScreen'
import { CandidateProfileScreen } from '@/screens/stubs/CandidateProfileScreen'
import { EvidenceReviewScreen } from '@/screens/projects/EvidenceReviewScreen'
import { OutreachApprovalScreen } from '@/screens/projects/OutreachApprovalScreen'
import { headerOptions } from './header-options'

const Stack = createNativeStackNavigator<ProjectsStackParamList>()

export function ProjectsStack() {
  return (
    <Stack.Navigator screenOptions={headerOptions}>
      <Stack.Screen
        name="ProjectList"
        component={ProjectListScreen}
        options={{ title: 'Projects' }}
      />
      <Stack.Screen
        name="ProjectDetails"
        component={ProjectDetailsScreen}
        options={{ title: 'Project' }}
      />
      <Stack.Screen
        name="JobScorecard"
        component={JobScorecardScreen}
        options={{ title: 'Scorecard' }}
      />
      <Stack.Screen
        name="CandidateProfile"
        component={CandidateProfileScreen}
        options={{ title: 'Candidate' }}
      />
      <Stack.Screen
        name="EvidenceReview"
        component={EvidenceReviewScreen}
        options={{ title: 'Evidence' }}
      />
      <Stack.Screen
        name="OutreachApproval"
        component={OutreachApprovalScreen}
        options={{ title: 'Outreach' }}
      />
    </Stack.Navigator>
  )
}
