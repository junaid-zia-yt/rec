import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import type { ProjectsStackParamList } from '@/navigation/types'
import { StubScreen } from './StubScreen'

type Props = NativeStackScreenProps<ProjectsStackParamList, 'CandidateProfile'>

export function CandidateProfileScreen({ route }: Props) {
  return <StubScreen name="Candidate profile" note={`Candidate ${route.params.candidateId}`} />
}
