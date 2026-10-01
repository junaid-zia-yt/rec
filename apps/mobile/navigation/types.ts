import type { NavigatorScreenParams } from '@react-navigation/native'

/**
 * Typed React Navigation param lists for the full 16-screen navigation
 * graph (docs/03-screen-inventory.md's mobile-relevant screens). Most
 * screens are stubs this wave (see screens/stubs/*) — the graph and its
 * types are complete now so later waves fill in real screens without
 * touching navigation wiring.
 *
 * Param shapes for id-bearing routes are guessed from docs/07-data-model.md
 * entity names (`projectId`, `candidateId`, `shortlistId`) — later waves
 * may refine these once the mobile API contract (docs/13-api-service-
 * boundaries.md) is final.
 */

/** Root stack: swaps between the unauthenticated Auth stack and the
 * authenticated Main tab navigator based on AuthProvider's session state. */
export type RootStackParamList = {
  Auth: undefined
  Main: undefined
}

/** Auth stack — screen 1 (Sign in / Sign up). Only Sign In is real this
 * wave; org-selection/sign-up are out of scope for Wave 2. */
export type AuthStackParamList = {
  SignIn: undefined
}

/** Bottom tabs — the 5 fixed mobile destinations (docs/04-design-system.md
 * §4.15, docs/03-screen-inventory.md §3.1): Home, Projects, Pipeline,
 * Shortlists, More. "Candidates" (screen 9, global roster) is reached from
 * Home/More rather than being its own tab, matching the design doc's
 * 5-item constraint while still covering all 16 screens via nested stacks.
 *
 * Each tab's param is `NavigatorScreenParams<...>` (not `undefined`) so a
 * screen in one tab's stack can navigate into a specific screen of another
 * tab's stack — e.g. Home dashboard's "needs attention" list jumping
 * straight to `ProjectsTab > ProjectDetails` — and have that call
 * typecheck (`navigation.navigate('ProjectsTab', { screen: 'ProjectDetails',
 * params: { projectId } })`), per Build Phase 13 Wave 3's cross-tab
 * navigation requirement. */
export type MainTabParamList = {
  HomeTab: NavigatorScreenParams<HomeStackParamList>
  ProjectsTab: NavigatorScreenParams<ProjectsStackParamList>
  PipelineTab: NavigatorScreenParams<PipelineStackParamList>
  ShortlistsTab: NavigatorScreenParams<ShortlistsStackParamList>
  MoreTab: NavigatorScreenParams<MoreStackParamList>
}

/** Home tab stack: dashboard → notifications → copilot. */
export type HomeStackParamList = {
  HomeDashboard: undefined
  Notifications: undefined
  CopilotConversationList: undefined
  CopilotConversationWorkspace: { conversationId: string }
}

/** Projects tab stack: list → detail → scorecard → candidate profile chain. */
export type ProjectsStackParamList = {
  ProjectList: undefined
  ProjectDetails: { projectId: string }
  JobScorecard: { projectId: string; scorecardId?: string }
  CandidateProfile: { candidateId: string; projectId?: string }
  EvidenceReview: { candidateId: string; requirementId?: string }
  OutreachApproval: { candidateId: string; projectId?: string }
}

/** Pipeline tab stack: the Kanban/list pipeline board → candidate
 * evaluation, from the same candidate id shape used by ProjectsStack. */
export type PipelineStackParamList = {
  CandidatePipeline: { projectId?: string }
  CandidateEvaluation: { candidateId: string }
}

/** Shortlists tab stack: final shortlist (Verification Matrix, screen 18)
 * → candidate comparison → client decision view → POC comparison. */
export type ShortlistsStackParamList = {
  FinalShortlist: { projectId?: string; shortlistId?: string }
  CandidateComparison: { candidateIds: string[] }
  ClientDecision: { shortlistId: string }
  PocComparison: { pocId?: string }
}

/** More tab stack (screen 27's overflow menu) → notification preferences.
 * `NotificationPreferences` (Build Phase 13, Wave 5) replaces the earlier
 * placeholder `Settings` route name — this stack's only sub-screen is the
 * notification-preferences list the task brief calls for; a broader
 * "Settings" surface can reclaim the name later if one is ever built. */
export type MoreStackParamList = {
  MoreMenu: undefined
  NotificationPreferences: undefined
}

declare global {
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- required shape by React Navigation's own global augmentation pattern
    interface RootParamList extends RootStackParamList {}
  }
}
