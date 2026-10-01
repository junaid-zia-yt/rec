# Build Phase 13 report — Native Mobile Application

Build Phase 13 delivered the Expo React Native mobile application: all 16
mobile-relevant screens from [[03-screen-inventory]], a typed React
Navigation v6 shell, secure Supabase-JWT authentication, a bearer-token
`/api/mobile/*` route layer for higher-risk mutations, direct RLS-scoped
Supabase reads for everything else, offline detection with honest offline
states, session-expiry handling, and a small non-sensitive reference
cache. This report covers **Wave 6**, the phase's final wave: strengthened
test coverage against the brief's explicit testing checklist, mobile-
specific documentation, cross-cutting doc updates, and this completion
report. Waves 1–5 are summarized in §1 for a single, complete phase
record — mirroring the convention [[build-phase-12-report]] established.

## 0. Pre-wave state (verified clean immediately before Wave 6 started)

`pnpm typecheck`: 6/6 packages passing. `pnpm test`: web 777/777 passing,
mobile 50/50 passing (19 test suites). `pnpm lint`: 0 errors. `apps/mobile`
had all 16 screens built for real, a navigation shell, secure auth,
the `/api/mobile/*` route layer, offline detection, session-expiry
handling, and a small reference cache — Wave 6's job was explicitly to
strengthen testing and documentation, not to touch that source.

## 1. What was built (organized by wave)

### Wave 1 — Mobile API boundary (`apps/web/app/api/mobile/*`)

Bearer-token-authenticated Route Handlers reusing the exact same
business-logic helpers, Zod schemas, permission gates and audit calls as
their web Server Action counterparts — never re-implemented. Routes:
`auth/whoami`, `reviews/gate-override`, `outreach/[id]/approve`,
`shortlists/[id]/approve`, `shortlists/[id]/client-decision`,
`verification-requests/[id]/open`, `verification-requests/[id]/resolve`,
`notifications/[id]/read`, `notifications/read-all`,
`notifications/preferences`, `copilot/turn`. Plain reads deliberately not
routed through this layer — the mobile app queries Supabase directly
(RLS-protected identically to web). Full route table: [[13-api-service-
boundaries]] §13.8.

### Wave 2 — Expo scaffold

`apps/mobile` package scaffolded (Expo managed workflow, TypeScript,
strict mode matching the rest of the monorepo), the design-token theme
(`theme/tokens.ts`), the shared UI primitive library
(`components/ui/*` — Button, Card, Input, FormField, StatusChip,
BottomSheet, ScreenContainer, QueryStateView, StickyActionBar, ListItem),
the jest-expo test setup (`jest.config.js`/`jest.setup.js` — see
[[16-testing-strategy]] §16.3), secure Supabase-JWT auth
(`lib/auth/AuthProvider.tsx`, `expo-secure-store`-backed session
persistence), and the full typed React Navigation v6 graph (Auth stack ⇄
Main bottom-tabs, 5 tabs × nested stacks, `navigation/types.ts`) — every
screen a stub this wave, so later waves filled in real content without
touching navigation wiring.

### Wave 3 — Core navigation screens

Home dashboard, Project list, Project details, Job scorecard, Candidate
pipeline, Notifications, and the Copilot conversation workspace built for
real against direct RLS-scoped Supabase reads, using
`lib/data/useSupabaseQuery.ts`/`useQueryState.ts`'s loading/empty/error/
offline/success contract throughout.

### Wave 4 — Review/decision screens

Candidate evaluation (including the human gate-override sheet), Evidence
review, Candidate comparison, Outreach approval, Final shortlist, Client
decision — the highest-stakes screens in the app, each gated by the real
`hasPermission`/`@rqi/types` matrix (`canReview`/`canDecide`/
`canApproveInternally` patterns), each mutation routed through its
corresponding Wave 1 API route.

### Wave 5 — Notifications, settings, copilot, offline

Notification preferences screen, More menu, the notification deep-link
resolver (`lib/notifications/resolveDeepLink.ts` — a client-side,
RLS-scoped-query-based analogue of web's
`buildPermissionSafeDeepLink`, deliberately not re-implementing that
function's server-only ownership re-validation), the offline signal
(`lib/network/networkStatus.ts`), and session-expiry handling
(`AuthProvider`'s `sessionExpired` flag, distinguishing an automatic
`SIGNED_OUT` from a user-initiated sign-out).

### Wave 6 — Tests, documentation, phase report (this wave)

Covered in the remaining sections of this report.

## 2. Test coverage added this wave

All new test files, following the established mocking conventions
documented in [[16-testing-strategy]] §16.3 (`createFakeSupabase`, the
`@/lib/auth/AuthProvider` mock pattern, the `@/lib/api/client`
`jest.requireActual`-spread pattern, the `@/lib/network/networkStatus`
override pattern) rather than inventing parallel ones.

| Category                                   | File(s)                                                                              | Tests added | What's covered                                                                                                                                                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Navigation                                 | `__tests__/navigation/RootNavigator.test.tsx`                                        | 3           | Unauthenticated → Auth stack; authenticated → Main tabs (all 5 tab labels); unconfigured → `NotConfiguredScreen`. Deep-navigation substitute: see below.                                                                                   |
| Deep-link resolver (navigation substitute) | `__tests__/notifications/resolveDeepLink.test.ts`                                    | 9           | The real, unmocked `resolveNotificationDeepLink` — direct/1-hop/2-hop/3-hop resolutions, graceful `null` on missing data, unmapped resource types, thrown lookup errors, and null inputs                                                   |
| Authentication                             | `__tests__/auth/AuthProvider.test.tsx`, `__tests__/SignInScreen.test.tsx` (extended) | 3 + 5       | Sign-in success/failure (server error message surfaced), sign-out clears session and is distinguishable from expiry, `sessionExpired` true only after an automatic `SIGNED_OUT`, session-expired message clears on a fresh sign-in attempt |
| Permissions                                | `__tests__/permissions/roleGatedActions.test.tsx`                                    | 20          | All 5 roles × the 4 highest-stakes screens (gate override, outreach decide, shortlist internal approval, client decision), using the real `hasPermission` matrix                                                                           |
| API errors                                 | `__tests__/api-errors/mutationErrorSurfacing.test.tsx`                               | 4           | Server error message surfaced verbatim (3 screens) + thrown network error routed to the shared offline copy                                                                                                                                |
| Session expiry                             | `__tests__/session-expiry/sessionExpiryEndToEnd.test.tsx`                            | 1           | True end-to-end: real `AuthProvider` + real `RootNavigator`, an automatic `SIGNED_OUT` event lands on Sign In with the expiry message                                                                                                      |
| Core journeys                              | `__tests__/journeys/coreJourneys.test.tsx`                                           | 3           | Gate-override flow with post-refresh eligibility update; offline-then-online outreach-approval retry; notification tap → mark-read → real deep-link resolution → navigate                                                                  |
| **Total added**                            | 8 new files (+ 1 extended)                                                           | **47**      |                                                                                                                                                                                                                                            |

**Before/after mobile test counts, across the whole phase:** Wave 2 began
`apps/mobile` at 0 tests. Waves 3–5 brought it to 50 tests (19 suites).
Wave 6 (this wave) added 47 tests across 7 new files, bringing the phase's
final mobile total to **97 tests, 26 suites, all passing**.

## 3. iOS / Android / small-screen verification — honest static-analysis findings

**No real iOS or Android device/simulator exists in this environment** —
confirmed by every Build Phase 13 wave, re-confirmed this wave. No real
device/simulator testing has been performed at any point in this phase.
In its place:

- **Platform-specific code audit:** grepped the entire `apps/mobile`
  source tree for `Platform.OS`, `'ios'`/`'android'` literals, and any
  platform-exclusive library usage. Exactly **one** call site exists —
  `CopilotConversationWorkspaceScreen.tsx`'s
  `behavior={Platform.OS === 'ios' ? 'padding' : undefined}` on a
  `KeyboardAvoidingView` — correctly guarded with an explicit
  no-op `undefined` fallback for Android, not an unguarded iOS-only path.
  No iOS-only or Android-only native dependency exists anywhere in the
  app; every package used (`expo-secure-store`, `expo-font`,
  `react-native-safe-area-context`, `react-native-reanimated`,
  `@gorhom/bottom-sheet`, `@react-navigation/*`,
  `@react-native-async-storage/async-storage`) is Expo-managed-workflow
  compatible on both platforms.
- **Small-screen layout audit:** every top-level screen (except the
  still-stub `CandidateProfileScreen`, never in this phase's 16-screen
  scope) renders through `components/ui/ScreenContainer.tsx`, confirmed
  by grep, which wraps content in `SafeAreaView` and the design system's
  16px outer margin. No screen uses `Dimensions.get(...)` for absolute
  sizing (zero matches) — layout is flexbox throughout, which reflows at
  any width. Two small fixed-`width` style rules exist in the whole app
  (a 56px label column, an 8px unread dot) — both are non-content-bearing
  chrome, not a small-screen-breaking layout assumption.

This is a real, known environment limitation, stated plainly — it is a
static-analysis substitute for, and does not claim to replace, real
device/simulator QA before any release. Full detail:
[[16-testing-strategy]] §16.3.

## 4. Documentation updated and confirmed pushed

All of the following were updated locally, then pushed to the claude.ai
Project via `project_write` and read back via `project_read` to confirm
each landed correctly (per this wave's explicit verification requirement)
— see §6 for the per-file confirmation.

- [[03-screen-inventory]] — §3.4 appended: all 16 mobile screens marked
  implemented, the `CandidateProfile` stub-route gap flagged honestly.
- [[13-api-service-boundaries]] — §13.8's `startCopilotConversationAction`
  gap re-verified still open (no `apps/web/app/api/mobile/copilot/
conversations/` route exists) and noted as re-confirmed, not silently
  carried forward.
- [[16-testing-strategy]] — new §16.3: the mobile test stack, established
  mocking conventions, Wave 6's added test categories, and the honest
  iOS/Android/small-screen static-analysis statement.
- [[17-deployment-operations]] — new §17.13: how the mobile app would be
  built/distributed via EAS Build once undertaken (explicitly not done
  this build), the 3 required `EXPO_PUBLIC_*` environment variables (all
  currently unset in this environment), and the "do not publish to app
  stores in this build" constraint restated as documentation, not action.
- [[20-decision-register]] — new §20.1: 5 dated internal engineering
  decisions (E-01–E-05) covering the API-boundary architecture, React
  Navigation v6, jest-expo/RN Testing Library over Vitest, the
  no-netinfo/reactive-signal offline design, and the no-offline-action-
  queue-for-approvals decision.
- `docs/build-phase-13-report.md` (this file).

## 5. Final verification

`pnpm typecheck` (root, all 6 packages): **clean, 0 errors** (fixed one
new TypeScript strictness issue in `SignInScreen.test.tsx` — an array
index into `getAllByText(...)` typed as possibly-`undefined` — during
this wave, before considering the wave done).

`pnpm lint` (root): **0 errors**, 18 warnings — all pre-existing
`@typescript-eslint/no-require-imports` warnings on the
`require('../test-utils/supabaseMock').FAKE_USER` pattern already used
throughout every prior wave's screen tests (Jest mock-factory hoisting
forbids referencing an out-of-scope `import`ed variable); this wave's new
test files follow the same established pattern rather than introducing a
new one, so the warning count is proportional to the number of new files
using it, not a new class of issue.

`pnpm test` (root):

|           | Before Wave 6               | After Wave 6                            |
| --------- | --------------------------- | --------------------------------------- |
| web       | 777/777 passing (103 files) | 777/777 passing (103 files) — untouched |
| mobile    | 50/50 passing (19 suites)   | **97/97 passing (26 suites)**           |
| **Total** | **827/827**                 | **874/874**                             |

Zero regressions. Zero flaky or skipped tests.

## 6. Documentation push confirmation

Every doc in §4 was pushed via `Projects.project_write` using an absolute
path read fresh from disk (per this wave's explicit instruction, guarding
against a prior wave's relative-path bug), then immediately read back via
`Projects.project_read` and diffed against the local file before moving
to the next doc — every one confirmed landed correctly.

## 7. Known limitations (honest, not glossed over)

- **No live Supabase or web-app credentials anywhere in this
  environment.** `EXPO_PUBLIC_SUPABASE_URL`/`EXPO_PUBLIC_SUPABASE_ANON_KEY`/
  `EXPO_PUBLIC_API_BASE_URL` are all unset. Nothing in `apps/mobile` has
  been exercised against a real Supabase project or a real deployed web
  app at any point in this phase — every test runs against mocked
  Supabase clients and mocked API responses, and every screen's own
  "not configured" / RLS-policy-consistent behavior has been reviewed by
  reading the policies, never confirmed against a live backend.
- **No real iOS/Android/simulator testing performed**, at any wave of
  this phase — see §3's static-analysis substitute.
- **The `send-to-client` gap.** `sendShortlistToClientAction`
  (internally_approved → sent_to_client) has no mobile route — flagged
  since Wave 1 ([[13-api-service-boundaries]] §13.8), still open. Mobile
  can record an internal approval and a client's decision, but not the
  recruiter-side "send to client" step in between.
- **The copilot-conversation-start gap.** No mobile route or client
  wrapper exists to start a NEW copilot conversation from the mobile app
  — `CopilotConversationWorkspaceScreen` requires an existing
  `conversationId`. Re-verified open this wave; see
  [[13-api-service-boundaries]] §13.8.
- **The notification deep-link resolver's simplified permission model.**
  `lib/notifications/resolveDeepLink.ts` deliberately does not
  reimplement web's `buildPermissionSafeDeepLink`'s server-only
  ownership re-validation (`assertResourceOwnership`) — it resolves a
  target via the same RLS-scoped client every other mobile read uses, so
  a stale or access-revoked link degrades gracefully to the destination
  screen's own empty/error state rather than a bespoke precomputed
  "inaccessible" flag. This is graceful, not silent, but is a narrower
  guarantee than web's.
- **Not published to app stores in this build**, per the brief. No EAS
  build, no App Store Connect / Google Play Console submission, no
  `eas.json` — [[17-deployment-operations]] §17.13 documents how this
  would be done later, as documentation only.

## 8. Mandatory Completion Gate

- **Testing:** all of the brief's explicit testing categories have real,
  non-trivial coverage — component tests (pre-existing, Waves 3–5),
  navigation tests (✅, with an honestly-scoped substitute for a
  full-tree deep-navigation render — flagged, not hidden), authentication
  tests (✅), permission tests (✅, real matrix, 20 parametrized cases),
  API error tests (✅), session-expiry tests (✅, true end-to-end), core
  mobile journeys (✅, 3 flows), iOS/Android/small-screen verification
  (✅ as static analysis, explicitly not real-device — the honest
  substitute this environment allows, per §3).
- **Documentation:** all 5 requested docs updated and confirmed pushed to
  the claude.ai Project (§4/§6).
- **97/97 mobile tests passing, 777/777 web tests passing, 874/874 total,
  zero regressions; typecheck/lint clean across all 6 packages (§5).**
- **The phase is complete. Stopping at the phase boundary**, per project
  convention — no further build work follows this report.
